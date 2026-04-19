import ezdxf
import os
import re
import subprocess
import time
import traceback
from app.models.extraction import ExtractionResult, DrawingBounds
from app.services.layer_analyzer import analyze_layers
from app.services.block_counter import count_blocks
from app.services.polyline_measurer import measure_polylines
from app.services.fitting_inferrer import infer_fittings
from app.services.annotation_reader import read_annotations
from app.services.annotation_associator import associate_annotations
from app.services.legend_parser import parse_legend

UNITS_MAP = {0: "unitless", 1: "inches", 2: "feet", 4: "mm", 5: "cm", 6: "metres"}

ODA_PLUGIN_PATH = "/usr/bin/ODAFileConverter_27.1.0.0/plugins/platforms"
XDG_RUNTIME_DIR = "/tmp/runtime-root"
os.makedirs(XDG_RUNTIME_DIR, mode=0o700, exist_ok=True)
os.environ.setdefault("XDG_RUNTIME_DIR", XDG_RUNTIME_DIR)

if not os.environ.get("DISPLAY"):
    try:
        subprocess.Popen(
            ["Xvfb", ":99", "-screen", "0", "1024x768x24"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        os.environ["DISPLAY"] = ":99"
        time.sleep(0.5)
    except FileNotFoundError:
        pass


def parse_drawing(file_path: str) -> ExtractionResult:
    warnings: list[str] = []
    ext = os.path.splitext(file_path)[1].lower()

    if ext == ".dwg":
        os.environ["QT_QPA_PLATFORM_PLUGIN_PATH"] = ODA_PLUGIN_PATH
        os.environ["XDG_RUNTIME_DIR"] = XDG_RUNTIME_DIR
        try:
            from ezdxf.addons import odafc
            doc = odafc.readfile(file_path)
        except Exception as e:
            raise RuntimeError(
                f"DWG reading failed. Is ODA File Converter installed? Error: {e}"
            )
    elif ext in (".dxf",):
        doc = ezdxf.readfile(file_path)
    else:
        raise ValueError(f"Unsupported format: {ext}")

    insunits = doc.header.get("$INSUNITS", 0)
    msp = doc.modelspace()

    pipes = measure_polylines(doc)
    fixtures = count_blocks(msp)
    fittings = infer_fittings(msp)

    # Compute drawing bounds from extracted geometry (fallback: DWG extents)
    bounds = _compute_bounds(pipes, fixtures, fittings, doc)

    # True drawing extents from the DXF header ($EXTMIN/$EXTMAX). Used to align
    # the SVG backdrop, which spans the whole drawing and must not be shrunk
    # into the narrower extracted-geometry bounds.
    drawing_extents = _dwg_extents(doc, bounds)

    annotations = read_annotations(msp)

    # PR3: spatial association of nearby annotations to extracted elements
    try:
        annotation_context = associate_annotations(
            fixtures, pipes, fittings, annotations,
            bounds.model_dump() if bounds else {},
        )
    except Exception as e:  # noqa: BLE001 — never break extraction
        warnings.append(f"annotation_associator failed: {e}")
        annotation_context = None

    # PR3: LLM legend/schedule parse (graceful no-op if no API key)
    try:
        annotation_dicts = [
            {"text": a.text, "layer": a.layer, "position": a.position}
            for a in annotations
        ]
        legend_data = parse_legend(annotation_dicts)
        if isinstance(legend_data, dict) and legend_data.get("error"):
            warnings.append(f"legend_parser error: {legend_data['error']}")
    except Exception as e:  # noqa: BLE001 — never break extraction
        warnings.append(f"legend_parser failed: {e}")
        legend_data = None

    svg_render = _render_dxf_to_svg(doc, warnings)
    svg_backdrop = svg_render["svg"] if svg_render else None
    svg_backdrop_viewbox = svg_render["viewbox"] if svg_render else None

    return ExtractionResult(
        filename=os.path.basename(file_path),
        format=ext.lstrip("."),
        units=UNITS_MAP.get(insunits, "unknown"),
        layers=analyze_layers(doc),
        fixtures=fixtures,
        pipes=pipes,
        fittings=fittings,
        annotations=annotations,
        bounds=bounds,
        drawing_extents=drawing_extents,
        warnings=warnings,
        svg_backdrop=svg_backdrop,
        svg_backdrop_viewbox=svg_backdrop_viewbox,
        annotation_context=annotation_context,
        legend_data=legend_data,
    )


def _render_dxf_to_svg(doc, warnings: list[str]) -> dict | None:
    """Render the DXF modelspace to an SVG string via ezdxf's drawing addon.

    Returns a dict ``{"svg": str, "viewbox": [x, y, w, h]}`` on success. The
    viewBox metadata is required so the frontend can align the backdrop with
    the extracted geometry (which lives in CAD coordinates). Returns None on
    failure (the viewer will simply omit the backdrop).
    """
    try:
        from ezdxf.addons.drawing import Frontend, RenderContext
        from ezdxf.addons.drawing.svg import SVGBackend
        from ezdxf.addons.drawing.config import Configuration, LineweightPolicy

        msp = doc.modelspace()
        ctx = RenderContext(doc)
        backend = SVGBackend()
        # Configuration kwargs vary across ezdxf 1.x; pass only what we know
        # exists, and let other settings fall back to defaults.
        try:
            cfg = Configuration(lineweight_policy=LineweightPolicy.ABSOLUTE)
        except TypeError:
            cfg = Configuration()
        Frontend(ctx, backend, config=cfg).draw_layout(msp)
        try:
            from ezdxf.addons.drawing.layout import Page
            page = Page(width=0, height=0)  # 0,0 = auto-size from bounds
            svg_str = backend.get_string(page)
        except (ImportError, TypeError):
            svg_str = backend.get_string()

        # Parse the viewBox from the outer <svg> tag so the frontend can
        # map ezdxf's internal coords back onto CAD coords.
        m = re.search(r'<svg\b[^>]*\bviewBox="([^"]+)"', svg_str)
        if not m:
            warnings.append("svg_backdrop has no viewBox; cannot align")
            return None
        parts = m.group(1).split()
        if len(parts) != 4:
            warnings.append(f"svg_backdrop viewBox malformed: {m.group(1)}")
            return None
        try:
            vx, vy, vw, vh = [float(p) for p in parts]
        except ValueError:
            warnings.append(f"svg_backdrop viewBox non-numeric: {m.group(1)}")
            return None

        return {"svg": svg_str, "viewbox": [vx, vy, vw, vh]}
    except Exception as e:  # noqa: BLE001 — backdrop is best-effort
        warnings.append(f"svg_backdrop render failed: {e}")
        traceback.print_exc()
        return None


def _compute_bounds(pipes, fixtures, fittings, doc) -> DrawingBounds | None:
    xs: list[float] = []
    ys: list[float] = []
    for p in pipes:
        for seg in p.segments:
            for (x, y) in seg:
                xs.append(x); ys.append(y)
    for f in fixtures:
        for (x, y) in f.locations:
            xs.append(x); ys.append(y)
    for fit in fittings:
        for (x, y) in fit.positions:
            xs.append(x); ys.append(y)
    if not xs or not ys:
        try:
            ext_min = doc.header.get("$EXTMIN", (0, 0, 0))
            ext_max = doc.header.get("$EXTMAX", (0, 0, 0))
            return DrawingBounds(min_x=ext_min[0], min_y=ext_min[1], max_x=ext_max[0], max_y=ext_max[1])
        except Exception:
            return None
    return DrawingBounds(min_x=min(xs), min_y=min(ys), max_x=max(xs), max_y=max(ys))


def _dwg_extents(doc, fallback: DrawingBounds | None) -> DrawingBounds | None:
    """True drawing extents from the DXF header. Falls back to the provided
    extracted-geometry bounds when the header lacks valid $EXTMIN/$EXTMAX."""
    try:
        ext_min = doc.header.get("$EXTMIN", None)
        ext_max = doc.header.get("$EXTMAX", None)
        if ext_min is None or ext_max is None:
            return fallback
        min_x, min_y = float(ext_min[0]), float(ext_min[1])
        max_x, max_y = float(ext_max[0]), float(ext_max[1])
        # $EXTMIN/$EXTMAX can be uninitialized (1e20 sentinels) on drawings
        # that have never been regenerated. Detect and fall back.
        if max_x - min_x <= 0 or max_y - min_y <= 0 or abs(min_x) > 1e19 or abs(max_x) > 1e19:
            return fallback
        return DrawingBounds(min_x=min_x, min_y=min_y, max_x=max_x, max_y=max_y)
    except Exception:
        return fallback
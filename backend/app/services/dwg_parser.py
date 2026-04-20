import ezdxf
import os
import re
import subprocess
import time
import traceback
from app.models.extraction import ExtractionResult, DrawingBounds, ExtractedFixture, ExtractedFitting
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

    # Drop fixtures/fittings that sit outside the pipe-network area.
    # Legend pages place duplicate block inserts as symbol keys at a separate
    # location in modelspace — typically with a large X or Y offset from the
    # actual drawing. Since those regions contain no pipes, we use the pipe
    # bounding box (plus a 25 % margin) as the authoritative drawing area and
    # discard anything outside it.
    fixtures, fittings = _filter_to_drawing_area(fixtures, fittings, pipes)

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


def _filter_to_drawing_area(fixtures, fittings, pipes):
    """Remove fixture/fitting locations that are outside the pipe-network area.

    Builds an expanded bounding box from all pipe segment endpoints (25 %
    margin on each side) and drops any insertion/position points outside it.
    This eliminates block symbols placed on legend or notes pages, which live
    at a different modelspace offset from the real drawing content.

    A drawing with fixtures but zero pipes is a legend, schedule, or detail
    sheet — not a real installation drawing. Return empty in that case so
    schedule symbols never become takeoff line items.
    """
    pipe_pts = [
        (x, y)
        for p in pipes
        for seg in p.segments
        for (x, y) in seg
    ]
    if not pipe_pts:
        # No pipes → this is a legend/schedule/detail sheet, not an installation
        # drawing. Drop all fixtures and fittings to avoid schedule symbols
        # appearing as phantom takeoff items.
        return [], []

    px = [p[0] for p in pipe_pts]
    py = [p[1] for p in pipe_pts]
    p_min_x, p_max_x = min(px), max(px)
    p_min_y, p_max_y = min(py), max(py)

    mx = max(p_max_x - p_min_x, 1.0) * 0.25
    my = max(p_max_y - p_min_y, 1.0) * 0.25
    bx0, bx1 = p_min_x - mx, p_max_x + mx
    by0, by1 = p_min_y - my, p_max_y + my

    def _inside(loc):
        return bx0 <= loc[0] <= bx1 and by0 <= loc[1] <= by1

    filtered_fixtures = []
    for f in fixtures:
        locs = [loc for loc in f.locations if _inside(loc)]
        if locs:
            filtered_fixtures.append(ExtractedFixture(
                block_name=f.block_name,
                count=len(locs),
                layer=f.layer,
                locations=locs,
            ))

    filtered_fittings = []
    for ft in fittings:
        pos = [p for p in ft.positions if _inside(p)]
        if pos:
            filtered_fittings.append(ExtractedFitting(
                fitting_type=ft.fitting_type,
                layer=ft.layer,
                service_type=ft.service_type,
                count=len(pos),
                positions=pos,
            ))

    return filtered_fixtures, filtered_fittings


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
    """Compute the true bounding box ezdxf will render by iterating through
    every modelspace entity. `$EXTMIN/$EXTMAX` from the header is often stale
    or wrong — especially on Revit-exported DWGs — so we derive it ourselves.

    Returns the union of the entity bounding box with the extracted-geometry
    bounds (the fallback), so the backdrop is guaranteed to cover at least
    everything we extracted.
    """
    ent_min_x = float("inf"); ent_min_y = float("inf")
    ent_max_x = float("-inf"); ent_max_y = float("-inf")
    try:
        from ezdxf import bbox
        msp = doc.modelspace()
        extents = bbox.extents(msp, fast=True)
        if extents.has_data:
            ent_min_x = float(extents.extmin.x); ent_min_y = float(extents.extmin.y)
            ent_max_x = float(extents.extmax.x); ent_max_y = float(extents.extmax.y)
    except Exception:
        pass

    # Also check the DXF header extents as a secondary source
    try:
        ext_min = doc.header.get("$EXTMIN", None)
        ext_max = doc.header.get("$EXTMAX", None)
        if ext_min and ext_max:
            hx1, hy1 = float(ext_min[0]), float(ext_min[1])
            hx2, hy2 = float(ext_max[0]), float(ext_max[1])
            if abs(hx1) < 1e19 and abs(hx2) < 1e19 and hx2 > hx1 and hy2 > hy1:
                ent_min_x = min(ent_min_x, hx1); ent_min_y = min(ent_min_y, hy1)
                ent_max_x = max(ent_max_x, hx2); ent_max_y = max(ent_max_y, hy2)
    except Exception:
        pass

    # Union with extracted-geometry bounds so we never lose coverage of points
    # that are sitting outside what ezdxf's extent calculation returned.
    if fallback is not None:
        ent_min_x = min(ent_min_x, fallback.min_x)
        ent_min_y = min(ent_min_y, fallback.min_y)
        ent_max_x = max(ent_max_x, fallback.max_x)
        ent_max_y = max(ent_max_y, fallback.max_y)

    if ent_min_x == float("inf") or ent_max_x - ent_min_x <= 0 or ent_max_y - ent_min_y <= 0:
        return fallback

    return DrawingBounds(min_x=ent_min_x, min_y=ent_min_y, max_x=ent_max_x, max_y=ent_max_y)
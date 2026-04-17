import ezdxf
import os
import subprocess
import time
from app.models.extraction import ExtractionResult, DrawingBounds
from app.services.layer_analyzer import analyze_layers
from app.services.block_counter import count_blocks
from app.services.polyline_measurer import measure_polylines
from app.services.fitting_inferrer import infer_fittings
from app.services.annotation_reader import read_annotations

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

    return ExtractionResult(
        filename=os.path.basename(file_path),
        format=ext.lstrip("."),
        units=UNITS_MAP.get(insunits, "unknown"),
        layers=analyze_layers(doc),
        fixtures=fixtures,
        pipes=pipes,
        fittings=fittings,
        annotations=read_annotations(msp),
        bounds=bounds,
        warnings=warnings,
    )


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
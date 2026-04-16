import ezdxf
import os
from app.models.extraction import ExtractionResult
from app.services.layer_analyzer import analyze_layers
from app.services.block_counter import count_blocks
from app.services.polyline_measurer import measure_polylines
from app.services.fitting_inferrer import infer_fittings
from app.services.annotation_reader import read_annotations

UNITS_MAP = {0: "unitless", 1: "inches", 2: "feet", 4: "mm", 5: "cm", 6: "metres"}


def parse_drawing(file_path: str) -> ExtractionResult:
    warnings: list[str] = []
    ext = os.path.splitext(file_path)[1].lower()

    if ext == ".dwg":
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

    return ExtractionResult(
        filename=os.path.basename(file_path),
        format=ext.lstrip("."),
        units=UNITS_MAP.get(insunits, "unknown"),
        layers=analyze_layers(doc),
        fixtures=count_blocks(msp),
        pipes=measure_polylines(doc),
        fittings=infer_fittings(msp),
        annotations=read_annotations(msp),
        warnings=warnings,
    )

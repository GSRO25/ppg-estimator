import ezdxf
from ezdxf.math import Vec2
from app.models.extraction import ExtractedPipe
from app.utils.units import get_metre_factor

LAYER_SERVICE_MAP = {
    "SANITARY": "sanitary", "SEWER": "sanitary", "SEWR": "sanitary",
    "DRN": "sanitary", "DRAIN": "sanitary", "VENT": "sanitary", "VP": "sanitary",
    "COLDWATER": "cold_water", "CW": "cold_water", "PCW": "cold_water",
    "WATR": "cold_water", "WATER MAIN": "cold_water",
    "HOTWATER": "hot_water", "HW": "hot_water",
    "STORMWATER": "stormwater", "STORM": "stormwater", "SW": "stormwater",
    "DRAI": "stormwater",
    "FIRE": "fire", "FH": "fire", "FS": "fire",
    "GAS": "gas",
    "TRADEWASTE": "tradewaste", "TW": "tradewaste",
}

# Layers that are known to be non-plumbing (architecture / survey / reference
# / annotation). These are skipped entirely during pipe extraction so we don't
# generate phantom "pipe (unknown)" takeoff rows from grid text, dimension
# lines, notation layers, etc.
IGNORED_LAYER_PATTERNS = (
    # Architecture / survey / site reference
    "2D-", "DTM-", "BOUNDARY", "DETAIL", "AREA", "GARDEN", "STAIRS",
    "E COMM", "E ELEC",
    "SURF-", "ZZ-",
    "CONTOUR",
    # Plumbing-specific annotation layers (symbol defs, text, schedules)
    "HID-SYMBOL", "H_SYMBOL", "H_TEXT", "H-TEXT",
    # General-purpose annotation / drafting layers. G-ANNO-* is AIA layer
    # standard for grid annotations — never a pipe.
    "-ANNO-", "G-ANNO", "ANNO-", "ANNOTATION",
    "-TEXT", "TEXT-",
    "-DIM", "DIM-", "DIMENSION",
    "-NOTE", "NOTE-",
    "-GRID", "GRID-",
    "-HATCH", "HATCH-",
    "-TITLE", "TITLE-", "TITLEBLOCK",
    "-SCHEDULE", "SCHEDULE-",
    "DEFPOINTS",  # autocad dimension defpoints
)


def classify_layer(layer_name: str) -> str:
    upper = layer_name.upper()
    for pattern, service in LAYER_SERVICE_MAP.items():
        if pattern in upper:
            return service
    return "unknown"


def is_ignored_layer(layer_name: str) -> bool:
    upper = layer_name.upper().strip()
    if upper == "0" or upper == "L02":
        return True
    return any(p in upper for p in IGNORED_LAYER_PATTERNS)


def measure_polylines(doc: ezdxf.document.Drawing) -> list[ExtractedPipe]:
    msp = doc.modelspace()
    insunits = doc.header.get("$INSUNITS", 0)
    factor = get_metre_factor(insunits)
    layer_data: dict[str, dict] = {}

    for lwpoly in msp.query("LWPOLYLINE"):
        layer = lwpoly.dxf.layer
        if is_ignored_layer(layer):
            continue
        vertices = list(lwpoly.get_points(format="xy"))
        length = 0.0
        segments: list[list[tuple[float, float]]] = []
        for i in range(len(vertices) - 1):
            p1 = Vec2(vertices[i])
            p2 = Vec2(vertices[i + 1])
            length += p1.distance(p2)
            segments.append([
                (round(p1.x, 2), round(p1.y, 2)),
                (round(p2.x, 2), round(p2.y, 2)),
            ])
        if lwpoly.closed and len(vertices) > 2:
            length += Vec2(vertices[-1]).distance(Vec2(vertices[0]))
            segments.append([
                (round(vertices[-1][0], 2), round(vertices[-1][1], 2)),
                (round(vertices[0][0], 2), round(vertices[0][1], 2)),
            ])
        length_m = length * factor
        if layer not in layer_data:
            layer_data[layer] = {"total_length_m": 0.0, "segment_count": 0, "segments": []}
        layer_data[layer]["total_length_m"] += length_m
        layer_data[layer]["segment_count"] += 1
        layer_data[layer]["segments"].extend(segments)

    return [
        ExtractedPipe(
            layer=layer, service_type=classify_layer(layer),
            total_length_m=round(data["total_length_m"], 3),
            segment_count=data["segment_count"],
            segments=data["segments"],
        )
        for layer, data in layer_data.items()
    ]

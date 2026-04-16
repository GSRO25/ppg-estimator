import ezdxf
from ezdxf.math import Vec2
from app.models.extraction import ExtractedPipe
from app.utils.units import get_metre_factor

LAYER_SERVICE_MAP = {
    "SANITARY": "sanitary", "SEWER": "sanitary", "DRN": "sanitary", "DRAIN": "sanitary",
    "COLDWATER": "cold_water", "CW": "cold_water", "PCW": "cold_water",
    "HOTWATER": "hot_water", "HW": "hot_water",
    "STORMWATER": "stormwater", "STORM": "stormwater", "SW": "stormwater",
    "FIRE": "fire", "FH": "fire", "FS": "fire",
    "GAS": "gas",
    "TRADEWASTE": "tradewaste", "TW": "tradewaste",
}


def classify_layer(layer_name: str) -> str:
    upper = layer_name.upper()
    for pattern, service in LAYER_SERVICE_MAP.items():
        if pattern in upper:
            return service
    return "unknown"


def measure_polylines(doc: ezdxf.document.Drawing) -> list[ExtractedPipe]:
    msp = doc.modelspace()
    insunits = doc.header.get("$INSUNITS", 0)
    factor = get_metre_factor(insunits)
    layer_data: dict[str, dict] = {}

    for lwpoly in msp.query("LWPOLYLINE"):
        layer = lwpoly.dxf.layer
        vertices = list(lwpoly.get_points(format="xy"))
        length = 0.0
        for i in range(len(vertices) - 1):
            p1 = Vec2(vertices[i])
            p2 = Vec2(vertices[i + 1])
            length += p1.distance(p2)
        if lwpoly.closed and len(vertices) > 2:
            length += Vec2(vertices[-1]).distance(Vec2(vertices[0]))
        length_m = length * factor
        if layer not in layer_data:
            layer_data[layer] = {"total_length_m": 0.0, "segment_count": 0}
        layer_data[layer]["total_length_m"] += length_m
        layer_data[layer]["segment_count"] += 1

    return [
        ExtractedPipe(
            layer=layer, service_type=classify_layer(layer),
            total_length_m=round(data["total_length_m"], 3),
            segment_count=data["segment_count"],
        )
        for layer, data in layer_data.items()
    ]

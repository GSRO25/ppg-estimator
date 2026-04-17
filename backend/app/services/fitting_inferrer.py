from ezdxf.layouts import BaseLayout
from app.models.extraction import ExtractedFitting
from app.utils.geometry import angle_at_vertex
from app.services.polyline_measurer import classify_layer, is_ignored_layer


def infer_fittings(msp: BaseLayout) -> list[ExtractedFitting]:
    # Per-layer counts and positions
    layer_fittings: dict[str, dict[str, dict]] = {}
    for lwpoly in msp.query("LWPOLYLINE"):
        layer = lwpoly.dxf.layer
        if is_ignored_layer(layer):
            continue
        vertices = list(lwpoly.get_points(format="xy"))
        if layer not in layer_fittings:
            layer_fittings[layer] = {
                "elbow_90": {"count": 0, "positions": []},
                "elbow_45": {"count": 0, "positions": []},
            }
        for i in range(1, len(vertices) - 1):
            angle = angle_at_vertex(vertices[i - 1], vertices[i], vertices[i + 1])
            vx, vy = vertices[i][0], vertices[i][1]
            pos = (round(vx, 2), round(vy, 2))
            if 85 <= angle <= 95:
                layer_fittings[layer]["elbow_90"]["count"] += 1
                layer_fittings[layer]["elbow_90"]["positions"].append(pos)
            elif 40 <= angle <= 50:
                layer_fittings[layer]["elbow_45"]["count"] += 1
                layer_fittings[layer]["elbow_45"]["positions"].append(pos)

    results = []
    for layer, fittings in layer_fittings.items():
        service = classify_layer(layer)
        for fitting_type, data in fittings.items():
            if data["count"] > 0:
                results.append(ExtractedFitting(
                    fitting_type=fitting_type, layer=layer,
                    service_type=service, count=data["count"],
                    positions=data["positions"],
                ))
    return results

from ezdxf.layouts import BaseLayout
from app.models.extraction import ExtractedFitting
from app.utils.geometry import angle_at_vertex
from app.services.polyline_measurer import classify_layer


def infer_fittings(msp: BaseLayout) -> list[ExtractedFitting]:
    layer_fittings: dict[str, dict[str, int]] = {}
    for lwpoly in msp.query("LWPOLYLINE"):
        layer = lwpoly.dxf.layer
        vertices = list(lwpoly.get_points(format="xy"))
        if layer not in layer_fittings:
            layer_fittings[layer] = {"elbow_90": 0, "elbow_45": 0}
        for i in range(1, len(vertices) - 1):
            angle = angle_at_vertex(vertices[i - 1], vertices[i], vertices[i + 1])
            if 85 <= angle <= 95:
                layer_fittings[layer]["elbow_90"] += 1
            elif 40 <= angle <= 50:
                layer_fittings[layer]["elbow_45"] += 1

    results = []
    for layer, fittings in layer_fittings.items():
        service = classify_layer(layer)
        for fitting_type, count in fittings.items():
            if count > 0:
                results.append(ExtractedFitting(
                    fitting_type=fitting_type, layer=layer,
                    service_type=service, count=count,
                ))
    return results

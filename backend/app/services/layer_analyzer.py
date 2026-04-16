import ezdxf
from app.models.extraction import LayerSummary


def analyze_layers(doc: ezdxf.document.Drawing) -> list[LayerSummary]:
    msp = doc.modelspace()
    entity_counts: dict[str, int] = {}
    for entity in msp:
        layer = entity.dxf.layer
        entity_counts[layer] = entity_counts.get(layer, 0) + 1

    results = []
    for layer in doc.layers:
        name = layer.dxf.name
        if name == "0":
            continue
        results.append(LayerSummary(
            name=name,
            entity_count=entity_counts.get(name, 0),
            color=layer.dxf.color,
        ))
    return results

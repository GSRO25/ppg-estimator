import ezdxf
from app.services.layer_analyzer import analyze_layers


def test_returns_all_non_default_layers(simple_dxf_path):
    doc = ezdxf.readfile(simple_dxf_path)
    result = analyze_layers(doc)
    layer_names = [l.name for l in result]
    assert "P-SANITARY" in layer_names
    assert "P-COLDWATER" in layer_names
    assert "FIXTURES" in layer_names
    assert "0" not in layer_names


def test_counts_entities_per_layer(simple_dxf_path):
    doc = ezdxf.readfile(simple_dxf_path)
    result = analyze_layers(doc)
    fixtures_layer = next(l for l in result if l.name == "FIXTURES")
    assert fixtures_layer.entity_count == 5  # 3 WC + 2 BASIN

import ezdxf
from app.services.fitting_inferrer import infer_fittings


def test_detects_90_degree_elbow(simple_dxf_path):
    doc = ezdxf.readfile(simple_dxf_path)
    result = infer_fittings(doc.modelspace())
    cw_fittings = [f for f in result if f.layer == "P-COLDWATER"]
    elbows_90 = [f for f in cw_fittings if f.fitting_type == "elbow_90"]
    assert len(elbows_90) == 1
    assert elbows_90[0].count == 1


def test_complex_stormwater_bends(complex_dxf_path):
    doc = ezdxf.readfile(complex_dxf_path)
    result = infer_fittings(doc.modelspace())
    sw_90 = [f for f in result if f.layer == "P-STORMWATER" and f.fitting_type == "elbow_90"]
    assert len(sw_90) == 1
    assert sw_90[0].count == 3

import ezdxf
from app.services.polyline_measurer import measure_polylines


def test_measures_straight_pipe_in_metres(simple_dxf_path):
    doc = ezdxf.readfile(simple_dxf_path)
    result = measure_polylines(doc)
    sanitary = next(p for p in result if p.layer == "P-SANITARY")
    assert abs(sanitary.total_length_m - 10.0) < 0.01


def test_measures_l_shaped_pipe(simple_dxf_path):
    doc = ezdxf.readfile(simple_dxf_path)
    result = measure_polylines(doc)
    cw = next(p for p in result if p.layer == "P-COLDWATER")
    assert abs(cw.total_length_m - 5.0) < 0.01


def test_converts_mm_to_metres(complex_dxf_path):
    doc = ezdxf.readfile(complex_dxf_path)
    result = measure_polylines(doc)
    sanitary = next(p for p in result if p.layer == "P-SANITARY")
    assert abs(sanitary.total_length_m - 15.0) < 0.01

import ezdxf
from app.services.block_counter import count_blocks


def test_counts_wc_blocks(simple_dxf_path):
    doc = ezdxf.readfile(simple_dxf_path)
    result = count_blocks(doc.modelspace())
    wc = next(f for f in result if f.block_name == "WC")
    assert wc.count == 3


def test_counts_basin_blocks(simple_dxf_path):
    doc = ezdxf.readfile(simple_dxf_path)
    result = count_blocks(doc.modelspace())
    basin = next(f for f in result if f.block_name == "BASIN")
    assert basin.count == 2


def test_records_insertion_locations(simple_dxf_path):
    doc = ezdxf.readfile(simple_dxf_path)
    result = count_blocks(doc.modelspace())
    wc = next(f for f in result if f.block_name == "WC")
    assert len(wc.locations) == 3


def test_complex_fixture_counts(complex_dxf_path):
    doc = ezdxf.readfile(complex_dxf_path)
    result = count_blocks(doc.modelspace())
    counts = {f.block_name: f.count for f in result}
    assert counts["WC"] == 5
    assert counts["BASIN"] == 8
    assert counts["SHOWER"] == 3
    assert counts["FLOOR_WASTE"] == 4
    assert counts["URINAL"] == 2

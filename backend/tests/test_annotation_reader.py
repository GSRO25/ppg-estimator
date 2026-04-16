import ezdxf
from app.services.annotation_reader import read_annotations


def test_reads_mtext_annotations(simple_dxf_path):
    doc = ezdxf.readfile(simple_dxf_path)
    result = read_annotations(doc.modelspace())
    texts = [a.text for a in result]
    assert "DN100 PVC" in texts


def test_reads_text_annotations(simple_dxf_path):
    doc = ezdxf.readfile(simple_dxf_path)
    result = read_annotations(doc.modelspace())
    texts = [a.text for a in result]
    assert "25mm CW" in texts

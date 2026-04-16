from ezdxf.layouts import BaseLayout
from app.models.extraction import ExtractedAnnotation


def read_annotations(msp: BaseLayout) -> list[ExtractedAnnotation]:
    results = []
    for text_entity in msp.query("TEXT"):
        results.append(ExtractedAnnotation(
            text=text_entity.dxf.text,
            layer=text_entity.dxf.layer,
            position=(round(text_entity.dxf.insert.x, 2), round(text_entity.dxf.insert.y, 2)),
        ))
    for mtext_entity in msp.query("MTEXT"):
        plain = mtext_entity.plain_text()
        pos = mtext_entity.dxf.insert
        results.append(ExtractedAnnotation(
            text=plain,
            layer=mtext_entity.dxf.layer,
            position=(round(pos.x, 2), round(pos.y, 2)),
        ))
    return results

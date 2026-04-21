"""Extract every piece of text we can find in a DWG/DXF.

Historically this only read TEXT/MTEXT entities in model space, which
misses where title blocks actually live in ~80% of AU hydraulic drawings.
Real title blocks typically sit in one of these places:

  1. Paper space layouts — the "sheet" the drafter actually published
  2. Block attributes — a title-block is usually a single INSERT of a
     block (TBLK, A0_TITLE, etc.) with fields populated as ATTDEF/ATTRIB
  3. DXF header metadata — $COMPANY, $AUTHOR, $LASTSAVEDBY set by the
     CAD admin when setting up the template

This module now reads all of them. Each annotation is tagged with a
`source` field so the firm-detector can prioritise title-block sources
over random model-space labels.
"""
from typing import Iterable
from ezdxf.document import Drawing
from ezdxf.layouts import BaseLayout
from app.models.extraction import ExtractedAnnotation


def read_annotations(doc: Drawing) -> list[ExtractedAnnotation]:
    """Read text from every source in the DWG.

    Returns a flat list with `source` labels so callers can weight them.
    """
    results: list[ExtractedAnnotation] = []

    # 1. DXF header metadata (firm name often lives here)
    results.extend(_read_header(doc))

    # 2. Model space TEXT/MTEXT (original behaviour)
    msp = doc.modelspace()
    results.extend(_read_layout_text(msp, source="modelspace"))
    results.extend(_read_block_attributes(msp, source="block_attribute"))

    # 3. Paper space layouts (title blocks usually live here)
    for layout in doc.layouts:
        if layout.name.lower() in ("model", ""):
            continue
        results.extend(_read_layout_text(layout, source="paperspace"))
        results.extend(_read_block_attributes(layout, source="block_attribute"))

    return results


def _read_layout_text(layout: BaseLayout, source: str) -> Iterable[ExtractedAnnotation]:
    """TEXT + MTEXT entities directly placed on the layout."""
    for text_entity in layout.query("TEXT"):
        try:
            yield ExtractedAnnotation(
                text=text_entity.dxf.text,
                layer=text_entity.dxf.layer,
                position=(round(text_entity.dxf.insert.x, 2), round(text_entity.dxf.insert.y, 2)),
                source=source,
            )
        except Exception:  # noqa: BLE001 — never break extraction on a single bad entity
            continue
    for mtext_entity in layout.query("MTEXT"):
        try:
            plain = mtext_entity.plain_text()
            pos = mtext_entity.dxf.insert
            yield ExtractedAnnotation(
                text=plain,
                layer=mtext_entity.dxf.layer,
                position=(round(pos.x, 2), round(pos.y, 2)),
                source=source,
            )
        except Exception:
            continue


def _read_block_attributes(layout: BaseLayout, source: str) -> Iterable[ExtractedAnnotation]:
    """ATTRIB values on INSERT entities.

    Title blocks are almost always implemented as a single INSERT of a
    block (e.g. named TBLK, A0_TITLE, TITLE_BLOCK_A1) with placeholder
    fields populated via ATTRIB. ezdxf exposes these through
    ``insert.attribs`` — iterate each and grab ``.dxf.text``.
    """
    for insert in layout.query("INSERT"):
        attribs = getattr(insert, "attribs", None)
        if not attribs:
            continue
        try:
            pos = insert.dxf.insert
            px, py = round(pos.x, 2), round(pos.y, 2)
            layer = insert.dxf.layer
        except Exception:
            continue
        for attrib in attribs:
            try:
                text = attrib.dxf.text or ""
                if not text.strip():
                    continue
                yield ExtractedAnnotation(
                    text=text,
                    layer=layer,
                    position=(px, py),
                    source=source,
                )
            except Exception:
                continue


def _read_header(doc: Drawing) -> Iterable[ExtractedAnnotation]:
    """DXF header metadata: $COMPANY, $AUTHOR, $LASTSAVEDBY, $TITLE.

    These are single string values set when the CAD template was made.
    Not geometry — we assign dummy coords (0,0) and rely on the `source`
    tag for the detector to know these are top-priority firm hints.
    """
    header = doc.header
    for field_name in ("$COMPANY", "$AUTHOR", "$LASTSAVEDBY", "$TITLE"):
        try:
            value = header.get(field_name)
        except Exception:
            value = None
        if not value or not isinstance(value, str) or not value.strip():
            continue
        yield ExtractedAnnotation(
            text=f"{field_name}: {value.strip()}",
            layer="DXF_HEADER",
            position=(0.0, 0.0),
            source="header",
        )

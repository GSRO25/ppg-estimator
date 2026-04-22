import re
from ezdxf.layouts import BaseLayout
from app.models.extraction import ExtractedFixture

# Blocks that are annotation/drafting artifacts, not plumbing fixtures.
# These would otherwise appear as takeoff line items at $0 rates.
_IGNORE_PATTERNS = [
    # Revit/building markers
    re.compile(r"^ground$", re.IGNORECASE),
    re.compile(r"^level\s*\d*$", re.IGNORECASE),
    re.compile(r"^roof$", re.IGNORECASE),
    re.compile(r"^grid", re.IGNORECASE),
    re.compile(r"^north", re.IGNORECASE),
    re.compile(r"^a\$c", re.IGNORECASE),
    # Title block / sheet furniture
    re.compile(r"titleblock", re.IGNORECASE),
    re.compile(r"title\s*block", re.IGNORECASE),
    re.compile(r"^revision", re.IGNORECASE),
    re.compile(r"^drawing_", re.IGNORECASE),
    re.compile(r"^section", re.IGNORECASE),
    re.compile(r"^detail", re.IGNORECASE),
    re.compile(r"^elevation", re.IGNORECASE),
    re.compile(r"^view", re.IGNORECASE),
    re.compile(r"^scale", re.IGNORECASE),
    re.compile(r"^matchline", re.IGNORECASE),
    re.compile(r"^dtag", re.IGNORECASE),
    # CCAD landscape / site furniture
    re.compile(r"ccad_symbol_tree", re.IGNORECASE),
    re.compile(r"ccad_symbol_shrub", re.IGNORECASE),
    re.compile(r"symbol_tree", re.IGNORECASE),
    re.compile(r"symbol_shrub", re.IGNORECASE),
    re.compile(r"^tree", re.IGNORECASE),
    re.compile(r"^shrub", re.IGNORECASE),
    re.compile(r"^plant_", re.IGNORECASE),
    re.compile(r"^car$|^vehicle", re.IGNORECASE),
    re.compile(r"^person$|^human", re.IGNORECASE),
    # Drawing reference callouts — block names that embed a drawing number,
    # e.g. "180271 Tundish Type_1_dwg-5240532-Detail 1". These are detail
    # bubbles / callout boxes, not real plumbing fixtures.
    re.compile(r"dwg[-_]", re.IGNORECASE),          # contains "dwg-" or "dwg_"
    re.compile(r"-detail\s*\d+$", re.IGNORECASE),   # ends with "-Detail N"
    re.compile(r"^\d{5,}\s", re.IGNORECASE),         # starts with a 5+ digit drawing number
    # CAD annotation bubbles / markers
    re.compile(r"^point_dot$", re.IGNORECASE),
    re.compile(r"^point_cross$", re.IGNORECASE),
    re.compile(r"^\$cir", re.IGNORECASE),
    re.compile(r"^svs$", re.IGNORECASE),
    re.compile(r"^telov$", re.IGNORECASE),
    re.compile(r"^mhcir$", re.IGNORECASE),
    # 2D furniture / architectural fitout
    re.compile(r"^2d[_-]", re.IGNORECASE),
    re.compile(r"^furniture", re.IGNORECASE),
    re.compile(r"^door", re.IGNORECASE),
    re.compile(r"^window", re.IGNORECASE),
    # Annotation tag blocks — drafting labels, not installable fixtures.
    # Patterns like "SAP_Roof Area Tag R20", "SAP_GA_Service Tag - DROPPER".
    # The word "Tag" consistently marks an annotation symbol in AU
    # hydraulic drawing conventions.
    re.compile(r"[_\s-]Tag\b", re.IGNORECASE),           # "Area Tag", "Service Tag"
    re.compile(r"^Tag[_\s-]", re.IGNORECASE),            # "Tag_something"
    # General annotation markers
    re.compile(r"^anno[_-]?", re.IGNORECASE),
    re.compile(r"[_-]anno$", re.IGNORECASE),
    re.compile(r"^text[_-]", re.IGNORECASE),
    re.compile(r"[_-]text$", re.IGNORECASE),
    # SAP_GA_* (General Arrangement) blocks are usually annotation overlays;
    # SAP_GS_* (Gas Services) and SAP_SW_* (Stormwater) etc. are real.
    re.compile(r"^SAP_GA_", re.IGNORECASE),
]


def _is_noise(name: str) -> bool:
    return any(p.search(name) for p in _IGNORE_PATTERNS)


def count_blocks(msp: BaseLayout) -> list[ExtractedFixture]:
    block_data: dict[str, dict] = {}
    for insert in msp.query("INSERT"):
        name = insert.dxf.name
        if name.startswith("*"):
            continue
        if _is_noise(name):
            continue
        if name not in block_data:
            block_data[name] = {"count": 0, "layer": insert.dxf.layer, "locations": []}
        block_data[name]["count"] += 1
        pos = insert.dxf.insert
        block_data[name]["locations"].append((round(pos.x, 2), round(pos.y, 2)))

    return [
        ExtractedFixture(
            block_name=name, count=data["count"],
            layer=data["layer"], locations=data["locations"],
        )
        for name, data in block_data.items()
    ]

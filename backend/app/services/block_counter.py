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

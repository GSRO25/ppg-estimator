from ezdxf.layouts import BaseLayout
from app.models.extraction import ExtractedFixture


def count_blocks(msp: BaseLayout) -> list[ExtractedFixture]:
    block_data: dict[str, dict] = {}
    for insert in msp.query("INSERT"):
        name = insert.dxf.name
        if name.startswith("*"):
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

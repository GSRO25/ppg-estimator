"""Generate deterministic DXF files for testing extraction services."""
import ezdxf
import os

FIXTURE_DIR = os.path.dirname(__file__)


def create_simple_dxf() -> str:
    """3 WC blocks, 2 BASIN blocks, one 10m polyline on P-SANITARY, annotations."""
    doc = ezdxf.new(dxfversion="R2013")
    doc.header["$INSUNITS"] = 6  # metres
    msp = doc.modelspace()

    doc.layers.add("P-SANITARY", color=1)
    doc.layers.add("P-COLDWATER", color=5)
    doc.layers.add("FIXTURES", color=3)

    wc_block = doc.blocks.new("WC")
    wc_block.add_circle((0, 0), 0.2)

    basin_block = doc.blocks.new("BASIN")
    basin_block.add_circle((0, 0), 0.15)

    for x in [0, 3, 6]:
        msp.add_blockref("WC", (x, 0), dxfattribs={"layer": "FIXTURES"})

    for x in [1, 4]:
        msp.add_blockref("BASIN", (x, 2), dxfattribs={"layer": "FIXTURES"})

    msp.add_lwpolyline([(0, 0), (10, 0)], dxfattribs={"layer": "P-SANITARY"})

    msp.add_lwpolyline(
        [(0, 0), (3, 0), (3, 2)],
        dxfattribs={"layer": "P-COLDWATER"},
    )

    msp.add_mtext("DN100 PVC", dxfattribs={"layer": "P-SANITARY", "insert": (5, 1)})
    msp.add_text("25mm CW", dxfattribs={"layer": "P-COLDWATER", "insert": (1, 1)})

    path = os.path.join(FIXTURE_DIR, "sample_simple.dxf")
    doc.saveas(path)
    return path


def create_complex_dxf() -> str:
    """Multiple layers, multiple block types, polylines with various angles."""
    doc = ezdxf.new(dxfversion="R2013")
    doc.header["$INSUNITS"] = 4  # millimetres
    msp = doc.modelspace()

    for name, color in [
        ("P-SANITARY", 1), ("P-COLDWATER", 5), ("P-HOTWATER", 6),
        ("P-STORMWATER", 4), ("P-FIRE", 10), ("FIXTURES", 3),
    ]:
        doc.layers.add(name, color=color)

    for block_name in ["WC", "BASIN", "SHOWER", "FLOOR_WASTE", "URINAL"]:
        blk = doc.blocks.new(block_name)
        blk.add_circle((0, 0), 100)

    insertions = [
        ("WC", 5), ("BASIN", 8), ("SHOWER", 3),
        ("FLOOR_WASTE", 4), ("URINAL", 2),
    ]
    x = 0
    for block_name, count in insertions:
        for i in range(count):
            msp.add_blockref(block_name, (x, i * 1000), dxfattribs={"layer": "FIXTURES"})
        x += 2000

    # Straight 15m pipe (15000mm)
    msp.add_lwpolyline([(0, 0), (15000, 0)], dxfattribs={"layer": "P-SANITARY"})

    # Pipe with 90-degree bend
    msp.add_lwpolyline(
        [(0, 5000), (5000, 5000), (5000, 10000)],
        dxfattribs={"layer": "P-COLDWATER"},
    )

    # Pipe with 45-degree bend
    msp.add_lwpolyline(
        [(0, 15000), (5000, 15000), (8535.5, 18535.5)],
        dxfattribs={"layer": "P-HOTWATER"},
    )

    # Stormwater with 3 right-angle bends
    msp.add_lwpolyline(
        [(0, 20000), (3000, 20000), (3000, 23000), (6000, 23000), (6000, 26000)],
        dxfattribs={"layer": "P-STORMWATER"},
    )

    path = os.path.join(FIXTURE_DIR, "sample_complex.dxf")
    doc.saveas(path)
    return path


if __name__ == "__main__":
    create_simple_dxf()
    create_complex_dxf()
    print("Test DXF fixtures created.")

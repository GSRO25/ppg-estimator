INSUNITS_TO_METRES = {
    0: 1.0, 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1.0,
}


def get_metre_factor(insunits: int) -> float:
    return INSUNITS_TO_METRES.get(insunits, 1.0)

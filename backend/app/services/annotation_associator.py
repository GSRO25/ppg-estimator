"""Associate extracted TEXT/MTEXT annotations with nearby fixtures, pipes, fittings."""
from typing import Any
import math

PROXIMITY_MULTIPLIER = 0.05  # 5% of drawing diagonal is the association radius


def associate_annotations(
    fixtures: list[Any],
    pipes: list[Any],
    fittings: list[Any],
    annotations: list[Any],
    bounds: dict,
) -> dict:
    """
    For each fixture/pipe/fitting, find the N closest annotations within proximity radius.
    Returns a dict keyed by a stable identifier:
      {
        "fixtures": { "block_name": ["nearby text 1", "nearby text 2"] },
        "pipes": { "layer|service_type": [...] },
        "fittings": { "fitting_type|layer": [...] },
      }
    """
    if not annotations or not bounds:
        return {"fixtures": {}, "pipes": {}, "fittings": {}}

    diag = math.hypot(bounds["max_x"] - bounds["min_x"], bounds["max_y"] - bounds["min_y"])
    radius = diag * PROXIMITY_MULTIPLIER

    result: dict[str, dict[str, set]] = {"fixtures": {}, "pipes": {}, "fittings": {}}

    # For each fixture location, find annotations within radius
    for f in fixtures:
        key = f.block_name
        for loc in f.locations or []:
            nearby = [
                a.text for a in annotations
                if _dist(loc, a.position) < radius and len(a.text.strip()) > 0
            ]
            if nearby:
                result["fixtures"].setdefault(key, set()).update(nearby[:5])

    # For each pipe, use segment midpoints
    for p in pipes:
        key = f"{p.layer}|{p.service_type}"
        for seg in p.segments or []:
            if len(seg) < 2:
                continue
            mid = ((seg[0][0] + seg[1][0]) / 2, (seg[0][1] + seg[1][1]) / 2)
            nearby = [
                a.text for a in annotations
                if _dist(mid, a.position) < radius and len(a.text.strip()) > 0
            ]
            if nearby:
                result["pipes"].setdefault(key, set()).update(nearby[:3])

    # For each fitting
    for f in fittings:
        key = f"{f.fitting_type}|{f.layer}"
        for pos in getattr(f, "positions", []) or []:
            nearby = [
                a.text for a in annotations
                if _dist(pos, a.position) < radius and len(a.text.strip()) > 0
            ]
            if nearby:
                result["fittings"].setdefault(key, set()).update(nearby[:3])

    # Convert sets to lists for JSON serialization
    return {
        category: {k: sorted(list(v))[:5] for k, v in items.items()}
        for category, items in result.items()
    }


def _dist(p1, p2):
    if not p1 or not p2:
        return float("inf")
    return math.hypot(p1[0] - p2[0], p1[1] - p2[1])

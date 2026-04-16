import math
from ezdxf.math import Vec2


def angle_at_vertex(p1: tuple, p2: tuple, p3: tuple) -> float:
    v1 = Vec2(p1[0] - p2[0], p1[1] - p2[1])
    v2 = Vec2(p3[0] - p2[0], p3[1] - p2[1])
    dot = v1.x * v2.x + v1.y * v2.y
    mag1 = math.sqrt(v1.x**2 + v1.y**2)
    mag2 = math.sqrt(v2.x**2 + v2.y**2)
    if mag1 == 0 or mag2 == 0:
        return 0.0
    cos_angle = max(-1.0, min(1.0, dot / (mag1 * mag2)))
    return math.degrees(math.acos(cos_angle))

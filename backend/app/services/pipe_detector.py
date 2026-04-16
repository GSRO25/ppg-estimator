"""Detect pipe runs in construction drawings using OpenCV line detection."""
import cv2
import numpy as np
import logging

logger = logging.getLogger(__name__)


def detect_pipes(image_bytes: bytes) -> list[dict]:
    """Detect pipe runs using Hough line transform. Returns list of {length_px, angle, start, end}."""
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        logger.warning("Failed to decode image for pipe detection")
        return []

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 50, 150, apertureSize=3)

    # Probabilistic Hough Line Transform
    lines = cv2.HoughLinesP(
        edges,
        rho=1,
        theta=np.pi / 180,
        threshold=80,
        minLineLength=50,
        maxLineGap=10,
    )

    if lines is None:
        return []

    results = []
    for line in lines:
        x1, y1, x2, y2 = line[0]
        length_px = np.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
        angle = np.degrees(np.arctan2(y2 - y1, x2 - x1))

        # Filter: only keep lines longer than 100px (short lines are noise)
        if length_px > 100:
            results.append({
                "length_px": float(length_px),
                "angle": float(angle),
                "start": [int(x1), int(y1)],
                "end": [int(x2), int(y2)],
            })

    logger.info(f"Detected {len(results)} pipe segments")
    return results

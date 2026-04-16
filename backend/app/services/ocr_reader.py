"""Extract text annotations from drawing images using PaddleOCR."""
import logging
import re

logger = logging.getLogger(__name__)

_ocr = None


def _load_ocr():
    global _ocr
    if _ocr is not None:
        return _ocr

    try:
        from paddleocr import PaddleOCR
        _ocr = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
        logger.info("PaddleOCR loaded successfully")
        return _ocr
    except ImportError:
        logger.warning("paddleocr not installed. OCR disabled.")
        return None
    except Exception as e:
        logger.warning(f"Failed to load PaddleOCR: {e}")
        return None


# Patterns for plumbing-relevant text
PIPE_SIZE_PATTERN = re.compile(r"(?:DN|dn)\s*\d+|(?:\d+)\s*mm", re.IGNORECASE)
SCALE_PATTERN = re.compile(r"(?:SCALE\s*)?1\s*:\s*(\d+)", re.IGNORECASE)


def read_text(image_bytes: bytes) -> list[dict]:
    """Read text from an image. Returns list of {text, confidence, bbox, is_pipe_size, is_scale}."""
    ocr = _load_ocr()
    if ocr is None:
        return []

    import numpy as np

    nparr = np.frombuffer(image_bytes, np.uint8)
    import cv2
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        return []

    result = ocr.ocr(img, cls=True)
    if not result or not result[0]:
        return []

    texts = []
    for line in result[0]:
        bbox, (text, confidence) = line
        texts.append({
            "text": text,
            "confidence": float(confidence),
            "bbox": bbox,
            "is_pipe_size": bool(PIPE_SIZE_PATTERN.search(text)),
            "is_scale": bool(SCALE_PATTERN.search(text)),
        })

    return texts

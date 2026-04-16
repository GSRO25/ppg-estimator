"""Detect plumbing fixture symbols in drawing images using YOLOv8."""
import os
import logging

logger = logging.getLogger(__name__)

# Plumbing symbol classes the model should detect
PLUMBING_CLASSES = [
    "WC", "basin", "shower", "floor_waste", "urinal", "sink",
    "HWS", "backflow_preventer", "TMV", "RPZ", "booster",
]

_model = None


def _load_model():
    global _model
    if _model is not None:
        return _model

    model_path = os.environ.get("YOLO_MODEL_PATH", "/app/models/plumbing_symbols.pt")

    if not os.path.exists(model_path):
        logger.warning(f"YOLOv8 model not found at {model_path}. Symbol detection disabled.")
        return None

    try:
        from ultralytics import YOLO
        _model = YOLO(model_path)
        logger.info(f"Loaded YOLOv8 model from {model_path}")
        return _model
    except ImportError:
        logger.warning("ultralytics not installed. Symbol detection disabled.")
        return None
    except Exception as e:
        logger.warning(f"Failed to load YOLOv8 model: {e}")
        return None


def detect_symbols(image_bytes: bytes, confidence_threshold: float = 0.25) -> list[dict]:
    """Detect plumbing symbols in an image. Returns list of {class_name, confidence, bbox}."""
    model = _load_model()
    if model is None:
        return []

    import numpy as np
    from PIL import Image
    import io

    img = Image.open(io.BytesIO(image_bytes))
    results = model.predict(source=img, conf=confidence_threshold, verbose=False)

    detections = []
    for result in results:
        for box in result.boxes:
            cls_id = int(box.cls[0])
            cls_name = result.names.get(cls_id, f"class_{cls_id}")
            detections.append({
                "class_name": cls_name,
                "confidence": float(box.conf[0]),
                "bbox": box.xyxy[0].tolist(),
            })
    return detections

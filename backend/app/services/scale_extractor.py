"""Extract drawing scale to convert pixel measurements to real-world units."""
import re
import logging

logger = logging.getLogger(__name__)

SCALE_PATTERN = re.compile(r"1\s*:\s*(\d+)")

# Standard paper sizes in mm
PAPER_SIZES = {
    "A1": (841, 594),
    "A3": (420, 297),
}


def extract_scale_from_ocr(ocr_results: list[dict]) -> float | None:
    """Extract scale factor (pixels per metre) from OCR results.
    Returns None if scale cannot be determined."""
    for item in ocr_results:
        if item.get("is_scale"):
            match = SCALE_PATTERN.search(item["text"])
            if match:
                scale_denominator = int(match.group(1))
                logger.info(f"Found scale 1:{scale_denominator}")
                return scale_denominator
    return None


def pixels_to_metres(length_px: float, scale_denominator: int, dpi: int = 300, paper_size: str = "A1") -> float:
    """Convert pixel length to real-world metres given drawing scale and render DPI."""
    paper_width_mm = PAPER_SIZES.get(paper_size, PAPER_SIZES["A1"])[0]
    paper_width_px = paper_width_mm * dpi / 25.4
    mm_per_pixel = paper_width_mm / paper_width_px
    real_mm = length_px * mm_per_pixel * scale_denominator
    return real_mm / 1000  # mm to metres

from app.services.scale_extractor import extract_scale_from_ocr, pixels_to_metres


def test_extracts_scale_from_ocr():
    ocr_results = [
        {"text": "GROUND FLOOR", "is_scale": False},
        {"text": "SCALE 1:100", "is_scale": True},
    ]
    assert extract_scale_from_ocr(ocr_results) == 100


def test_returns_none_when_no_scale():
    ocr_results = [{"text": "GROUND FLOOR", "is_scale": False}]
    assert extract_scale_from_ocr(ocr_results) is None


def test_pixels_to_metres_1_100():
    # At 1:100 scale, a line spanning the full width of A1 (841mm) at 300 DPI
    # Paper width in pixels = 841 * 300 / 25.4 ≈ 9933 px
    # Each pixel = 841mm / 9933px * 100 = 8.47mm real-world
    # So 1000px ≈ 8.47m
    result = pixels_to_metres(1000, scale_denominator=100, dpi=300, paper_size="A1")
    assert 8.0 < result < 9.0  # approximately 8.47m

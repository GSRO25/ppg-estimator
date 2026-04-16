"""PDF vision extraction endpoint."""
import os
import tempfile
import logging
from fastapi import APIRouter, UploadFile, File, HTTPException
from app.models.extraction import (
    ExtractionResult, ExtractedFixture, ExtractedPipe,
    ExtractedAnnotation, LayerSummary,
)
from app.services.pdf_renderer import render_pdf_pages
from app.services.symbol_detector import detect_symbols
from app.services.pipe_detector import detect_pipes
from app.services.ocr_reader import read_text
from app.services.scale_extractor import extract_scale_from_ocr, pixels_to_metres

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/extract/pdf", response_model=ExtractionResult)
async def extract_pdf(file: UploadFile = File(...)):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext != ".pdf":
        raise HTTPException(400, f"Expected .pdf, got {ext}")

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        warnings: list[str] = []
        all_fixtures: dict[str, int] = {}
        all_pipes: list[ExtractedPipe] = []
        all_annotations: list[ExtractedAnnotation] = []
        scale_denominator: int | None = None

        for page_name, png_bytes in render_pdf_pages(tmp_path):
            # Symbol detection
            symbols = detect_symbols(png_bytes)
            if not symbols:
                warnings.append(f"{page_name}: No symbols detected (model may not be loaded)")

            for sym in symbols:
                name = sym["class_name"]
                all_fixtures[name] = all_fixtures.get(name, 0) + 1

            # OCR
            ocr_results = read_text(png_bytes)
            for text_item in ocr_results:
                all_annotations.append(ExtractedAnnotation(
                    text=text_item["text"],
                    layer="PDF",
                    position=(0, 0),  # PDF doesn't have layer concept
                ))

            # Scale extraction (from first page that has it)
            if scale_denominator is None:
                sd = extract_scale_from_ocr(ocr_results)
                if sd:
                    scale_denominator = sd

            # Pipe detection
            pipe_segments = detect_pipes(png_bytes)
            total_length_px = sum(p["length_px"] for p in pipe_segments)

            if total_length_px > 0:
                if scale_denominator:
                    total_length_m = pixels_to_metres(total_length_px, scale_denominator)
                else:
                    total_length_m = total_length_px / 100  # rough fallback
                    warnings.append(f"{page_name}: Scale not detected, using approximate conversion")

                all_pipes.append(ExtractedPipe(
                    layer="PDF",
                    service_type="unknown",
                    total_length_m=round(total_length_m, 2),
                    segment_count=len(pipe_segments),
                    confidence="medium",
                ))

        fixtures = [
            ExtractedFixture(
                block_name=name,
                count=count,
                layer="PDF",
                locations=[],
                confidence="medium",
            )
            for name, count in all_fixtures.items()
        ]

        return ExtractionResult(
            filename=file.filename or "unknown.pdf",
            format="pdf",
            units="estimated",
            layers=[LayerSummary(name="PDF", entity_count=0, color=0)],
            fixtures=fixtures,
            pipes=all_pipes,
            fittings=[],
            annotations=all_annotations,
            warnings=warnings,
        )
    finally:
        os.unlink(tmp_path)

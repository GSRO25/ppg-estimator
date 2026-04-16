"""Test PDF renderer with a programmatically created PDF."""
import fitz
import os
import tempfile
from app.services.pdf_renderer import render_pdf_pages


def test_renders_pdf_pages():
    # Create a simple test PDF
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)  # A4
    page.insert_text((100, 100), "DN100 PVC PIPE", fontsize=12)
    page.draw_circle((300, 400), 20)  # represents a fixture
    page.draw_line((50, 500), (500, 500))  # represents a pipe

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp_path = tmp.name
    # Close the file handle before PyMuPDF writes (required on Windows)
    doc.save(tmp_path)
    doc.close()

    try:
        pages = list(render_pdf_pages(tmp_path))
        assert len(pages) == 1
        name, png_bytes = pages[0]
        assert name == "page_1"
        assert len(png_bytes) > 0
        # Verify it's a PNG (magic bytes)
        assert png_bytes[:4] == b'\x89PNG'
    finally:
        os.unlink(tmp_path)


def test_renders_multiple_pages():
    doc = fitz.open()
    for i in range(3):
        page = doc.new_page()
        page.insert_text((100, 100), f"Page {i+1}")

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp_path = tmp.name
    # Close the file handle before PyMuPDF writes (required on Windows)
    doc.save(tmp_path)
    doc.close()

    try:
        pages = list(render_pdf_pages(tmp_path))
        assert len(pages) == 3
    finally:
        os.unlink(tmp_path)

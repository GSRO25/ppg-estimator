"""Render PDF pages to high-resolution images for AI analysis."""
import fitz  # PyMuPDF
from typing import Generator

DPI = 300
MATRIX = fitz.Matrix(DPI / 72, DPI / 72)


def render_pdf_pages(file_path: str) -> Generator[tuple[str, bytes], None, None]:
    """Yield (page_name, png_bytes) for each page in the PDF."""
    doc = fitz.open(file_path)
    try:
        for page_num in range(len(doc)):
            page = doc[page_num]
            pix = page.get_pixmap(matrix=MATRIX)
            png_bytes = pix.tobytes("png")
            yield f"page_{page_num + 1}", png_bytes
    finally:
        doc.close()


def render_pdf_page_to_array(file_path: str, page_num: int = 0):
    """Render a single page to a numpy array (for OpenCV processing)."""
    import numpy as np

    doc = fitz.open(file_path)
    try:
        page = doc[page_num]
        pix = page.get_pixmap(matrix=MATRIX)
        img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
        if pix.n == 4:  # RGBA → RGB
            img = img[:, :, :3]
        return img
    finally:
        doc.close()

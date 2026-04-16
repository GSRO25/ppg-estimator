import os
import tempfile
from fastapi import APIRouter, UploadFile, File, HTTPException
from app.services.dwg_parser import parse_drawing
from app.models.extraction import ExtractionResult

router = APIRouter()


@router.post("/extract/dwg", response_model=ExtractionResult)
async def extract_dwg(file: UploadFile = File(...)):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in {".dwg", ".dxf"}:
        raise HTTPException(400, f"Expected .dwg or .dxf, got {ext}")

    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        result = parse_drawing(tmp_path)
        return result
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        os.unlink(tmp_path)

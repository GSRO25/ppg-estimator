from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from app.routers import health, extraction, vision
import os

app = FastAPI(title="PPG Extraction API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, tags=["health"])
app.include_router(extraction.router, tags=["extraction"])
app.include_router(vision.router, tags=["vision"])


@app.post("/extract")
async def extract_universal(file: UploadFile = File(...)):
    """Universal extraction endpoint — routes to DWG or PDF parser based on file extension."""
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext in {".dwg", ".dxf"}:
        from app.routers.extraction import extract_dwg
        return await extract_dwg(file)
    elif ext == ".pdf":
        from app.routers.vision import extract_pdf
        return await extract_pdf(file)
    else:
        raise HTTPException(400, f"Unsupported format: {ext}. Expected .dwg, .dxf, or .pdf")

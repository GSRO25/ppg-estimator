from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import health, extraction

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

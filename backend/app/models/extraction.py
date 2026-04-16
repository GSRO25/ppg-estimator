from pydantic import BaseModel
from typing import Optional


class ExtractedFixture(BaseModel):
    block_name: str
    count: int
    layer: str
    locations: list[tuple[float, float]]
    confidence: str = "high"


class ExtractedPipe(BaseModel):
    layer: str
    service_type: str
    pipe_size: Optional[str] = None
    total_length_m: float
    segment_count: int
    confidence: str = "high"


class ExtractedFitting(BaseModel):
    fitting_type: str  # "elbow_90", "elbow_45", "tee", "junction"
    layer: str
    service_type: str
    count: int
    confidence: str = "high"


class ExtractedAnnotation(BaseModel):
    text: str
    layer: str
    position: tuple[float, float]


class LayerSummary(BaseModel):
    name: str
    entity_count: int
    color: int


class ExtractionResult(BaseModel):
    filename: str
    format: str
    units: str
    layers: list[LayerSummary]
    fixtures: list[ExtractedFixture]
    pipes: list[ExtractedPipe]
    fittings: list[ExtractedFitting]
    annotations: list[ExtractedAnnotation]
    warnings: list[str] = []

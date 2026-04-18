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
    # Line segments in drawing coords: [[[x1,y1],[x2,y2]], ...]
    segments: list[list[tuple[float, float]]] = []
    confidence: str = "high"


class ExtractedFitting(BaseModel):
    fitting_type: str  # "elbow_90", "elbow_45", "tee", "junction"
    layer: str
    service_type: str
    count: int
    # Positions where fittings were detected
    positions: list[tuple[float, float]] = []
    confidence: str = "high"


class ExtractedAnnotation(BaseModel):
    text: str
    layer: str
    position: tuple[float, float]


class LayerSummary(BaseModel):
    name: str
    entity_count: int
    color: int


class DrawingBounds(BaseModel):
    min_x: float
    min_y: float
    max_x: float
    max_y: float


class ExtractionResult(BaseModel):
    filename: str
    format: str
    units: str
    layers: list[LayerSummary]
    fixtures: list[ExtractedFixture]
    pipes: list[ExtractedPipe]
    fittings: list[ExtractedFitting]
    annotations: list[ExtractedAnnotation]
    bounds: Optional[DrawingBounds] = None
    warnings: list[str] = []
    # Optional SVG backdrop rendered from the source DXF/DWG via ezdxf's drawing addon.
    # Embedded behind extracted elements in the viewer to give walls/text/hatches context.
    svg_backdrop: Optional[str] = None
    # PR3: spatial association of nearby annotations to fixtures/pipes/fittings.
    # Shape: {"fixtures": {block_name: [text...]}, "pipes": {layer|service: [...]}, "fittings": {...}}
    annotation_context: Optional[dict] = None
    # PR3: LLM-parsed legend, schedule tables, and general notes from drawing annotations.
    # Shape: {"legend": [...], "schedules": [...], "notes": [...], "error"?: str, "skipped_reason"?: str}
    legend_data: Optional[dict] = None

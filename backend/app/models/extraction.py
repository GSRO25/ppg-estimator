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
    # Where the text came from. Helps the firm-detector weight title-block
    # sources higher than random model-space labels:
    #   "modelspace" — TEXT/MTEXT entity in model space (previous default)
    #   "paperspace" — TEXT/MTEXT on a sheet layout (often contains title block)
    #   "block_attribute" — an ATTDEF value on an INSERT block (classic
    #                       title-block pattern: single INSERT of a block
    #                       named TBLK with fields like DRAWN_BY, FIRM_NAME)
    #   "header" — DXF file metadata ($COMPANY, $AUTHOR, $LASTSAVEDBY)
    source: str = "modelspace"


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
    # True extents of the entire DXF/DWG drawing (from $EXTMIN/$EXTMAX), not just
    # the extracted subset. Needed to align the SVG backdrop, which spans the
    # full drawing and must not be shrunk into the narrower extracted bounds.
    drawing_extents: Optional[DrawingBounds] = None
    warnings: list[str] = []
    # Optional SVG backdrop rendered from the source DXF/DWG via ezdxf's drawing addon.
    # Embedded behind extracted elements in the viewer to give walls/text/hatches context.
    svg_backdrop: Optional[str] = None
    # viewBox of the raw ezdxf-emitted <svg> — used by the frontend to build
    # a matrix transform that maps ezdxf's internal page coords to CAD coords.
    # Shape: [x, y, w, h]. Required for backdrop alignment; legacy extractions
    # without this value fall back to the older (less accurate) counter-flip.
    svg_backdrop_viewbox: Optional[list[float]] = None
    # PR3: spatial association of nearby annotations to fixtures/pipes/fittings.
    # Shape: {"fixtures": {block_name: [text...]}, "pipes": {layer|service: [...]}, "fittings": {...}}
    annotation_context: Optional[dict] = None
    # PR3: LLM-parsed legend, schedule tables, and general notes from drawing annotations.
    # Shape: {"legend": [...], "schedules": [...], "notes": [...], "error"?: str, "skipped_reason"?: str}
    legend_data: Optional[dict] = None

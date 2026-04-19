'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Pt = [number, number];

interface DrawingGeometry {
  drawing_id: number;
  filename: string;
  bounds: { min_x: number; min_y: number; max_x: number; max_y: number } | null;
  fixtures: { block_name: string; layer: string; locations: Pt[] }[];
  pipes: { layer: string; service_type: string; segments: [Pt, Pt][] }[];
  fittings: { layer: string; fitting_type: string; positions: Pt[] }[];
  layers?: string[];
  svg_backdrop?: string | null;
  svg_backdrop_viewbox?: [number, number, number, number] | null;
  drawing_extents?: { min_x: number; min_y: number; max_x: number; max_y: number } | null;
}

// drawing_region stored on takeoff_items
export type Highlight =
  | { type: 'fixture'; block_name: string; locations: Pt[] }
  | { type: 'pipe'; layer: string; segments: [Pt, Pt][] }
  | { type: 'fitting'; layer: string; positions: Pt[] };

// Currently-selected entity in the viewer (visual-only, separate from
// the parent's editingRow state).
type SelectedEntity =
  | { kind: 'fixture'; block_name: string; layer: string; location: Pt }
  | { kind: 'pipe'; layer: string; service_type: string; segment: [Pt, Pt]; length: number }
  | { kind: 'fitting'; fitting_type: string; layer: string; position: Pt };

export interface TooltipRow {
  description: string;
  uom: string;
  final_qty: number;
  labour_rate: number | null;
  material_rate: number | null;
  rate_card_item_id: number | null;
}

interface Props {
  drawingId: number;
  highlight: Highlight | null;
  onClose?: () => void;
  mode?: 'modal' | 'inline';
  onHoverRegion?: (region: { type: string; key: string } | null) => void;
  onClickRegion?: (region: { type: string; key: string }) => void;
  hoveredRegion?: { type: string; key: string } | null;
  tooltipRow?: TooltipRow | null;
}

// Strip outer <svg ...>...</svg> wrapper so we can embed the backdrop
// content as children of our own SVG element while keeping its inner geometry.
function extractSvgInner(svg: string): string {
  return svg.replace(/^[\s\S]*?<svg[^>]*>/i, '').replace(/<\/svg>\s*$/i, '');
}

// Convert a layer name into a CSS-safe class fragment. ezdxf's SVGBackend
// emits layer groups; matching by data-attribute or class is fragile across
// versions, so we scope our hide rules with attribute selectors below.
function cssEscape(name: string): string {
  return name.replace(/(["\\])/g, '\\$1');
}

// Map service type / layer name / block name to a semantic colour.
// Checked in order; first match wins.
function getServiceColor(serviceType?: string, layer?: string, extra?: string): string {
  const t = [serviceType, layer, extra].filter(Boolean).join(' ').toLowerCase();
  if (/fire|sprinkler|hydrant|hose\s*reel|fhd|fhr/.test(t))          return '#ef4444'; // red
  if (/cold.?water|cws|domestic|potable|water.?supply|chilled/.test(t)) return '#3b82f6'; // blue
  if (/hot.?water|hws|heated|solar|thermostatic/.test(t))              return '#f97316'; // orange
  if (/drain|sewer|waste|sanit|soil|vent|stormwater/.test(t))          return '#92400e'; // brown
  if (/gas/.test(t))                                                    return '#ca8a04'; // amber
  if (/fitout|fixture|fitment/.test(t))                                 return '#22c55e'; // green
  return '#94a3b8'; // default slate
}

function formatDistance(d: number): string {
  if (!isFinite(d)) return '';
  if (d < 1000) return `${d.toFixed(0)} mm`;
  return `${(d / 1000).toFixed(2)} m`;
}

function formatCoord(p: Pt | undefined | null): string {
  if (!p) return '';
  return `X: ${Math.round(p[0])}, Y: ${Math.round(p[1])}`;
}

// Find the closest snap candidate to the cursor within a given CAD-unit
// radius. Returns null when nothing is within range.
function findSnapPoint(cursor: Pt, candidates: Pt[], radiusCad: number): Pt | null {
  let best: Pt | null = null;
  let bestDist = radiusCad;
  for (const c of candidates) {
    const d = Math.hypot(c[0] - cursor[0], c[1] - cursor[1]);
    if (d < bestDist) { best = c; bestDist = d; }
  }
  return best;
}

// Inline toolbar button — small square with active state.
function ToolBtn({ active, onClick, title, children }: { active: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`w-8 h-8 flex items-center justify-center text-sm rounded ${active ? 'bg-ppg-amber text-white' : 'hover:bg-slate-100 text-slate-700'}`}
    >{children}</button>
  );
}

export default function DrawingViewer({
  drawingId,
  highlight,
  onClose,
  mode = 'modal',
  onHoverRegion,
  onClickRegion,
  hoveredRegion = null,
  tooltipRow = null,
}: Props) {
  const [geom, setGeom] = useState<DrawingGeometry | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const [viewBox, setViewBox] = useState<string>('');
  const panState = useRef<{ dragging: boolean; lastX: number; lastY: number; vb: number[]; didDrag: boolean; startX: number; startY: number }>({
    dragging: false, lastX: 0, lastY: 0, vb: [0, 0, 0, 0], didDrag: false, startX: 0, startY: 0,
  });

  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set());
  const [showBackdrop, setShowBackdrop] = useState(true);
  const [showLayerPanel, setShowLayerPanel] = useState(false);
  const [measureMode, setMeasureMode] = useState(false);
  const [measurePoints, setMeasurePoints] = useState<Pt[]>([]);
  const [cursorCad, setCursorCad] = useState<Pt | null>(null);
  const [snapPoint, setSnapPoint] = useState<Pt | null>(null);
  const [selected, setSelected] = useState<SelectedEntity | null>(null);

  useEffect(() => {
    fetch(`/api/drawings/${drawingId}/geometry`)
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(setGeom)
      .catch(e => setErr(String(e)));
  }, [drawingId]);

  // Hard limits for panning — use drawing_extents when available (full sheet),
  // fall back to geometry bounds. Used by clampVB to stop the user from
  // scrolling completely off the drawing.
  const panLimits = useMemo(() => geom?.drawing_extents ?? geom?.bounds ?? null, [geom]);

  // Clamp a viewBox so its centre stays within the drawing limits.
  // This prevents panning the drawing completely off-screen.
  const clampVB = useCallback((vb: number[]): number[] => {
    if (!panLimits) return vb;
    const [x, y, w, h] = vb;
    const cx = Math.max(panLimits.min_x, Math.min(panLimits.max_x, x + w / 2));
    const cy = Math.max(panLimits.min_y, Math.min(panLimits.max_y, y + h / 2));
    return [cx - w / 2, cy - h / 2, w, h];
  }, [panLimits]);

  // Initial viewBox — fit to extracted geometry bounds so the drawing fills
  // the viewport on load. (drawing_extents can be the full DXF paper space
  // which is far larger than the actual content, leaving the drawing tiny.)
  useEffect(() => {
    if (!geom) return;
    const b = geom.bounds;
    if (!b) return;
    const w = b.max_x - b.min_x;
    const h = b.max_y - b.min_y;
    const pad = Math.max(w, h) * 0.05;
    const vb = [b.min_x - pad, b.min_y - pad, w + pad * 2, h + pad * 2];
    setViewBox(vb.join(' '));
    panState.current.vb = vb;
  }, [geom]);

  // Fit geometry bounds (E key).
  const zoomExtents = useCallback(() => {
    const b = geom?.bounds;
    if (!b) return;
    const w = b.max_x - b.min_x;
    const h = b.max_y - b.min_y;
    const pad = Math.max(w, h) * 0.05;
    const vb = [b.min_x - pad, b.min_y - pad, w + pad * 2, h + pad * 2];
    setViewBox(vb.join(' '));
    panState.current.vb = vb;
  }, [geom]);

  const toggleMeasure = useCallback(() => {
    setMeasureMode(m => !m);
    setMeasurePoints([]);
    setSnapPoint(null);
  }, []);

  const clearSelection = useCallback(() => {
    setSelected(null);
  }, []);

  // Keyboard:
  //   M  → toggle measure
  //   E  → zoom-extents
  //   Esc → cancel measure first; otherwise clear selection.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        toggleMeasure();
      } else if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        zoomExtents();
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        setShowLayerPanel(v => !v);
      } else if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        setShowBackdrop(v => !v);
      } else if (e.key === 'Escape') {
        if (measureMode || measurePoints.length > 0) {
          setMeasureMode(false);
          setMeasurePoints([]);
          setSnapPoint(null);
        } else if (selected) {
          setSelected(null);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [measureMode, measurePoints.length, selected, toggleMeasure, zoomExtents]);

  // Convert a screen-space mouse event to CAD-space coordinates, accounting
  // for the Y-flip transform applied to the inner <g>.
  const screenToCad = useCallback((clientX: number, clientY: number): Pt | null => {
    const svg = svgRef.current;
    if (!svg || !geom?.bounds) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const p = pt.matrixTransform(ctm.inverse());
    // Inner group transform: translate(0, min_y+max_y) scale(1,-1)
    // So CAD x = svg x; CAD y = (min_y+max_y) - svg y
    const cadX = p.x;
    const cadY = (geom.bounds.min_y + geom.bounds.max_y) - p.y;
    return [cadX, cadY];
  }, [geom]);

  // Build the snap-candidate list (visible fixtures, pipe endpoints +
  // midpoints, fittings) — recomputed when geometry or layer visibility
  // changes. Cheap enough at typical drawing sizes.
  const snapCandidates = useMemo<Pt[]>(() => {
    if (!geom) return [];
    const out: Pt[] = [];
    for (const f of geom.fixtures) {
      if (hiddenLayers.has(f.layer)) continue;
      for (const loc of f.locations) out.push(loc);
    }
    for (const p of geom.pipes) {
      if (hiddenLayers.has(p.layer)) continue;
      for (const s of p.segments) {
        out.push(s[0]);
        out.push(s[1]);
        out.push([(s[0][0] + s[1][0]) / 2, (s[0][1] + s[1][1]) / 2]);
      }
    }
    for (const f of geom.fittings) {
      if (hiddenLayers.has(f.layer)) continue;
      for (const pos of f.positions || []) out.push(pos);
    }
    return out;
  }, [geom, hiddenLayers]);

  // Zoom with mouse wheel
  function handleWheel(e: React.WheelEvent<SVGSVGElement>) {
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    const [x, y, w, h] = viewBox.split(' ').map(Number);
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const cursor = pt.matrixTransform(ctm.inverse());
    const scale = e.deltaY > 0 ? 1.2 : 1 / 1.2;
    const nw = w * scale;
    const nh = h * scale;
    const nx = cursor.x - (cursor.x - x) * scale;
    const ny = cursor.y - (cursor.y - y) * scale;
    const next = clampVB([nx, ny, nw, nh]);
    panState.current.vb = next;
    setViewBox(next.join(' '));
  }

  function handleMouseDown(e: React.MouseEvent<SVGSVGElement>) {
    if (measureMode) return; // measure handles clicks; suppress pan-drag
    panState.current.dragging = true;
    panState.current.lastX = e.clientX;
    panState.current.lastY = e.clientY;
    panState.current.startX = e.clientX;
    panState.current.startY = e.clientY;
    panState.current.didDrag = false;
    panState.current.vb = viewBox.split(' ').map(Number);
  }
  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    // Always keep the live cursor coord up-to-date for the readout badge.
    const cad = screenToCad(e.clientX, e.clientY);
    setCursorCad(cad);

    // Track screen position for tooltip
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }

    if (measureMode) {
      // Compute the snap radius in CAD units = ~10 screen pixels, derived
      // from the current viewBox width vs. SVG client width.
      const svg = svgRef.current;
      if (svg && cad) {
        const rect = svg.getBoundingClientRect();
        const vb = panState.current.vb;
        const cadPerPx = (vb && vb[2] && rect.width) ? (vb[2] / rect.width) : 1;
        const radiusCad = cadPerPx * 10;
        const snap = findSnapPoint(cad, snapCandidates, radiusCad);
        setSnapPoint(snap);
      } else {
        setSnapPoint(null);
      }
      return;
    }
    if (!panState.current.dragging) return;
    const svg = svgRef.current;
    if (!svg) return;
    const dist = Math.hypot(e.clientX - panState.current.startX, e.clientY - panState.current.startY);
    if (dist > 4) panState.current.didDrag = true;
    const dx = e.clientX - panState.current.lastX;
    const dy = e.clientY - panState.current.lastY;
    const rect = svg.getBoundingClientRect();
    const [x, y, w, h] = panState.current.vb;
    const nx = x - (dx / rect.width) * w;
    const ny = y - (dy / rect.height) * h;
    const next = clampVB([nx, ny, w, h]);
    panState.current.vb = next;
    setViewBox(next.join(' '));
  }
  function handleMouseUp() {
    panState.current.dragging = false;
  }
  function handleMouseLeave() {
    panState.current.dragging = false;
    setCursorCad(null);
    setSnapPoint(null);
    setTooltipPos(null);
  }

  function handleSvgClick(e: React.MouseEvent<SVGSVGElement>) {
    if (!measureMode) return;
    const cad = screenToCad(e.clientX, e.clientY);
    if (!cad) return;
    // Prefer the snapped coordinate when available so users get exact
    // endpoints/midpoints rather than free-cursor positions.
    const point: Pt = snapPoint ?? cad;
    setMeasurePoints(pts => {
      if (pts.length === 0 || pts.length >= 2) return [point];
      return [pts[0], point];
    });
  }

  function toggleLayer(name: string) {
    setHiddenLayers(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  const bounds = geom?.bounds;
  const pointRadius = useMemo(() => {
    if (!bounds) return 1;
    const span = Math.max(bounds.max_x - bounds.min_x, bounds.max_y - bounds.min_y);
    return span * 0.003;
  }, [bounds]);

  const strokeBase = useMemo(() => {
    if (!bounds) return 1;
    return Math.max(bounds.max_x - bounds.min_x, bounds.max_y - bounds.min_y) * 0.0005;
  }, [bounds]);

  // Snap indicator size in CAD units = ~6 screen pixels at current zoom.
  const snapBoxHalf = useMemo(() => {
    const svg = svgRef.current;
    if (!svg || !viewBox) return pointRadius;
    const rect = svg.getBoundingClientRect();
    const vb = viewBox.split(' ').map(Number);
    const cadPerPx = (vb[2] && rect.width) ? (vb[2] / rect.width) : 1;
    return cadPerPx * 3; // 6px wide => half is 3px
  }, [viewBox, pointRadius]);

  const isInline = mode === 'inline';

  // Memoize the inner backdrop markup so we only parse/strip the SVG string
  // once per geometry load, not on every render.
  const backdropInner = useMemo(() => {
    if (!geom?.svg_backdrop) return null;
    return extractSvgInner(geom.svg_backdrop);
  }, [geom?.svg_backdrop]);

  // Build a CSS rule string that hides matching layer groups in the backdrop.
  // ezdxf 1.x emits layer groups carrying the layer name; we match defensively
  // on common attributes (`data-layer`, `class`, and `id`) to cover variants.
  const backdropHideCss = useMemo(() => {
    if (hiddenLayers.size === 0) return '';
    return Array.from(hiddenLayers).map(name => {
      const safe = cssEscape(name);
      return `.backdrop [data-layer="${safe}"], `
        + `.backdrop g[id="${safe}"], `
        + `.backdrop g.${name.replace(/[^A-Za-z0-9_-]/g, '_')} `
        + `{ display: none !important; }`;
    }).join('\n');
  }, [hiddenLayers]);

  const visibleFixtures = useMemo(
    () => (geom?.fixtures || []).filter(f => !hiddenLayers.has(f.layer)),
    [geom, hiddenLayers],
  );
  const visiblePipes = useMemo(
    () => (geom?.pipes || []).filter(p => !hiddenLayers.has(p.layer)),
    [geom, hiddenLayers],
  );
  const visibleFittings = useMemo(
    () => (geom?.fittings || []).filter(f => !hiddenLayers.has(f.layer)),
    [geom, hiddenLayers],
  );

  // The point used for distance display: prefer snap > free cursor.
  const liveEndpoint: Pt | null = snapPoint ?? cursorCad;
  const measureDist = measurePoints.length === 2
    ? Math.hypot(measurePoints[1][0] - measurePoints[0][0], measurePoints[1][1] - measurePoints[0][1])
    : (measurePoints.length === 1 && liveEndpoint
        ? Math.hypot(liveEndpoint[0] - measurePoints[0][0], liveEndpoint[1] - measurePoints[0][1])
        : 0);

  const cursorClass = measureMode ? 'cursor-crosshair' : 'cursor-move';

  // Display position for the properties panel; varies by selected kind.
  const selectedDisplayPos: Pt | null =
    selected?.kind === 'fixture' ? selected.location
    : selected?.kind === 'pipe' ? selected.segment[0]
    : selected?.kind === 'fitting' ? selected.position
    : null;

  return (
    <div className={isInline ? 'flex flex-col w-full h-full' : 'fixed inset-0 z-[60] flex flex-col bg-white'}>
      {!isInline && (
        <div className="flex justify-between items-center px-5 py-3 border-b">
          <div>
            <div className="text-xs text-gray-400 uppercase">Drawing</div>
            <div className="text-sm font-semibold text-gray-900">{geom?.filename || `Drawing #${drawingId}`}</div>
            {highlight && (
              <div className="text-xs text-gray-500 mt-0.5">
                Highlighting: {highlight.type === 'fixture'
                  ? `${highlight.block_name} · ${highlight.locations.length} locations`
                  : highlight.type === 'pipe'
                    ? `${highlight.layer} · ${highlight.segments.length} segments`
                    : `${highlight.layer} · ${highlight.positions.length} fittings`}
              </div>
            )}
          </div>
          <div className="flex gap-3 items-center">
            <span className="text-xs text-gray-400">Scroll to zoom · drag to pan · M measure · E fit · Esc clear</span>
            <button onClick={() => onClose?.()} className="px-3 py-1.5 text-sm rounded bg-gray-100 hover:bg-gray-200">Close</button>
          </div>
        </div>
      )}

      <div ref={containerRef} className={`relative flex-1 overflow-hidden ${isInline ? 'bg-slate-900' : 'bg-slate-50'}`}>
        {err && <div className="p-8 text-sm text-red-500">Failed to load: {err}</div>}
        {!geom && !err && <div className="p-8 text-sm text-gray-400">Loading drawing…</div>}
        {geom && !bounds && <div className="p-8 text-sm text-gray-400">No geometry available for this drawing.</div>}
        {geom && bounds && viewBox && (
          <svg
            ref={svgRef}
            viewBox={viewBox}
            preserveAspectRatio="xMidYMid meet"
            className={`w-full h-full ${cursorClass}`}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
            onClick={handleSvgClick}
          >
            {backdropHideCss && <style>{backdropHideCss}</style>}
            {/* Flip Y axis so drawing orientation matches CAD conventions */}
            <g transform={`translate(0, ${bounds.min_y + bounds.max_y}) scale(1, -1)`}>
              {/* Backdrop SVG from ezdxf — placed first so it sits behind everything else.
                  Faded so the extracted/interactive layer reads on top.

                  ezdxf's SVGBackend emits its content in its own internal page
                  coords (Y-down) inside a viewBox that does NOT match CAD
                  coords. To align with extracted geometry we derive a matrix
                  transform from the viewBox + CAD bounds that maps ezdxf-space
                  into CAD-space (Y-up). The outer Y-flip group then mirrors
                  both backdrop and extracted geometry together so the text
                  reads correctly. */}
              {backdropInner && showBackdrop && (() => {
                const vb = geom?.svg_backdrop_viewbox;
                if (vb && vb.length === 4) {
                  const [vx, vy, vw, vh] = vb;
                  const cadW = bounds.max_x - bounds.min_x;
                  const cadH = bounds.max_y - bounds.min_y;
                  if (vw > 0 && vh > 0 && cadW > 0 && cadH > 0) {
                    // The backdrop covers the FULL drawing (title block, walls,
                    // everything ezdxf rendered). `bounds` is only the extracted
                    // subset, so we must scale the backdrop to match the true
                    // drawing extents from the DXF header. Without this the
                    // backdrop gets shrunk into the narrower extracted bounds.
                    const ext = geom?.drawing_extents ?? bounds;
                    const extW = ext.max_x - ext.min_x;
                    const extH = ext.max_y - ext.min_y;
                    const sx = extW / vw;
                    const sy = extH / vh;
                    // Map viewBox(vx, vy) → (ext.min_x, ext.max_y) with Y-flip
                    // (ezdxf Y-down → CAD Y-up).
                    const tx = ext.min_x - vx * sx;
                    const ty = ext.max_y + vy * sy;
                    return (
                      <g transform={`matrix(${sx}, 0, 0, ${-sy}, ${tx}, ${ty})`}>
                        <g
                          className="backdrop"
                          opacity={0.75}
                          style={{ pointerEvents: 'none', filter: 'invert(1) hue-rotate(180deg)' }}
                          dangerouslySetInnerHTML={{ __html: backdropInner }}
                        />
                      </g>
                    );
                  }
                }
                // Legacy fallback for extractions without svg_backdrop_viewbox:
                // use the old counter-flip so the backdrop at least renders,
                // even if it is not perfectly aligned.
                return (
                  <g transform={`scale(1, -1) translate(0, ${-(bounds.min_y + bounds.max_y)})`}>
                    <g
                      className="backdrop"
                      opacity={0.35}
                      style={{ pointerEvents: 'none' }}
                      dangerouslySetInnerHTML={{ __html: backdropInner }}
                    />
                  </g>
                );
              })()}

              {/* Bounds outline */}
              <rect
                x={bounds.min_x} y={bounds.min_y}
                width={bounds.max_x - bounds.min_x}
                height={bounds.max_y - bounds.min_y}
                fill="none" stroke="#e2e8f0" strokeWidth={strokeBase}
              />

              {/* Context: all pipes — coloured by service type */}
              {visiblePipes.flatMap(p => {
                const isHovered = hoveredRegion?.type === 'pipe' && hoveredRegion.key === p.layer;
                const baseColor = getServiceColor(p.service_type, p.layer);
                return p.segments.map((s, i) => {
                  const isSelected = selected?.kind === 'pipe' && selected.layer === p.layer
                    && selected.segment[0][0] === s[0][0] && selected.segment[0][1] === s[0][1]
                    && selected.segment[1][0] === s[1][0] && selected.segment[1][1] === s[1][1];
                  return (
                    <line
                      key={`p-${p.layer}-${i}`}
                      x1={s[0][0]} y1={s[0][1]} x2={s[1][0]} y2={s[1][1]}
                      stroke={isSelected ? '#F59E0B' : (isHovered ? '#F59E0B' : baseColor)}
                      strokeWidth={isSelected ? strokeBase * 3 : (isHovered ? strokeBase * 2 : strokeBase * 1.5)}
                      opacity={isSelected || isHovered ? 1 : 0.65}
                      className="cursor-pointer"
                      onMouseEnter={() => onHoverRegion?.({ type: 'pipe', key: p.layer })}
                      onMouseLeave={() => onHoverRegion?.(null)}
                      onClick={(e) => {
                        if (panState.current.didDrag || measureMode) return;
                        e.stopPropagation();
                        const length = Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]);
                        setSelected({ kind: 'pipe', layer: p.layer, service_type: p.service_type, segment: s, length });
                        onClickRegion?.({ type: 'pipe', key: p.layer });
                      }}
                    />
                  );
                });
              })}

              {/* Context: fixtures — coloured by layer/block */}
              {visibleFixtures.flatMap(f => {
                const baseColor = getServiceColor(undefined, f.layer, f.block_name);
                return f.locations.map((loc, i) => {
                  const isHovered = hoveredRegion?.type === 'fixture' && hoveredRegion.key === f.block_name;
                  const isSelected = selected?.kind === 'fixture' && selected.block_name === f.block_name
                    && selected.location[0] === loc[0] && selected.location[1] === loc[1];
                  return (
                    <circle
                      key={`fx-${f.block_name}-${i}`}
                      cx={loc[0]} cy={loc[1]} r={isSelected ? pointRadius * 1.4 : pointRadius}
                      fill={isSelected ? '#F59E0B' : (isHovered ? '#F59E0B' : baseColor)}
                      stroke={isSelected ? '#F59E0B' : baseColor}
                      strokeWidth={isSelected ? strokeBase * 3 : strokeBase}
                      opacity={isSelected || isHovered ? 1 : 0.65}
                      className="cursor-pointer"
                      onMouseEnter={() => onHoverRegion?.({ type: 'fixture', key: f.block_name })}
                      onMouseLeave={() => onHoverRegion?.(null)}
                      onClick={(e) => {
                        if (panState.current.didDrag || measureMode) return;
                        e.stopPropagation();
                        setSelected({ kind: 'fixture', block_name: f.block_name, layer: f.layer, location: loc });
                        onClickRegion?.({ type: 'fixture', key: f.block_name });
                      }}
                    />
                  );
                });
              })}

              {/* Context: fittings — coloured by layer/fitting_type */}
              {visibleFittings.flatMap(f => {
                const baseColor = getServiceColor(undefined, f.layer, f.fitting_type);
                return (f.positions || []).map((pos, i) => {
                  const isHovered = hoveredRegion?.type === 'fitting' && hoveredRegion.key === f.layer;
                  const isSelected = selected?.kind === 'fitting' && selected.layer === f.layer
                    && selected.position[0] === pos[0] && selected.position[1] === pos[1];
                  return (
                    <rect
                      key={`ctx-ft-${f.layer}-${i}`}
                      x={pos[0] - pointRadius} y={pos[1] - pointRadius}
                      width={pointRadius * 2} height={pointRadius * 2}
                      fill={isSelected ? '#F59E0B' : (isHovered ? '#F59E0B' : baseColor)}
                      stroke={isSelected ? '#F59E0B' : baseColor}
                      strokeWidth={isSelected ? strokeBase * 3 : strokeBase}
                      opacity={isSelected || isHovered ? 1 : 0.65}
                      className="cursor-pointer"
                      onMouseEnter={() => onHoverRegion?.({ type: 'fitting', key: f.layer })}
                      onMouseLeave={() => onHoverRegion?.(null)}
                      onClick={(e) => {
                        if (panState.current.didDrag || measureMode) return;
                        e.stopPropagation();
                        setSelected({ kind: 'fitting', fitting_type: f.fitting_type, layer: f.layer, position: pos });
                        onClickRegion?.({ type: 'fitting', key: f.layer });
                      }}
                    />
                  );
                });
              })}

              {/* Highlight layer on top */}
              {highlight?.type === 'fixture' && highlight.locations.map((loc, i) => (
                <g key={`h-fx-${i}`}>
                  <circle cx={loc[0]} cy={loc[1]} r={pointRadius * 3} fill="none" stroke="#ef4444" strokeWidth={strokeBase * 2} />
                  <circle cx={loc[0]} cy={loc[1]} r={pointRadius * 1.2} fill="#ef4444" />
                </g>
              ))}

              {highlight?.type === 'pipe' && highlight.segments.map((s, i) => (
                <line
                  key={`h-p-${i}`}
                  x1={s[0][0]} y1={s[0][1]} x2={s[1][0]} y2={s[1][1]}
                  stroke="#ef4444" strokeWidth={strokeBase * 3}
                />
              ))}

              {highlight?.type === 'fitting' && highlight.positions.map((p, i) => (
                <rect
                  key={`h-ft-${i}`}
                  x={p[0] - pointRadius * 2} y={p[1] - pointRadius * 2}
                  width={pointRadius * 4} height={pointRadius * 4}
                  fill="#ef4444" stroke="#b91c1c" strokeWidth={strokeBase}
                />
              ))}

              {/* Measure tool overlay (in CAD coords, inside Y-flipped group) */}
              {measureMode && measurePoints.length === 1 && liveEndpoint && (
                <line
                  x1={measurePoints[0][0]} y1={measurePoints[0][1]}
                  x2={liveEndpoint[0]} y2={liveEndpoint[1]}
                  stroke="#F59E0B" strokeDasharray="6 4"
                  strokeWidth={strokeBase * 1.5}
                  pointerEvents="none"
                />
              )}
              {measurePoints.length >= 1 && (
                <circle
                  cx={measurePoints[0][0]} cy={measurePoints[0][1]}
                  r={pointRadius * 1.4} fill="#F59E0B"
                  pointerEvents="none"
                />
              )}
              {measurePoints.length === 2 && (
                <>
                  <line
                    x1={measurePoints[0][0]} y1={measurePoints[0][1]}
                    x2={measurePoints[1][0]} y2={measurePoints[1][1]}
                    stroke="#F59E0B" strokeDasharray="8 4"
                    strokeWidth={strokeBase * 2}
                    pointerEvents="none"
                  />
                  <circle
                    cx={measurePoints[1][0]} cy={measurePoints[1][1]}
                    r={pointRadius * 1.4} fill="#F59E0B"
                    pointerEvents="none"
                  />
                </>
              )}

              {/* Snap indicator — small amber square at the snap target. */}
              {measureMode && snapPoint && (
                <rect
                  x={snapPoint[0] - snapBoxHalf} y={snapPoint[1] - snapBoxHalf}
                  width={snapBoxHalf * 2} height={snapBoxHalf * 2}
                  fill="none" stroke="#F59E0B" strokeWidth={strokeBase * 1.5}
                  pointerEvents="none"
                />
              )}
            </g>

            {/* Measure label rendered outside the Y-flip group so the text
                is not mirrored. Positioned in CAD-x but mirrored CAD-y. */}
            {measurePoints.length >= 1 && (measurePoints.length === 2 || liveEndpoint) && (() => {
              const a = measurePoints[0];
              const b = measurePoints.length === 2 ? measurePoints[1] : (liveEndpoint as Pt);
              const midX = (a[0] + b[0]) / 2;
              const midCadY = (a[1] + b[1]) / 2;
              // Mirror CAD-y back into SVG-y because we are outside the flipped group.
              const midSvgY = (bounds.min_y + bounds.max_y) - midCadY;
              const fontSize = Math.max(strokeBase * 24, (bounds.max_y - bounds.min_y) * 0.012);
              return (
                <text
                  x={midX} y={midSvgY - fontSize * 0.6}
                  fill="#F59E0B" fontSize={fontSize} fontWeight="bold"
                  textAnchor="middle"
                  pointerEvents="none"
                  style={{ paintOrder: 'stroke', stroke: 'white', strokeWidth: fontSize * 0.25 }}
                >
                  {formatDistance(measureDist)}
                </text>
              );
            })()}
          </svg>
        )}

        {/* Layer toggle panel — top-left */}
        {showLayerPanel && geom?.layers && geom.layers.length > 0 && (() => {
          const JUNK_PATTERNS = [/^defpoints$/i, /^0$/, /titleblock/i, /viewport/i, /^ashade$/i, /^vp/i];
          const cleanLayers = geom.layers.filter(l => !JUNK_PATTERNS.some(r => r.test(l)));
          if (cleanLayers.length === 0) return null;
          return (
          <div className="absolute top-2 left-2 bg-white/95 rounded-md shadow-md p-2 text-xs max-h-64 overflow-y-auto max-w-[220px] z-10">
            <div className="font-semibold text-slate-700 mb-1">Layers ({cleanLayers.length})</div>
            {cleanLayers.map(l => (
              <label key={l} className="flex items-center gap-1.5 py-0.5 text-slate-600 hover:text-slate-900 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!hiddenLayers.has(l)}
                  onChange={() => toggleLayer(l)}
                  className="w-3 h-3"
                />
                <span className="truncate" title={l}>{l}</span>
              </label>
            ))}
          </div>
          );
        })()}

        {/* Toolbar — top-right */}
        {geom && bounds && (
          <div className="absolute top-2 right-2 flex flex-col gap-1 items-end z-10">
            <div className="flex gap-1 bg-white/95 rounded-md shadow-md p-1">
              <ToolBtn active={false} onClick={zoomExtents} title="Zoom Extents (E)">⛶</ToolBtn>
              <ToolBtn active={measureMode} onClick={toggleMeasure} title="Measure (M)">📐</ToolBtn>
              <ToolBtn active={showLayerPanel} onClick={() => setShowLayerPanel(v => !v)} title="Toggle Layers Panel (L)">📋</ToolBtn>
              <ToolBtn active={showBackdrop} onClick={() => setShowBackdrop(v => !v)} title="Toggle Drawing Backdrop (B)">🗺️</ToolBtn>
              <ToolBtn active={false} onClick={clearSelection} title="Clear Selection (Esc)">↶</ToolBtn>
            </div>
            <div className="flex gap-2 bg-white/95 rounded-md shadow-md px-2 py-1 text-[10px] font-medium">
              {([
                ['#ef4444', 'Fire'],
                ['#3b82f6', 'Water'],
                ['#f97316', 'Hot Water'],
                ['#92400e', 'Drainage'],
                ['#ca8a04', 'Gas'],
                ['#22c55e', 'Fitout'],
                ['#94a3b8', 'Other'],
              ] as [string, string][]).map(([color, label]) => (
                <span key={label} className="flex items-center gap-1 text-slate-700">
                  <span style={{ background: color, width: 8, height: 8, borderRadius: 2, display: 'inline-block', flexShrink: 0 }} />
                  {label}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Live cursor coordinate readout — bottom-left */}
        {cursorCad && (
          <div className="absolute bottom-2 left-2 bg-white/95 rounded px-2 py-1 text-xs font-mono text-slate-600 shadow-sm z-10">
            {formatCoord(cursorCad)}
          </div>
        )}

        {/* Properties panel — bottom-right */}
        {selected && (
          <div className="absolute bottom-2 right-2 bg-white/95 rounded-md shadow-md p-3 text-xs max-w-[260px] z-10">
            <div className="flex justify-between items-center mb-2">
              <span className="font-semibold text-slate-800">Properties</span>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-slate-400 hover:text-slate-700"
                title="Close"
              >✕</button>
            </div>
            <dl className="space-y-1 text-slate-700">
              <div><dt className="inline font-medium">Type: </dt><dd className="inline">{selected.kind}</dd></div>
              <div><dt className="inline font-medium">Layer: </dt><dd className="inline">{selected.layer}</dd></div>
              {selected.kind === 'fixture' && (
                <div><dt className="inline font-medium">Block: </dt><dd className="inline">{selected.block_name}</dd></div>
              )}
              {selected.kind === 'pipe' && (
                <>
                  <div><dt className="inline font-medium">Service: </dt><dd className="inline">{selected.service_type}</dd></div>
                  <div><dt className="inline font-medium">Length: </dt><dd className="inline">{formatDistance(selected.length)}</dd></div>
                </>
              )}
              {selected.kind === 'fitting' && (
                <div><dt className="inline font-medium">Fitting: </dt><dd className="inline">{selected.fitting_type}</dd></div>
              )}
              {selectedDisplayPos && (
                <div><dt className="inline font-medium">Position: </dt><dd className="inline">{formatCoord(selectedDisplayPos)}</dd></div>
              )}
            </dl>
          </div>
        )}

        {/* Hover tooltip — shows the associated takeoff line item */}
        {tooltipRow && tooltipPos && (
          <div
            className="absolute z-30 pointer-events-none bg-white rounded-lg shadow-xl border border-slate-200 p-3 text-xs max-w-[280px]"
            style={{
              left: Math.min(tooltipPos.x + 16, (containerRef.current?.clientWidth ?? 9999) - 296),
              top: Math.max(4, tooltipPos.y - 70),
            }}
          >
            <div className="font-semibold text-slate-800 mb-1 leading-tight">{tooltipRow.description}</div>
            <div className="text-slate-500 mb-1">{tooltipRow.final_qty} {tooltipRow.uom}</div>
            <div className="flex gap-3 text-slate-600">
              <span>L: {tooltipRow.labour_rate != null ? `$${tooltipRow.labour_rate.toFixed(2)}` : '—'}</span>
              <span>M: {tooltipRow.material_rate != null ? `$${tooltipRow.material_rate.toFixed(2)}` : '—'}</span>
            </div>
            {tooltipRow.rate_card_item_id ? (
              <div className="mt-1.5 text-green-600 font-medium">✓ Mapped to rate card</div>
            ) : (
              <div className="mt-1.5 text-amber-600 font-medium">⚠ Not mapped — click to assign</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

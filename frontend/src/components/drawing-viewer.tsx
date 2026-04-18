'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type Pt = [number, number];

interface DrawingGeometry {
  drawing_id: number;
  filename: string;
  bounds: { min_x: number; min_y: number; max_x: number; max_y: number } | null;
  fixtures: { block_name: string; layer: string; locations: Pt[] }[];
  pipes: { layer: string; service_type: string; segments: [Pt, Pt][] }[];
  fittings: { layer: string; fitting_type: string; positions: Pt[] }[];
}

// drawing_region stored on takeoff_items
type Highlight =
  | { type: 'fixture'; block_name: string; locations: Pt[] }
  | { type: 'pipe'; layer: string; segments: [Pt, Pt][] }
  | { type: 'fitting'; layer: string; positions: Pt[] };

interface Props {
  drawingId: number;
  highlight: Highlight | null;
  onClose: () => void;
  // NEW:
  mode?: 'modal' | 'inline';
  onHoverRegion?: (region: { type: string; key: string } | null) => void;
  onClickRegion?: (region: { type: string; key: string }) => void;
  hoveredRegion?: { type: string; key: string } | null;
}

export default function DrawingViewer({
  drawingId,
  highlight,
  onClose,
  mode = 'modal',
  onHoverRegion,
  onClickRegion,
  hoveredRegion = null,
}: Props) {
  const [geom, setGeom] = useState<DrawingGeometry | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [viewBox, setViewBox] = useState<string>('');
  const panState = useRef<{ dragging: boolean; lastX: number; lastY: number; vb: number[] }>({
    dragging: false, lastX: 0, lastY: 0, vb: [0, 0, 0, 0],
  });

  useEffect(() => {
    fetch(`/api/drawings/${drawingId}/geometry`)
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(setGeom)
      .catch(e => setErr(String(e)));
  }, [drawingId]);

  // Initial viewBox from bounds
  useEffect(() => {
    if (!geom) return;
    const b = geom.bounds;
    if (!b) return;
    const w = b.max_x - b.min_x;
    const h = b.max_y - b.min_y;
    const pad = Math.max(w, h) * 0.05;
    // SVG Y is flipped relative to CAD Y — we'll flip via scale transform on the group
    const vb = [b.min_x - pad, b.min_y - pad, w + pad * 2, h + pad * 2];
    setViewBox(vb.join(' '));
    panState.current.vb = vb;
  }, [geom]);

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
    const next = [nx, ny, nw, nh];
    panState.current.vb = next;
    setViewBox(next.join(' '));
  }

  function handleMouseDown(e: React.MouseEvent<SVGSVGElement>) {
    panState.current.dragging = true;
    panState.current.lastX = e.clientX;
    panState.current.lastY = e.clientY;
    panState.current.vb = viewBox.split(' ').map(Number);
  }
  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!panState.current.dragging) return;
    const svg = svgRef.current;
    if (!svg) return;
    const dx = e.clientX - panState.current.lastX;
    const dy = e.clientY - panState.current.lastY;
    const rect = svg.getBoundingClientRect();
    const [x, y, w, h] = panState.current.vb;
    const nx = x - (dx / rect.width) * w;
    const ny = y - (dy / rect.height) * h;
    const next = [nx, ny, w, h];
    panState.current.vb = next;
    setViewBox(next.join(' '));
  }
  function handleMouseUp() {
    panState.current.dragging = false;
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

  const isInline = mode === 'inline';

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
            <span className="text-xs text-gray-400">Scroll to zoom · drag to pan</span>
            <button onClick={onClose} className="px-3 py-1.5 text-sm rounded bg-gray-100 hover:bg-gray-200">Close</button>
          </div>
        </div>
      )}

      <div className={`flex-1 overflow-hidden ${isInline ? 'bg-slate-900' : 'bg-slate-50'}`}>
        {err && <div className="p-8 text-sm text-red-500">Failed to load: {err}</div>}
        {!geom && !err && <div className="p-8 text-sm text-gray-400">Loading drawing…</div>}
        {geom && !bounds && <div className="p-8 text-sm text-gray-400">No geometry available for this drawing.</div>}
        {geom && bounds && viewBox && (
          <svg
            ref={svgRef}
            viewBox={viewBox}
            preserveAspectRatio="xMidYMid meet"
            className="w-full h-full cursor-move"
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            {/* Flip Y axis so drawing orientation matches CAD conventions */}
            <g transform={`translate(0, ${bounds.min_y + bounds.max_y}) scale(1, -1)`}>
              {/* Bounds outline */}
              <rect
                x={bounds.min_x} y={bounds.min_y}
                width={bounds.max_x - bounds.min_x}
                height={bounds.max_y - bounds.min_y}
                fill="none" stroke="#e2e8f0" strokeWidth={strokeBase}
              />

              {/* Context: all pipes (faded) */}
              {geom.pipes.flatMap(p => p.segments.map((s, i) => {
                const isHovered = hoveredRegion?.type === 'pipe' && hoveredRegion.key === p.layer;
                return (
                  <line
                    key={`p-${p.layer}-${i}`}
                    x1={s[0][0]} y1={s[0][1]} x2={s[1][0]} y2={s[1][1]}
                    stroke={isHovered ? '#F59E0B' : '#cbd5e1'}
                    strokeWidth={isHovered ? strokeBase * 2 : strokeBase}
                    className="cursor-pointer"
                    onMouseEnter={() => onHoverRegion?.({ type: 'pipe', key: p.layer })}
                    onMouseLeave={() => onHoverRegion?.(null)}
                    onClick={(e) => { e.stopPropagation(); onClickRegion?.({ type: 'pipe', key: p.layer }); }}
                  />
                );
              }))}

              {/* Context: fixtures (faded dots) */}
              {geom.fixtures.flatMap(f =>
                f.locations.map((loc, i) => {
                  const isHovered = hoveredRegion?.type === 'fixture' && hoveredRegion.key === f.block_name;
                  return (
                    <circle
                      key={`fx-${f.block_name}-${i}`}
                      cx={loc[0]} cy={loc[1]} r={pointRadius}
                      fill={isHovered ? '#F59E0B' : '#cbd5e1'}
                      className="cursor-pointer"
                      onMouseEnter={() => onHoverRegion?.({ type: 'fixture', key: f.block_name })}
                      onMouseLeave={() => onHoverRegion?.(null)}
                      onClick={(e) => { e.stopPropagation(); onClickRegion?.({ type: 'fixture', key: f.block_name }); }}
                    />
                  );
                })
              )}

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
            </g>
          </svg>
        )}
      </div>
    </div>
  );
}

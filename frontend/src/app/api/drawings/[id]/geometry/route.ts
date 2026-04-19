import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// Returns the full geometry of a drawing for the viewer:
// - drawing bounds (for framing)
// - all extracted pipes (segments) and fixtures (locations) to render as context
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [drawing] = await query<{ id: number; filename: string; extraction_result: {
    bounds?: { min_x: number; min_y: number; max_x: number; max_y: number };
    drawing_extents?: { min_x: number; min_y: number; max_x: number; max_y: number };
    fixtures?: { block_name: string; layer: string; locations: [number, number][] }[];
    pipes?: { layer: string; service_type: string; segments?: [number, number][][] }[];
    fittings?: { layer: string; fitting_type: string; positions?: [number, number][] }[];
    layers?: ({ name: string; entity_count?: number; color?: number } | string)[];
    svg_backdrop?: string | null;
    svg_backdrop_viewbox?: [number, number, number, number] | number[] | null;
  } | null }>(
    'SELECT id, filename, extraction_result FROM drawings WHERE id = $1',
    [id]
  );

  if (!drawing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!drawing.extraction_result) return NextResponse.json({ error: 'No extraction result' }, { status: 404 });

  const r = drawing.extraction_result;
  let bounds = r.bounds || null;

  if (!bounds) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const accum = (x: number, y: number) => {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    };
    for (const f of r.fixtures || []) for (const [x, y] of (f.locations || [])) accum(x, y);
    for (const p of r.pipes || []) for (const seg of (p.segments || [])) for (const [x, y] of seg) accum(x, y);
    for (const f of r.fittings || []) for (const [x, y] of (f.positions || [])) accum(x, y);
    if (minX !== Infinity) {
      bounds = { min_x: minX, min_y: minY, max_x: maxX, max_y: maxY };
    }
  }

  // Layer names: prefer the explicit layers list from extraction; fall back to
  // the union of layers seen on extracted fixtures/pipes/fittings (covers
  // older extractions where `layers` may be missing or in a different shape).
  const layerSet = new Set<string>();
  for (const l of r.layers || []) {
    if (typeof l === 'string') layerSet.add(l);
    else if (l && typeof l === 'object' && typeof l.name === 'string') layerSet.add(l.name);
  }
  for (const f of r.fixtures || []) if (f.layer) layerSet.add(f.layer);
  for (const p of r.pipes || []) if (p.layer) layerSet.add(p.layer);
  for (const f of r.fittings || []) if (f.layer) layerSet.add(f.layer);
  const layers = Array.from(layerSet).sort();

  return NextResponse.json({
    drawing_id: drawing.id,
    filename: drawing.filename,
    bounds,
    fixtures: (r.fixtures || []).map(f => ({ block_name: f.block_name, layer: f.layer, locations: f.locations })),
    pipes: (r.pipes || []).map(p => ({ layer: p.layer, service_type: p.service_type, segments: p.segments || [] })),
    fittings: (r.fittings || []).map(f => ({ layer: f.layer, fitting_type: f.fitting_type, positions: f.positions || [] })),
    layers,
    svg_backdrop: r.svg_backdrop ?? null,
    svg_backdrop_viewbox: r.svg_backdrop_viewbox ?? null,
    drawing_extents: r.drawing_extents ?? null,
  });
}

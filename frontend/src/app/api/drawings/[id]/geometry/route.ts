import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// Returns the full geometry of a drawing for the viewer:
// - drawing bounds (for framing)
// - all extracted pipes (segments) and fixtures (locations) to render as context
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [drawing] = await query<{ id: number; filename: string; extraction_result: {
    bounds?: { min_x: number; min_y: number; max_x: number; max_y: number };
    fixtures?: { block_name: string; layer: string; locations: [number, number][] }[];
    pipes?: { layer: string; service_type: string; segments?: [number, number][][] }[];
    fittings?: { layer: string; fitting_type: string; positions?: [number, number][] }[];
  } | null }>(
    'SELECT id, filename, extraction_result FROM drawings WHERE id = $1',
    [id]
  );

  if (!drawing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!drawing.extraction_result) return NextResponse.json({ error: 'No extraction result' }, { status: 404 });

  const r = drawing.extraction_result;
  let bounds = r.bounds || null;

  if (!bounds) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const f of r.fixtures || []) {
      for (const [x, y] of (f.locations || [])) { xs.push(x); ys.push(y); }
    }
    for (const p of r.pipes || []) {
      for (const seg of (p.segments || [])) {
        for (const [x, y] of seg) { xs.push(x); ys.push(y); }
      }
    }
    for (const f of r.fittings || []) {
      for (const [x, y] of (f.positions || [])) { xs.push(x); ys.push(y); }
    }
    if (xs.length > 0) {
      bounds = {
        min_x: Math.min(...xs),
        min_y: Math.min(...ys),
        max_x: Math.max(...xs),
        max_y: Math.max(...ys),
      };
    }
  }

  return NextResponse.json({
    drawing_id: drawing.id,
    filename: drawing.filename,
    bounds: bounds,
    fixtures: (r.fixtures || []).map(f => ({ block_name: f.block_name, layer: f.layer, locations: f.locations })),
    pipes: (r.pipes || []).map(p => ({ layer: p.layer, service_type: p.service_type, segments: p.segments || [] })),
    fittings: (r.fittings || []).map(f => ({ layer: f.layer, fitting_type: f.fitting_type, positions: f.positions || [] })),
  });
}

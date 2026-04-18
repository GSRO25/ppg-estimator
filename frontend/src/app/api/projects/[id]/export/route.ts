import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { renderToBuffer } from '@react-pdf/renderer';
import React from 'react';
import EstimateDocument from '@/lib/pdf/estimate-document';
import { calculateSectionTotals, calculateGrandTotal, type TakeoffItemWithRates } from '@/lib/rate-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const marginPercent = body.marginPercent ?? 10;

  const [project] = await query<{ name: string; client: string | null }>(
    'SELECT name, client FROM projects WHERE id = $1', [id]
  );
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const items = await query<TakeoffItemWithRates>(
    `SELECT ti.section_number, ti.section_name, ti.description, ti.uom,
            ti.final_qty, rci.labour_rate, rci.material_rate, rci.plant_rate, rci.production_rate
     FROM takeoff_items ti
     LEFT JOIN rate_card_items rci ON rci.id = ti.rate_card_item_id
     WHERE ti.project_id = $1
     ORDER BY ti.section_number, ti.id`,
    [id]
  );

  const sections = calculateSectionTotals(items);
  const totals = calculateGrandTotal(sections, marginPercent);

  const pdfElement = React.createElement(EstimateDocument, {
    project,
    sections,
    totals,
    marginPercent,
    generatedAt: new Date().toISOString(),
  });

  const buffer = await renderToBuffer(pdfElement as Parameters<typeof renderToBuffer>[0]);

  await query(
    `INSERT INTO estimates (project_id, version) VALUES ($1, (SELECT COALESCE(MAX(version), 0) + 1 FROM estimates WHERE project_id = $1)) RETURNING id`,
    [id]
  );

  const safeName = project.name
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Disposition': `attachment; filename="${safeName}_estimate.pdf"`,
      'Content-Type': 'application/pdf',
      'Content-Length': String(buffer.length),
    },
  });
}

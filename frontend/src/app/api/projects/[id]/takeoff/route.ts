import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

interface ExtractionFixture {
  block_name: string;
  count: number;
  layer: string;
  locations: [number, number][];
  confidence: string;
}

interface ExtractionPipe {
  layer: string;
  service_type: string;
  total_length_m: number;
  segment_count: number;
  confidence: string;
}

interface ExtractionFitting {
  fitting_type: string;
  layer: string;
  service_type: string;
  count: number;
  confidence: string;
}

interface ExtractionResult {
  fixtures: ExtractionFixture[];
  pipes: ExtractionPipe[];
  fittings: ExtractionFitting[];
}

// Map service types to sections
const SERVICE_SECTION_MAP: Record<string, { number: number; name: string }> = {
  stormwater: { number: 3, name: '3. Civil-Stormwater' },
  fire: { number: 5, name: '5. Fire Hydrant' },
  cold_water_inground: { number: 6, name: '6. Inground Pressure' },
  sanitary: { number: 7, name: '7. Inground Sewer' },
  tradewaste: { number: 8, name: '8. Tradewaste' },
  cold_water: { number: 10, name: '10. Pressure Services' },
  hot_water: { number: 10, name: '10. Pressure Services' },
};

const FIXTURE_SECTION = { number: 13, name: '13. Fitout' };

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const items = await query(
    `SELECT ti.*, rci.labour_rate, rci.material_rate, rci.plant_rate, rci.production_rate
     FROM takeoff_items ti
     LEFT JOIN rate_card_items rci ON rci.id = ti.rate_card_item_id
     WHERE ti.project_id = $1
     ORDER BY ti.section_number, ti.id`,
    [id]
  );
  return NextResponse.json(items);
}

export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Clear existing auto-generated takeoff items
  await query(
    "DELETE FROM takeoff_items WHERE project_id = $1 AND source != 'manual'",
    [id]
  );

  // Load completed drawings with extraction results
  const drawings = await query<{ id: number; extraction_result: ExtractionResult }>(
    "SELECT id, extraction_result FROM drawings WHERE project_id = $1 AND extraction_status = 'complete' AND extraction_result IS NOT NULL",
    [id]
  );

  // Load symbol mappings
  const mappings = await query<{ cad_block_name: string; rate_card_item_id: number }>(
    'SELECT cad_block_name, rate_card_item_id FROM symbol_mappings'
  );
  const blockToItem = Object.fromEntries(mappings.map(m => [m.cad_block_name, m.rate_card_item_id]));

  let insertCount = 0;

  for (const drawing of drawings) {
    const result = drawing.extraction_result;
    if (!result) continue;

    // Fixtures → takeoff items
    for (const fixture of result.fixtures || []) {
      const rateCardItemId = blockToItem[fixture.block_name] || null;
      await query(
        `INSERT INTO takeoff_items (project_id, drawing_id, rate_card_item_id, section_number, section_name, description, uom, extracted_qty, final_qty, confidence, source, drawing_region)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, $11)`,
        [
          id, drawing.id, rateCardItemId,
          FIXTURE_SECTION.number, FIXTURE_SECTION.name,
          fixture.block_name, 'Each',
          fixture.count,
          fixture.confidence || 'high', 'dwg_parser',
          JSON.stringify({ locations: fixture.locations }),
        ]
      );
      insertCount++;
    }

    // Pipes → takeoff items
    for (const pipe of result.pipes || []) {
      const section = SERVICE_SECTION_MAP[pipe.service_type] || { number: 99, name: 'Uncategorized' };
      await query(
        `INSERT INTO takeoff_items (project_id, drawing_id, section_number, section_name, description, uom, extracted_qty, final_qty, confidence, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9)`,
        [
          id, drawing.id,
          section.number, section.name,
          `${pipe.layer} pipe (${pipe.service_type})`, 'Per Meter',
          pipe.total_length_m,
          pipe.confidence || 'high', 'dwg_parser',
        ]
      );
      insertCount++;
    }

    // Fittings → takeoff items
    for (const fitting of result.fittings || []) {
      const section = SERVICE_SECTION_MAP[fitting.service_type] || { number: 99, name: 'Uncategorized' };
      await query(
        `INSERT INTO takeoff_items (project_id, drawing_id, section_number, section_name, description, uom, extracted_qty, final_qty, confidence, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9)`,
        [
          id, drawing.id,
          section.number, section.name,
          `${fitting.fitting_type} (${fitting.layer})`, 'Each',
          fitting.count,
          fitting.confidence || 'high', 'dwg_parser',
        ]
      );
      insertCount++;
    }
  }

  return NextResponse.json({ generated: insertCount });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  const { itemId, finalQty } = body;

  // Get current value for correction log
  const [current] = await query<{ final_qty: number }>(
    'SELECT final_qty FROM takeoff_items WHERE id = $1 AND project_id = $2',
    [itemId, id]
  );

  if (!current) return NextResponse.json({ error: 'Item not found' }, { status: 404 });

  // Update quantity
  await query(
    'UPDATE takeoff_items SET final_qty = $1, reviewed = true, reviewed_at = NOW() WHERE id = $2',
    [finalQty, itemId]
  );

  // Log correction if changed
  if (current.final_qty !== finalQty) {
    await query(
      'INSERT INTO corrections (takeoff_item_id, original_qty, corrected_qty) VALUES ($1, $2, $3)',
      [itemId, current.final_qty, finalQty]
    );
  }

  return NextResponse.json({ updated: true });
}

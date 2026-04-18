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
  segments?: [number, number][][];
  confidence: string;
}

interface ExtractionFitting {
  fitting_type: string;
  layer: string;
  service_type: string;
  count: number;
  positions?: [number, number][];
  confidence: string;
}

interface ExtractionResult {
  fixtures: ExtractionFixture[];
  pipes: ExtractionPipe[];
  fittings: ExtractionFitting[];
  bounds?: { min_x: number; min_y: number; max_x: number; max_y: number };
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

async function fuzzyMatch(desc: string): Promise<{
  id: number; section_number: number; section_name: string;
  labour_rate: number; material_rate: number; plant_rate: number;
  confidence: string;
} | null> {
  const rows = await query<{
    id: number; section_number: number; section_name: string;
    labour_rate: string; material_rate: string; plant_rate: string; score: string;
  }>(
    `SELECT id, section_number, section_name, labour_rate, material_rate, plant_rate,
            similarity(LOWER(description), LOWER($1)) AS score
     FROM rate_card_items
     WHERE similarity(LOWER(description), LOWER($1)) > 0.3
     ORDER BY score DESC
     LIMIT 1`,
    [desc]
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    id: row.id,
    section_number: row.section_number,
    section_name: row.section_name,
    labour_rate: Number(row.labour_rate),
    material_rate: Number(row.material_rate),
    plant_rate: Number(row.plant_rate),
    confidence: Number(row.score) > 0.5 ? 'high' : 'low',
  };
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const items = await query(
    `SELECT ti.*, rci.labour_rate, rci.material_rate, rci.plant_rate, rci.production_rate,
            ti.drawing_region, ti.drawing_id
     FROM takeoff_items ti
     LEFT JOIN rate_card_items rci ON rci.id = ti.rate_card_item_id
     WHERE ti.project_id = $1
     ORDER BY ti.section_number, ti.id`,
    [id]
  );
  // pg returns NUMERIC as strings — parse to JS numbers for AG Grid
  const parsed = items.map((item: Record<string, unknown>) => ({
    ...item,
    extracted_qty: item.extracted_qty != null ? Number(item.extracted_qty) : 0,
    final_qty: item.final_qty != null ? Number(item.final_qty) : 0,
    labour_rate: item.labour_rate != null ? Number(item.labour_rate) : null,
    material_rate: item.material_rate != null ? Number(item.material_rate) : null,
    plant_rate: item.plant_rate != null ? Number(item.plant_rate) : null,
    production_rate: item.production_rate != null ? Number(item.production_rate) : null,
  }));
  return NextResponse.json(parsed);
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

  // Load symbol mappings joined with rate card item section info
  const mappings = await query<{ cad_block_name: string; rate_card_item_id: number; section_number: number; section_name: string }>(
    `SELECT sm.cad_block_name, sm.rate_card_item_id, rci.section_number, rci.section_name
     FROM symbol_mappings sm
     JOIN rate_card_items rci ON rci.id = sm.rate_card_item_id`
  );
  const blockToItem = Object.fromEntries(mappings.map(m => [m.cad_block_name, m.rate_card_item_id]));
  const blockToSection = Object.fromEntries(
    mappings.map(m => [m.cad_block_name, { number: m.section_number, name: m.section_name }])
  );

  let insertCount = 0;

  for (const drawing of drawings) {
    const result = drawing.extraction_result;
    if (!result) continue;

    // Fixtures → takeoff items
    for (const fixture of result.fixtures || []) {
      let rateCardItemId = blockToItem[fixture.block_name] || null;
      // If mapped to a rate card item, use that item's section; else default to Fitout
      let fixtureSection = blockToSection[fixture.block_name] || FIXTURE_SECTION;
      let confidence = fixture.confidence || 'high';

      if (!rateCardItemId) {
        const searchStr = fixture.block_name.replace(/[_-]/g, ' ');
        const match = await fuzzyMatch(searchStr);
        if (match) {
          rateCardItemId = match.id;
          fixtureSection = { number: match.section_number, name: match.section_name };
          confidence = match.confidence;
        }
      }

      await query(
        `INSERT INTO takeoff_items (project_id, drawing_id, rate_card_item_id, section_number, section_name, description, uom, extracted_qty, final_qty, confidence, source, drawing_region)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, $11)`,
        [
          id, drawing.id, rateCardItemId,
          fixtureSection.number, fixtureSection.name,
          fixture.block_name, 'Each',
          fixture.count,
          confidence, 'dwg_parser',
          JSON.stringify({ type: 'fixture', block_name: fixture.block_name, locations: fixture.locations }),
        ]
      );
      insertCount++;
    }

    // Pipes → takeoff items
    for (const pipe of result.pipes || []) {
      let pipeRateItemId = blockToItem[pipe.layer] || null;
      // Prefer rate-card-mapped section over keyword classification
      let section = blockToSection[pipe.layer] ||
        SERVICE_SECTION_MAP[pipe.service_type] ||
        { number: 99, name: 'Uncategorized' };
      let confidence = pipe.confidence || 'high';

      if (!pipeRateItemId) {
        const searchStr = `${pipe.service_type.replace(/_/g, ' ')} pipe ${pipe.layer}`;
        const match = await fuzzyMatch(searchStr);
        if (match) {
          pipeRateItemId = match.id;
          section = { number: match.section_number, name: match.section_name };
          confidence = match.confidence;
        }
      }

      await query(
        `INSERT INTO takeoff_items (project_id, drawing_id, rate_card_item_id, section_number, section_name, description, uom, extracted_qty, final_qty, confidence, source, drawing_region)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, $11)`,
        [
          id, drawing.id, pipeRateItemId,
          section.number, section.name,
          `${pipe.layer} pipe (${pipe.service_type})`, 'Per Meter',
          pipe.total_length_m,
          confidence, 'dwg_parser',
          JSON.stringify({ type: 'pipe', layer: pipe.layer, segments: pipe.segments || [] }),
        ]
      );
      insertCount++;
    }

    // Fittings → takeoff items
    for (const fitting of result.fittings || []) {
      let fittingRateItemId = blockToItem[fitting.layer] || null;
      let section = blockToSection[fitting.layer] ||
        SERVICE_SECTION_MAP[fitting.service_type] ||
        { number: 99, name: 'Uncategorized' };
      let confidence = fitting.confidence || 'high';

      if (!fittingRateItemId) {
        const searchStr = `${fitting.fitting_type} ${fitting.service_type.replace(/_/g, ' ')}`;
        const match = await fuzzyMatch(searchStr);
        if (match) {
          fittingRateItemId = match.id;
          section = { number: match.section_number, name: match.section_name };
          confidence = match.confidence;
        }
      }

      await query(
        `INSERT INTO takeoff_items (project_id, drawing_id, rate_card_item_id, section_number, section_name, description, uom, extracted_qty, final_qty, confidence, source, drawing_region)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, $11)`,
        [
          id, drawing.id, fittingRateItemId,
          section.number, section.name,
          `${fitting.fitting_type} (${fitting.layer})`, 'Each',
          fitting.count,
          confidence, 'dwg_parser',
          JSON.stringify({ type: 'fitting', layer: fitting.layer, positions: fitting.positions || [] }),
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
  const { itemId, finalQty, rateCardItemId, rememberMapping } = body;

  const [current] = await query<{ final_qty: number; description: string; rate_card_item_id: number | null }>(
    'SELECT final_qty, description, rate_card_item_id FROM takeoff_items WHERE id = $1 AND project_id = $2',
    [itemId, id]
  );
  if (!current) return NextResponse.json({ error: 'Item not found' }, { status: 404 });

  // Quantity update (existing behaviour)
  if (finalQty !== undefined) {
    await query(
      'UPDATE takeoff_items SET final_qty = $1, reviewed = true, reviewed_at = NOW() WHERE id = $2',
      [finalQty, itemId]
    );
    if (Number(current.final_qty) !== Number(finalQty)) {
      await query(
        'INSERT INTO corrections (takeoff_item_id, original_qty, corrected_qty) VALUES ($1, $2, $3)',
        [itemId, current.final_qty, finalQty]
      );
    }
  }

  // Rate card item reassignment — also re-derives section from the new item
  if (rateCardItemId !== undefined) {
    if (rateCardItemId === null) {
      await query(
        'UPDATE takeoff_items SET rate_card_item_id = NULL WHERE id = $1',
        [itemId]
      );
    } else {
      const [rci] = await query<{ section_number: number; section_name: string }>(
        'SELECT section_number, section_name FROM rate_card_items WHERE id = $1',
        [rateCardItemId]
      );
      if (!rci) return NextResponse.json({ error: 'Rate card item not found' }, { status: 404 });
      await query(
        `UPDATE takeoff_items
         SET rate_card_item_id = $1, section_number = $2, section_name = $3,
             reviewed = true, reviewed_at = NOW()
         WHERE id = $4`,
        [rateCardItemId, rci.section_number, rci.section_name, itemId]
      );

      // Learning loop — persist the block/layer → rate card mapping for future takeoffs
      if (rememberMapping) {
        // The takeoff description is shaped like "{layer} pipe ({service})" or fitting "{type} ({layer})"
        // or for fixtures just the block name. Extract the CAD name:
        const desc = current.description;
        let cadName = desc;
        const pipeMatch = desc.match(/^(.+?) pipe \(/);
        const fittingMatch = desc.match(/^[^()]+\((.+?)\)$/);
        if (pipeMatch) cadName = pipeMatch[1];
        else if (fittingMatch) cadName = fittingMatch[1];

        await query('DELETE FROM symbol_mappings WHERE cad_block_name = $1', [cadName]);
        await query(
          'INSERT INTO symbol_mappings (cad_block_name, rate_card_item_id) VALUES ($1, $2)',
          [cadName, rateCardItemId]
        );
      }
    }
  }

  return NextResponse.json({ updated: true });
}

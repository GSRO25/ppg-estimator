import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// All known block/layer names from extraction results, merged with current mappings
export async function GET() {
  // Fixtures: block names from extraction results
  const blocks = await query<{ name: string; type: string }>(
    `SELECT DISTINCT jsonb_array_elements(extraction_result->'fixtures')->>'block_name' AS name,
            'block' AS type
     FROM drawings WHERE extraction_result IS NOT NULL`
  );

  // Pipes: layer names from extraction results
  const layers = await query<{ name: string; type: string }>(
    `SELECT DISTINCT jsonb_array_elements(extraction_result->'pipes')->>'layer' AS name,
            'layer' AS type
     FROM drawings WHERE extraction_result IS NOT NULL`
  );

  const allNames = [...blocks, ...layers].filter(r => r.name);

  // Current mappings
  const mappings = await query<{ cad_block_name: string; rate_card_item_id: number; description: string; section_name: string }>(
    `SELECT sm.cad_block_name, sm.rate_card_item_id, rci.description, rci.section_name
     FROM symbol_mappings sm
     JOIN rate_card_items rci ON rci.id = sm.rate_card_item_id`
  );
  const mappingMap = Object.fromEntries(mappings.map(m => [m.cad_block_name, m]));

  const result = allNames.map(({ name, type }) => ({
    name,
    type,
    rate_card_item_id: mappingMap[name]?.rate_card_item_id ?? null,
    rate_card_description: mappingMap[name]
      ? `${mappingMap[name].section_name} — ${mappingMap[name].description}`
      : null,
  }));

  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const { name, rateCardItemId } = await request.json();
  if (!name || !rateCardItemId) return NextResponse.json({ error: 'name and rateCardItemId required' }, { status: 400 });

  await query('DELETE FROM symbol_mappings WHERE cad_block_name = $1', [name]);
  await query(
    'INSERT INTO symbol_mappings (cad_block_name, rate_card_item_id) VALUES ($1, $2)',
    [name, rateCardItemId]
  );
  return NextResponse.json({ saved: true });
}

export async function DELETE(request: NextRequest) {
  const { name } = await request.json();
  await query('DELETE FROM symbol_mappings WHERE cad_block_name = $1', [name]);
  return NextResponse.json({ deleted: true });
}

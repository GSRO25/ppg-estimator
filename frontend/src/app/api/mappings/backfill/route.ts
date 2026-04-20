import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

// Apply all current symbol_mappings to existing unmapped takeoff_items.
// Matches by drawing_region block_name (fixtures) or layer (pipes/fittings).
export async function POST() {
  const results = await Promise.all([
    query<{ count: string }>(
      `UPDATE takeoff_items ti
       SET rate_card_item_id = sm.rate_card_item_id,
           section_number    = rci.section_number,
           section_name      = rci.section_name
       FROM symbol_mappings sm
       JOIN rate_card_items rci ON rci.id = sm.rate_card_item_id
       WHERE ti.rate_card_item_id IS NULL
         AND ti.drawing_region->>'type' = 'fixture'
         AND ti.drawing_region->>'block_name' = sm.cad_block_name
       RETURNING ti.id`
    ),
    query<{ count: string }>(
      `UPDATE takeoff_items ti
       SET rate_card_item_id = sm.rate_card_item_id,
           section_number    = rci.section_number,
           section_name      = rci.section_name
       FROM symbol_mappings sm
       JOIN rate_card_items rci ON rci.id = sm.rate_card_item_id
       WHERE ti.rate_card_item_id IS NULL
         AND ti.drawing_region->>'type' = 'pipe'
         AND ti.drawing_region->>'layer' = sm.cad_block_name
       RETURNING ti.id`
    ),
    query<{ count: string }>(
      `UPDATE takeoff_items ti
       SET rate_card_item_id = sm.rate_card_item_id,
           section_number    = rci.section_number,
           section_name      = rci.section_name
       FROM symbol_mappings sm
       JOIN rate_card_items rci ON rci.id = sm.rate_card_item_id
       WHERE ti.rate_card_item_id IS NULL
         AND ti.drawing_region->>'type' = 'fitting'
         AND ti.drawing_region->>'layer' = sm.cad_block_name
       RETURNING ti.id`
    ),
  ]);

  const updated = results.reduce((sum, r) => sum + r.length, 0);
  return NextResponse.json({ updated });
}

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// Lightweight search across the most recent rate card version.
// Used by the takeoff grid to let users pick a rate card item inline.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') || '').trim();
  const section = searchParams.get('section');

  const conditions: string[] = [
    "rcv.id = (SELECT id FROM rate_card_versions ORDER BY imported_at DESC LIMIT 1)",
    "rci.is_subtotal = false",
  ];
  const params: unknown[] = [];
  let idx = 1;

  if (q) {
    conditions.push(`rci.description ILIKE $${idx++}`);
    params.push(`%${q}%`);
  }
  if (section) {
    conditions.push(`rci.section_number = $${idx++}`);
    params.push(Number(section));
  }

  const items = await query(
    `SELECT rci.id, rci.section_number, rci.section_name, rci.description, rci.uom,
            rci.labour_rate::float AS labour_rate, rci.material_rate::float AS material_rate,
            rci.plant_rate::float AS plant_rate
     FROM rate_card_items rci
     JOIN rate_card_versions rcv ON rcv.id = rci.rate_card_version_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY rci.section_number, rci.sort_order
     LIMIT 50`,
    params
  );
  return NextResponse.json(items);
}

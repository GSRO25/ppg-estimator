import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET() {
  const mappings = await query('SELECT * FROM symbol_mappings ORDER BY cad_block_name');
  return NextResponse.json(mappings);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { cad_block_name, architect_name, rate_card_item_id } = body;

  const [mapping] = await query<{ id: number }>(
    `INSERT INTO symbol_mappings (cad_block_name, architect_name, rate_card_item_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (cad_block_name, architect_name) DO UPDATE SET rate_card_item_id = $3
     RETURNING id`,
    [cad_block_name, architect_name || null, rate_card_item_id]
  );

  return NextResponse.json(mapping, { status: 201 });
}

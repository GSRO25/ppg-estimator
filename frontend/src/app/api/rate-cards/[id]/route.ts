import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const items = await query(
    'SELECT * FROM rate_card_items WHERE rate_card_version_id = $1 ORDER BY section_number, sort_order',
    [id]
  );
  return NextResponse.json(items);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await query('DELETE FROM rate_card_versions WHERE id = $1', [id]);
  return NextResponse.json({ deleted: true });
}

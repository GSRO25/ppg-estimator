import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET() {
  const versions = await query(`
    SELECT rcv.*, COUNT(rci.id)::int as item_count
    FROM rate_card_versions rcv
    LEFT JOIN rate_card_items rci ON rci.rate_card_version_id = rcv.id
    GROUP BY rcv.id
    ORDER BY rcv.imported_at DESC
  `);
  return NextResponse.json(versions);
}

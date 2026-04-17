import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await query(
    "UPDATE drawings SET extraction_status = 'pending', extraction_result = NULL WHERE project_id = $1",
    [id]
  );
  return NextResponse.json({ reset: true });
}

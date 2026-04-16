import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET() {
  const projects = await query(
    'SELECT * FROM projects ORDER BY created_at DESC'
  );
  return NextResponse.json(projects);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, client, address, start_date, end_date, rate_card_version_id } = body;

  const [project] = await query<{ id: number }>(
    `INSERT INTO projects (name, client, address, start_date, end_date, rate_card_version_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [name, client || null, address || null, start_date || null, end_date || null, rate_card_version_id || null]
  );
  return NextResponse.json(project, { status: 201 });
}

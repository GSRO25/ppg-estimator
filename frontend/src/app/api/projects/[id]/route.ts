import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [project] = await query('SELECT * FROM projects WHERE id = $1', [id]);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(project);
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  const { name, client, address, start_date, end_date, status, margin_percent, rate_card_version_id } = body;

  const [project] = await query(
    `UPDATE projects SET
      name = COALESCE($1, name), client = COALESCE($2, client),
      address = COALESCE($3, address), start_date = COALESCE($4, start_date),
      end_date = COALESCE($5, end_date), status = COALESCE($6, status),
      margin_percent = COALESCE($7, margin_percent),
      rate_card_version_id = COALESCE($8, rate_card_version_id)
     WHERE id = $9 RETURNING *`,
    [name, client, address, start_date, end_date, status, margin_percent, rate_card_version_id, id]
  );
  return NextResponse.json(project);
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await query('DELETE FROM projects WHERE id = $1', [id]);
  return NextResponse.json({ deleted: true });
}

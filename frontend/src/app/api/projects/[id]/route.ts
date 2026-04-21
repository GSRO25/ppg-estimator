import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireTenant } from '@/lib/require-tenant';

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authed = await requireTenant();
  if (!authed.ok) return authed.response;
  const { tenantId } = authed.ctx;

  const { id } = await params;
  const [project] = await query(
    `SELECT p.*,
            ce.name AS consulting_engineer_name,
            b.name AS builder_name
     FROM projects p
     LEFT JOIN consulting_engineers ce ON ce.id = p.consulting_engineer_id
     LEFT JOIN builders b ON b.id = p.builder_id
     WHERE p.id = $1 AND p.tenant_id = $2`,
    [id, tenantId]
  );
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(project);
}

/**
 * PATCH /api/projects/[id] — partial update of the project.
 * All fields optional; nulls clear.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authed = await requireTenant();
  if (!authed.ok) return authed.response;
  const { tenantId } = authed.ctx;

  const { id } = await params;
  const body = await request.json();
  const {
    name, client, address, start_date, end_date, status, margin_percent,
    rate_card_version_id, consulting_engineer_id, builder_id,
  } = body;

  const [project] = await query(
    `UPDATE projects SET
      name = COALESCE($1, name),
      client = COALESCE($2, client),
      address = COALESCE($3, address),
      start_date = COALESCE($4, start_date),
      end_date = COALESCE($5, end_date),
      status = COALESCE($6, status),
      margin_percent = COALESCE($7, margin_percent),
      rate_card_version_id = COALESCE($8, rate_card_version_id),
      consulting_engineer_id = CASE WHEN $10::boolean THEN $9 ELSE consulting_engineer_id END,
      builder_id = CASE WHEN $12::boolean THEN $11 ELSE builder_id END
     WHERE id = $13 AND tenant_id = $14 RETURNING *`,
    [
      name, client, address, start_date, end_date, status, margin_percent,
      rate_card_version_id,
      consulting_engineer_id ?? null, 'consulting_engineer_id' in body,
      builder_id ?? null, 'builder_id' in body,
      id, tenantId,
    ]
  );
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(project);
}

// Keep PUT as an alias of PATCH for backward compatibility.
export const PUT = PATCH;

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authed = await requireTenant();
  if (!authed.ok) return authed.response;
  const { tenantId } = authed.ctx;

  const { id } = await params;
  await query('DELETE FROM projects WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
  return NextResponse.json({ deleted: true });
}

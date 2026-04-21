import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireTenant } from '@/lib/require-tenant';

export async function GET() {
  const authed = await requireTenant();
  if (!authed.ok) return authed.response;
  const { tenantId } = authed.ctx;

  const projects = await query(
    `SELECT p.*,
            ce.name AS consulting_engineer_name,
            b.name AS builder_name
     FROM projects p
     LEFT JOIN consulting_engineers ce ON ce.id = p.consulting_engineer_id
     LEFT JOIN builders b ON b.id = p.builder_id
     WHERE p.tenant_id = $1
     ORDER BY p.created_at DESC`,
    [tenantId]
  );
  return NextResponse.json(projects);
}

export async function POST(request: NextRequest) {
  const authed = await requireTenant();
  if (!authed.ok) return authed.response;
  const { tenantId, userId } = authed.ctx;

  const body = await request.json();
  const { name, client, address, start_date, end_date, consulting_engineer_id, builder_id } = body;
  let { rate_card_version_id } = body;

  if (!rate_card_version_id) {
    const [defaultRcv] = await query<{ id: number }>(
      `SELECT id FROM rate_card_versions WHERE tenant_id = $1
       ORDER BY imported_at DESC LIMIT 1`,
      [tenantId]
    );
    rate_card_version_id = defaultRcv?.id ?? null;
  }

  const [project] = await query<{ id: number }>(
    `INSERT INTO projects (tenant_id, name, client, address, start_date, end_date,
                           rate_card_version_id, consulting_engineer_id, builder_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [
      tenantId, name, client || null, address || null,
      start_date || null, end_date || null, rate_card_version_id,
      consulting_engineer_id || null, builder_id || null, userId,
    ]
  );
  return NextResponse.json(project, { status: 201 });
}

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireTenant } from '@/lib/require-tenant';

export async function GET() {
  const authed = await requireTenant();
  if (!authed.ok) return authed.response;
  const { tenantId } = authed.ctx;

  const projects = await query(
    'SELECT * FROM projects WHERE tenant_id = $1 ORDER BY created_at DESC',
    [tenantId]
  );
  return NextResponse.json(projects);
}

export async function POST(request: NextRequest) {
  const authed = await requireTenant();
  if (!authed.ok) return authed.response;
  const { tenantId, userId } = authed.ctx;

  const body = await request.json();
  const { name, client, address, start_date, end_date } = body;
  let { rate_card_version_id } = body;

  // If the caller didn't specify a rate card, attach the tenant's most
  // recently imported one automatically — matches the single-tenant mental
  // model where there's usually only one active rate card anyway.
  if (!rate_card_version_id) {
    const [defaultRcv] = await query<{ id: number }>(
      `SELECT id FROM rate_card_versions WHERE tenant_id = $1
       ORDER BY imported_at DESC LIMIT 1`,
      [tenantId]
    );
    rate_card_version_id = defaultRcv?.id ?? null;
  }

  const [project] = await query<{ id: number }>(
    `INSERT INTO projects (tenant_id, name, client, address, start_date, end_date, rate_card_version_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [tenantId, name, client || null, address || null, start_date || null, end_date || null, rate_card_version_id, userId]
  );
  return NextResponse.json(project, { status: 201 });
}

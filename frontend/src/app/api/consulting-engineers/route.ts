import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireTenant } from '@/lib/require-tenant';

/**
 * GET /api/consulting-engineers — list CEs available to the current tenant.
 * Includes both global seeds (tenant_id NULL) and tenant-added firms.
 */
export async function GET() {
  const authed = await requireTenant();
  if (!authed.ok) return authed.response;
  const { tenantId } = authed.ctx;

  const rows = await query<{ id: number; name: string; slug: string; is_seed: boolean; tenant_id: number | null }>(
    `SELECT id, name, slug, is_seed, tenant_id
     FROM consulting_engineers
     WHERE tenant_id = $1 OR tenant_id IS NULL
     ORDER BY name`,
    [tenantId]
  );
  return NextResponse.json(rows);
}

/**
 * POST /api/consulting-engineers — add a tenant-specific CE.
 */
export async function POST(request: NextRequest) {
  const authed = await requireTenant();
  if (!authed.ok) return authed.response;
  const { tenantId } = authed.ctx;

  const { name, notes } = await request.json();
  if (!name || typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'name required' }, { status: 400 });
  }

  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  try {
    const [row] = await query<{ id: number; name: string; slug: string }>(
      `INSERT INTO consulting_engineers (tenant_id, name, slug, notes, is_seed)
       VALUES ($1, $2, $3, $4, FALSE)
       RETURNING id, name, slug`,
      [tenantId, name.trim(), slug, notes ?? null]
    );
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    // Most likely a unique-constraint violation on (tenant, slug) when the
    // user re-adds a name that already exists in the seed list.
    return NextResponse.json({
      error: e instanceof Error ? e.message : 'Insert failed',
    }, { status: 400 });
  }
}

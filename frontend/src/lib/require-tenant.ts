import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { NextResponse } from 'next/server';

export interface TenantContext {
  userId: number;
  tenantId: number;
  role: 'admin' | 'estimator';
  email: string;
}

type TenantResult =
  | { ok: true; ctx: TenantContext }
  | { ok: false; response: NextResponse };

/**
 * Resolve the current session into a TenantContext that API routes use to
 * scope every query. Callers must pass `ctx.tenantId` into any query that
 * touches tenant-owned tables (projects, rate_card_versions,
 * symbol_mappings, mapping_suggestions, mapping_suggestion_feedback).
 *
 * Returns 401 if unauthenticated, 403 if the authenticated email has no
 * matching users row. The intent is fail-closed: any route that forgets to
 * check the result will simply never see tenant data.
 */
export async function requireTenant(): Promise<TenantResult> {
  const session = await auth();
  if (!session?.user?.email) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const [row] = await query<{ id: number; tenant_id: number; role: 'admin' | 'estimator' }>(
    'SELECT id, tenant_id, role FROM users WHERE email = $1',
    [session.user.email]
  );

  if (!row) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'User not provisioned' }, { status: 403 }),
    };
  }

  return {
    ok: true,
    ctx: { userId: row.id, tenantId: row.tenant_id, role: row.role, email: session.user.email },
  };
}

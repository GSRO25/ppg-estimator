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
 * Returns 401 if unauthenticated. If the authed email passed NextAuth's
 * signIn gate but has no users row yet, auto-provisions one under the
 * default tenant (tenant_id = 1) — an admin can reassign tenant or
 * promote the role later once the settings UI exists. The intent is
 * fail-closed: any route that forgets to check this will simply never
 * see tenant data.
 */
export async function requireTenant(): Promise<TenantResult> {
  const session = await auth();
  if (!session?.user?.email) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  let [row] = await query<{ id: number; tenant_id: number; role: 'admin' | 'estimator' }>(
    'SELECT id, tenant_id, role FROM users WHERE email = $1',
    [session.user.email]
  );

  if (!row) {
    const name = session.user.name || session.user.email.split('@')[0];
    const [created] = await query<{ id: number; tenant_id: number; role: 'admin' | 'estimator' }>(
      `INSERT INTO users (email, name, role, tenant_id)
       VALUES ($1, $2, 'estimator', 1)
       RETURNING id, tenant_id, role`,
      [session.user.email, name]
    );
    row = created;
  }

  return {
    ok: true,
    ctx: { userId: row.id, tenantId: row.tenant_id, role: row.role, email: session.user.email },
  };
}

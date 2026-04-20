import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireTenant } from '@/lib/require-tenant';

/**
 * GET /api/llm-usage
 *
 * Returns totals for today / this month / lifetime, plus a breakdown by
 * purpose (mapping_suggester, legend_parser, ...) and by day for the
 * last 30 days. Pulled from the llm_usage table which is appended to
 * after every Claude call.
 */
export async function GET() {
  const authed = await requireTenant();
  if (!authed.ok) return authed.response;
  const { tenantId } = authed.ctx;

  const [totals] = await query<{
    today: string; month: string; lifetime: string;
    today_calls: number; month_calls: number; lifetime_calls: number;
  }>(
    `SELECT
       COALESCE(SUM(cost_usd) FILTER (WHERE created_at >= date_trunc('day', NOW())), 0) AS today,
       COALESCE(SUM(cost_usd) FILTER (WHERE created_at >= date_trunc('month', NOW())), 0) AS month,
       COALESCE(SUM(cost_usd), 0) AS lifetime,
       COUNT(*) FILTER (WHERE created_at >= date_trunc('day', NOW()))::int AS today_calls,
       COUNT(*) FILTER (WHERE created_at >= date_trunc('month', NOW()))::int AS month_calls,
       COUNT(*)::int AS lifetime_calls
     FROM llm_usage WHERE tenant_id = $1`,
    [tenantId]
  );

  const byPurpose = await query<{ purpose: string; calls: number; total_cost: string; total_tokens: number }>(
    `SELECT purpose,
            COUNT(*)::int AS calls,
            SUM(cost_usd)::text AS total_cost,
            (SUM(input_tokens) + SUM(output_tokens))::int AS total_tokens
     FROM llm_usage WHERE tenant_id = $1
     GROUP BY purpose ORDER BY SUM(cost_usd) DESC`,
    [tenantId]
  );

  const dailySeries = await query<{ day: string; cost: string; calls: number }>(
    `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
            SUM(cost_usd)::text AS cost,
            COUNT(*)::int AS calls
     FROM llm_usage
     WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
     GROUP BY day ORDER BY day`,
    [tenantId]
  );

  return NextResponse.json({
    totals: {
      today_usd: Number(totals.today),
      month_usd: Number(totals.month),
      lifetime_usd: Number(totals.lifetime),
      today_calls: totals.today_calls,
      month_calls: totals.month_calls,
      lifetime_calls: totals.lifetime_calls,
    },
    by_purpose: byPurpose.map(r => ({
      purpose: r.purpose,
      calls: r.calls,
      total_cost_usd: Number(r.total_cost),
      total_tokens: r.total_tokens,
    })),
    daily: dailySeries.map(r => ({ day: r.day, cost_usd: Number(r.cost), calls: r.calls })),
  });
}

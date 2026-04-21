import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireTenant } from '@/lib/require-tenant';
import { suggestMappings, type SuggestionInput } from '@/lib/mapping-suggester';

/**
 * POST /api/mappings/suggest
 *
 * Compute AI suggestions for any unmapped blocks in the current tenant's
 * drawings that don't already have a cached suggestion for the given
 * (consulting_engineer_id, rate_card_version) pair. Called lazily from
 * the review-queue page.
 *
 * Body (optional):
 *   consultingEngineerId: number | null  — scope suggestions to this CE
 *                                          and only compute for blocks
 *                                          in that CE's drawings
 *   block_names: string[]                — restrict to a subset
 *
 * Returns the new suggestions. Caller merges with the GET /api/mappings
 * response to render.
 */
export async function POST(request: Request) {
  const authed = await requireTenant();
  if (!authed.ok) return authed.response;
  const { tenantId } = authed.ctx;

  const body = await request.json().catch(() => ({}));
  const restrictTo: string[] | undefined = Array.isArray(body.block_names) ? body.block_names : undefined;
  const consultingEngineerId: number | null = body.consultingEngineerId ?? null;

  const [activeRcv] = await query<{ id: number }>(
    `SELECT id FROM (
       SELECT rate_card_version_id AS id, updated_at AS at, 0 AS rank FROM projects
       WHERE tenant_id = $1 AND rate_card_version_id IS NOT NULL
       UNION ALL
       SELECT id, imported_at AS at, 1 AS rank FROM rate_card_versions
       WHERE tenant_id = $1
     ) sub
     ORDER BY rank, at DESC LIMIT 1`,
    [tenantId]
  );
  if (!activeRcv) {
    return NextResponse.json({ error: 'No rate card imported for this tenant yet.' }, { status: 400 });
  }
  const rateCardVersionId = activeRcv.id;

  // Restrict the source drawings to this CE's projects when a CE is
  // specified. Otherwise process all tenant drawings (tenant-wide mode).
  const projectFilter = consultingEngineerId ? 'AND p.consulting_engineer_id = $3' : '';
  const sourceParams = consultingEngineerId
    ? [tenantId, rateCardVersionId, consultingEngineerId]
    : [tenantId, rateCardVersionId];

  const uncomputed = await query<{ name: string; layer: string | null; legend_data: unknown }>(
    `WITH tenant_blocks AS (
       SELECT DISTINCT ON (name) name, layer, legend_data
       FROM (
         SELECT fx->>'block_name' AS name,
                fx->>'layer' AS layer,
                d.extraction_result->'legend_data' AS legend_data,
                d.id AS drawing_id
         FROM drawings d
         JOIN projects p ON p.id = d.project_id,
              LATERAL jsonb_array_elements(d.extraction_result->'fixtures') AS fx
         WHERE p.tenant_id = $1 ${projectFilter}
           AND d.extraction_result IS NOT NULL
           AND jsonb_array_length(COALESCE(d.extraction_result->'pipes', '[]'::jsonb)) > 0
         UNION ALL
         SELECT pp->>'layer' AS name,
                pp->>'layer' AS layer,
                d.extraction_result->'legend_data' AS legend_data,
                d.id AS drawing_id
         FROM drawings d
         JOIN projects p ON p.id = d.project_id,
              LATERAL jsonb_array_elements(d.extraction_result->'pipes') AS pp
         WHERE p.tenant_id = $1 ${projectFilter}
           AND d.extraction_result IS NOT NULL
       ) sub
       WHERE name IS NOT NULL
         AND name !~* 'dwg[-_]'
         AND name !~* '^[0-9]{5}'
         AND name !~* '-[Dd]etail\\s*\\d+$'
       ORDER BY name, drawing_id DESC
     )
     SELECT tb.name, tb.layer, tb.legend_data
     FROM tenant_blocks tb
     WHERE NOT EXISTS (
       -- Skip blocks already mapped (CE-specific or tenant-wide)
       SELECT 1 FROM symbol_mappings sm
       WHERE sm.tenant_id = $1 AND sm.cad_block_name = tb.name
         AND (sm.consulting_engineer_id IS NOT DISTINCT FROM ${consultingEngineerId ? '$3' : 'NULL'}
              OR sm.consulting_engineer_id IS NULL)
     )
     AND NOT EXISTS (
       -- Skip blocks already suggested for this (CE, rate card) pair
       SELECT 1 FROM mapping_suggestions ms
       WHERE ms.tenant_id = $1 AND ms.cad_block_name = tb.name
         AND ms.rate_card_version_id = $2
         AND ms.consulting_engineer_id IS NOT DISTINCT FROM ${consultingEngineerId ? '$3' : 'NULL'}
     )`,
    sourceParams
  );

  const filtered = restrictTo
    ? uncomputed.filter(u => restrictTo.includes(u.name))
    : uncomputed;

  if (filtered.length === 0) {
    return NextResponse.json({ computed: 0, suggestions: [] });
  }

  const inputs: SuggestionInput[] = filtered.map(u => {
    const legend = (u.legend_data as { legend?: Array<{ symbol?: string; description?: string; size?: string; material?: string }> } | null)?.legend ?? [];
    const legend_matches = legend
      .filter(l => l.symbol && u.name.toUpperCase().includes(l.symbol.toUpperCase()))
      .map(l => ({ description: l.description ?? '', size: l.size ?? null, material: l.material ?? null }));
    return {
      cad_block_name: u.name,
      layer: u.layer,
      legend_matches,
    };
  });

  const BATCH_SIZE = 10;
  const allResults = [];
  try {
    for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
      const batch = inputs.slice(i, i + BATCH_SIZE);
      const results = await suggestMappings(tenantId, rateCardVersionId, batch, consultingEngineerId);
      allResults.push(...results);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isBilling = /credit balance|billing|payment/i.test(msg);
    return NextResponse.json({
      error: isBilling
        ? 'Anthropic API credits exhausted — top up at console.anthropic.com/settings/billing, then click "Re-run suggestions".'
        : `AI suggester failed: ${msg}`,
      computed: allResults.length,
      suggestions: allResults,
    }, { status: 502 });
  }

  return NextResponse.json({ computed: allResults.length, suggestions: allResults });
}

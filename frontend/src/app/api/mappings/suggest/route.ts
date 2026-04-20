import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireTenant } from '@/lib/require-tenant';
import { suggestMappings, type SuggestionInput } from '@/lib/mapping-suggester';

/**
 * POST /api/mappings/suggest
 *
 * Compute AI suggestions for any unmapped blocks in the current tenant's
 * drawings that don't already have a cached suggestion for the active
 * rate-card version. Called lazily from the review-queue page.
 *
 * Body (optional): { block_names?: string[] } — restrict to a subset.
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

  // Active rate card version (same fallback rule as GET /api/mappings):
  // prefer one attached to a recent project, otherwise the most recently
  // imported rate card for this tenant.
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

  // Build the set of (name, layer, legend_matches) that need a suggestion =
  // all unmapped blocks/pipe-layers in this tenant's drawings, minus the
  // ones already cached for this rate_card_version.
  //
  // Fixtures AND pipe layers are treated symmetrically — they're both CAD
  // identifiers that need to resolve to a rate-card line. The earlier
  // version only queried fixtures, which left pipes orphaned.
  //
  // We take one representative occurrence per name (most recent drawing)
  // so the legend_matches context is meaningful.
  const uncomputed = await query<{ name: string; layer: string | null; legend_data: unknown }>(
    `WITH tenant_blocks AS (
       SELECT DISTINCT ON (name) name, layer, legend_data
       FROM (
         -- Fixtures (INSERT blocks)
         SELECT fx->>'block_name' AS name,
                fx->>'layer' AS layer,
                d.extraction_result->'legend_data' AS legend_data,
                d.id AS drawing_id
         FROM drawings d
         JOIN projects p ON p.id = d.project_id,
              LATERAL jsonb_array_elements(d.extraction_result->'fixtures') AS fx
         WHERE p.tenant_id = $1
           AND d.extraction_result IS NOT NULL
           AND jsonb_array_length(COALESCE(d.extraction_result->'pipes', '[]'::jsonb)) > 0
         UNION ALL
         -- Pipe layers (polyline layer names)
         SELECT pp->>'layer' AS name,
                pp->>'layer' AS layer,
                d.extraction_result->'legend_data' AS legend_data,
                d.id AS drawing_id
         FROM drawings d
         JOIN projects p ON p.id = d.project_id,
              LATERAL jsonb_array_elements(d.extraction_result->'pipes') AS pp
         WHERE p.tenant_id = $1
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
       SELECT 1 FROM symbol_mappings sm
       WHERE sm.tenant_id = $1 AND sm.cad_block_name = tb.name
     )
     AND NOT EXISTS (
       SELECT 1 FROM mapping_suggestions ms
       WHERE ms.tenant_id = $1 AND ms.cad_block_name = tb.name
         AND ms.rate_card_version_id = $2
     )`,
    [tenantId, rateCardVersionId]
  );

  const filtered = restrictTo
    ? uncomputed.filter(u => restrictTo.includes(u.name))
    : uncomputed;

  if (filtered.length === 0) {
    return NextResponse.json({ computed: 0, suggestions: [] });
  }

  // Build SuggestionInput with legend_matches extracted where available.
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

  // Batch in chunks of 10 to keep each Claude call focused and the JSON
  // payload well under token limits. This is where API $ is spent.
  const BATCH_SIZE = 10;
  const allResults = [];
  try {
    for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
      const batch = inputs.slice(i, i + BATCH_SIZE);
      const results = await suggestMappings(tenantId, rateCardVersionId, batch);
      allResults.push(...results);
    }
  } catch (e) {
    // Surface the specific error up to the UI — previously threw generic
    // 500 with an HTML body, which made the client show "Unexpected end of
    // JSON input". Most common causes: Anthropic credit/billing issue,
    // rate limit, or malformed model response.
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

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireTenant } from '@/lib/require-tenant';
import { recordRejection } from '@/lib/mapping-suggester';

/**
 * GET /api/mappings
 *
 * Returns every CAD block/layer name discovered across the current tenant's
 * drawings (filtered to installation drawings that actually have pipes),
 * joined with:
 *   - the confirmed mapping from symbol_mappings, if any
 *   - the AI-suggested mapping from mapping_suggestions, if cached
 *
 * The UI uses `rate_card_item_id` (confirmed) as the authoritative
 * mapping, and falls back to `suggested_*` fields when unmapped.
 */
export async function GET() {
  const authed = await requireTenant();
  if (!authed.ok) return authed.response;
  const { tenantId } = authed.ctx;

  // The user's active rate card version. For now, we use the rate card
  // attached to the tenant's most recent project. Phase 3 will formalise
  // this as a per-tenant default.
  const [activeRcv] = await query<{ id: number }>(
    `SELECT rate_card_version_id AS id FROM projects
     WHERE tenant_id = $1 AND rate_card_version_id IS NOT NULL
     ORDER BY updated_at DESC LIMIT 1`,
    [tenantId]
  );
  const rateCardVersionId = activeRcv?.id ?? null;

  const blocks = await query<{ name: string; type: string; drawing_id: number; drawing_filename: string; project_name: string }>(
    `SELECT DISTINCT ON (name) name, 'block' AS type, drawing_id, drawing_filename, project_name
     FROM (
       SELECT jsonb_array_elements(d.extraction_result->'fixtures')->>'block_name' AS name,
              d.id AS drawing_id, d.filename AS drawing_filename, p.name AS project_name
       FROM drawings d
       JOIN projects p ON p.id = d.project_id
       WHERE p.tenant_id = $1
         AND d.extraction_result IS NOT NULL
         AND jsonb_array_length(COALESCE(d.extraction_result->'pipes', '[]'::jsonb)) > 0
     ) sub
     WHERE name IS NOT NULL
       AND name !~* 'dwg[-_]'
       AND name !~* '^[0-9]{5}'
       AND name !~* '-[Dd]etail\\s*\\d+$'
     ORDER BY name, drawing_id`,
    [tenantId]
  );

  const layers = await query<{ name: string; type: string; drawing_id: number; drawing_filename: string; project_name: string }>(
    `SELECT DISTINCT ON (name) name, 'layer' AS type, drawing_id, drawing_filename, project_name
     FROM (
       SELECT jsonb_array_elements(d.extraction_result->'pipes')->>'layer' AS name,
              d.id AS drawing_id, d.filename AS drawing_filename, p.name AS project_name
       FROM drawings d
       JOIN projects p ON p.id = d.project_id
       WHERE p.tenant_id = $1
         AND d.extraction_result IS NOT NULL
         AND jsonb_array_length(COALESCE(d.extraction_result->'pipes', '[]'::jsonb)) > 0
     ) sub
     WHERE name IS NOT NULL
     ORDER BY name, drawing_id`,
    [tenantId]
  );

  const allNames = [...blocks, ...layers].filter(r => r.name);

  // Confirmed mappings (symbol_mappings) — tenant-scoped.
  const mappings = await query<{ cad_block_name: string; rate_card_item_id: number; description: string; section_name: string }>(
    `SELECT sm.cad_block_name, sm.rate_card_item_id, rci.description, rci.section_name
     FROM symbol_mappings sm
     JOIN rate_card_items rci ON rci.id = sm.rate_card_item_id
     WHERE sm.tenant_id = $1`,
    [tenantId]
  );
  const mappingMap = Object.fromEntries(mappings.map(m => [m.cad_block_name, m]));

  // Cached AI suggestions — keyed by (tenant, block_name, rate_card_version).
  // Returns empty if no rate card is attached yet.
  const suggestions = rateCardVersionId
    ? await query<{
        cad_block_name: string;
        suggested_rate_card_item_id: number | null;
        confidence: 'high' | 'medium' | 'low' | null;
        reasoning: string | null;
        description: string | null;
        section_name: string | null;
        labour_rate: number | null;
        material_rate: number | null;
        uom: string | null;
      }>(
        `SELECT ms.cad_block_name, ms.suggested_rate_card_item_id, ms.confidence, ms.reasoning,
                rci.description, rci.section_name, rci.labour_rate, rci.material_rate, rci.uom
         FROM mapping_suggestions ms
         LEFT JOIN rate_card_items rci ON rci.id = ms.suggested_rate_card_item_id
         WHERE ms.tenant_id = $1 AND ms.rate_card_version_id = $2`,
        [tenantId, rateCardVersionId]
      )
    : [];
  const suggestionMap = Object.fromEntries(suggestions.map(s => [s.cad_block_name, s]));

  const result = allNames.map(({ name, type, drawing_id, drawing_filename, project_name }) => {
    const confirmed = mappingMap[name];
    const suggested = suggestionMap[name];
    return {
      name,
      type,
      drawing_id: drawing_id ?? null,
      drawing_filename: drawing_filename ?? null,
      project_name: project_name ?? null,
      rate_card_item_id: confirmed?.rate_card_item_id ?? null,
      rate_card_description: confirmed
        ? `${confirmed.section_name} — ${confirmed.description}`
        : null,
      // AI suggestion (only meaningful when rate_card_item_id is null)
      suggested_rate_card_item_id: suggested?.suggested_rate_card_item_id ?? null,
      suggested_description: suggested?.description
        ? `${suggested.section_name} — ${suggested.description}`
        : null,
      suggested_confidence: suggested?.confidence ?? null,
      suggested_reasoning: suggested?.reasoning ?? null,
      suggested_labour_rate: suggested?.labour_rate ?? null,
      suggested_material_rate: suggested?.material_rate ?? null,
      suggested_uom: suggested?.uom ?? null,
    };
  });

  return NextResponse.json({ rate_card_version_id: rateCardVersionId, rows: result });
}

/**
 * POST /api/mappings — confirm a mapping.
 *
 * If `rejectedRateCardItemId` is provided, it means the user is overriding
 * an AI suggestion. We record that rejection as feedback for future
 * suggester calls on the same block.
 */
export async function POST(request: NextRequest) {
  const authed = await requireTenant();
  if (!authed.ok) return authed.response;
  const { tenantId, userId } = authed.ctx;

  const { name, rateCardItemId, rejectedRateCardItemId, rejectedReasoning } = await request.json();
  if (!name || !rateCardItemId) {
    return NextResponse.json({ error: 'name and rateCardItemId required' }, { status: 400 });
  }

  await query(
    `DELETE FROM symbol_mappings WHERE tenant_id = $1 AND cad_block_name = $2`,
    [tenantId, name]
  );
  await query(
    `INSERT INTO symbol_mappings (tenant_id, cad_block_name, rate_card_item_id, created_by)
     VALUES ($1, $2, $3, $4)`,
    [tenantId, name, rateCardItemId, userId]
  );

  // Feedback loop: if the user rejected an AI suggestion in favour of
  // something else, record it so future suggestions avoid that mistake.
  if (rejectedRateCardItemId && rejectedRateCardItemId !== rateCardItemId) {
    await recordRejection({
      tenantId,
      userId,
      cadBlockName: name,
      rejectedRateCardItemId,
      chosenRateCardItemId: rateCardItemId,
      rejectedReasoning: rejectedReasoning ?? null,
    });
  }

  return NextResponse.json({ saved: true });
}

export async function DELETE(request: NextRequest) {
  const authed = await requireTenant();
  if (!authed.ok) return authed.response;
  const { tenantId } = authed.ctx;

  const { name } = await request.json();
  await query(
    `DELETE FROM symbol_mappings WHERE tenant_id = $1 AND cad_block_name = $2`,
    [tenantId, name]
  );
  return NextResponse.json({ deleted: true });
}

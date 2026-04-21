import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireTenant } from '@/lib/require-tenant';
import { recordRejection } from '@/lib/mapping-suggester';

/**
 * GET /api/mappings?consultingEngineerId=<id>
 *
 * Returns every CAD block/layer name discovered in this tenant's drawings,
 * enriched with the mapping resolution ladder:
 *
 *   1. CE-specific confirmed mapping (symbol_mappings with matching
 *      consulting_engineer_id) — the best match, takes priority
 *   2. Tenant-wide confirmed mapping (consulting_engineer_id NULL) —
 *      fallback for blocks that mean the same thing regardless of CE
 *   3. AI suggestion (mapping_suggestions, CE-scoped)
 *
 * When `consultingEngineerId` is supplied, suggestions and CE-specific
 * mappings filter to that CE. Without it, we return only tenant-wide
 * confirmed mappings (the pre-CE behaviour).
 */
export async function GET(request: NextRequest) {
  const authed = await requireTenant();
  if (!authed.ok) return authed.response;
  const { tenantId } = authed.ctx;

  const url = new URL(request.url);
  const ceIdRaw = url.searchParams.get('consultingEngineerId');
  const ceId = ceIdRaw ? Number(ceIdRaw) : null;

  // Active rate card version (CE-agnostic): prefer one attached to a recent
  // project, else the tenant's most recently imported rate card.
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
  const rateCardVersionId = activeRcv?.id ?? null;

  // Enumerate all block/layer names from this tenant's drawings. If CE is
  // specified, restrict to drawings belonging to projects for that CE so
  // the queue is scoped.
  const projectFilter = ceId ? 'AND p.consulting_engineer_id = $2' : '';
  const queryParams = ceId ? [tenantId, ceId] : [tenantId];

  const blocks = await query<{ name: string; type: string; drawing_id: number; drawing_filename: string; project_name: string }>(
    `SELECT DISTINCT ON (name) name, 'block' AS type, drawing_id, drawing_filename, project_name
     FROM (
       SELECT jsonb_array_elements(d.extraction_result->'fixtures')->>'block_name' AS name,
              d.id AS drawing_id, d.filename AS drawing_filename, p.name AS project_name
       FROM drawings d
       JOIN projects p ON p.id = d.project_id
       WHERE p.tenant_id = $1 ${projectFilter}
         AND d.extraction_result IS NOT NULL
         AND jsonb_array_length(COALESCE(d.extraction_result->'pipes', '[]'::jsonb)) > 0
     ) sub
     WHERE name IS NOT NULL
       AND name !~* 'dwg[-_]'
       AND name !~* '^[0-9]{5}'
       AND name !~* '-[Dd]etail\\s*\\d+$'
     ORDER BY name, drawing_id`,
    queryParams
  );

  const layers = await query<{ name: string; type: string; drawing_id: number; drawing_filename: string; project_name: string }>(
    `SELECT DISTINCT ON (name) name, 'layer' AS type, drawing_id, drawing_filename, project_name
     FROM (
       SELECT jsonb_array_elements(d.extraction_result->'pipes')->>'layer' AS name,
              d.id AS drawing_id, d.filename AS drawing_filename, p.name AS project_name
       FROM drawings d
       JOIN projects p ON p.id = d.project_id
       WHERE p.tenant_id = $1 ${projectFilter}
         AND d.extraction_result IS NOT NULL
         AND jsonb_array_length(COALESCE(d.extraction_result->'pipes', '[]'::jsonb)) > 0
     ) sub
     WHERE name IS NOT NULL
     ORDER BY name, drawing_id`,
    queryParams
  );

  const allNames = [...blocks, ...layers].filter(r => r.name);

  // Confirmed mappings: prefer CE-specific over tenant-wide. The CASE in
  // ORDER BY ensures that if both exist for the same block, the CE-specific
  // row wins (DISTINCT ON keeps the first per cad_block_name).
  interface MappingRow {
    cad_block_name: string;
    rate_card_item_id: number;
    description: string;
    section_name: string;
    consulting_engineer_id: number | null;
    scope: 'ce-specific' | 'tenant-wide';
  }
  const mappings = await query<MappingRow>(
    `SELECT DISTINCT ON (cad_block_name) cad_block_name, rate_card_item_id, description,
            section_name, consulting_engineer_id, scope
     FROM (
       SELECT sm.cad_block_name, sm.rate_card_item_id, rci.description,
              rci.section_name, sm.consulting_engineer_id,
              CASE WHEN sm.consulting_engineer_id = $2 THEN 'ce-specific'
                   WHEN sm.consulting_engineer_id IS NULL THEN 'tenant-wide'
              END AS scope,
              CASE WHEN sm.consulting_engineer_id = $2 THEN 1 ELSE 2 END AS priority
       FROM symbol_mappings sm
       JOIN rate_card_items rci ON rci.id = sm.rate_card_item_id
       WHERE sm.tenant_id = $1
         AND (sm.consulting_engineer_id = $2 OR sm.consulting_engineer_id IS NULL)
     ) sub
     ORDER BY cad_block_name, priority`,
    [tenantId, ceId]
  );
  const mappingMap = Object.fromEntries(mappings.map(m => [m.cad_block_name, m]));

  const usage = await query<{ name: string; usage_count: number; est_value: number }>(
    `SELECT
       COALESCE(ti.drawing_region->>'block_name', ti.drawing_region->>'layer') AS name,
       COUNT(*)::int AS usage_count,
       COALESCE(SUM(
         ti.extracted_qty * (COALESCE(rci.labour_rate,0) + COALESCE(rci.material_rate,0) + COALESCE(rci.plant_rate,0))
       ), 0)::float AS est_value
     FROM takeoff_items ti
     JOIN projects p ON p.id = ti.project_id
     LEFT JOIN rate_card_items rci ON rci.id = ti.rate_card_item_id
     WHERE p.tenant_id = $1
     GROUP BY COALESCE(ti.drawing_region->>'block_name', ti.drawing_region->>'layer')`,
    [tenantId]
  );
  const usageMap = Object.fromEntries(usage.filter(u => u.name).map(u => [u.name, u]));

  // AI suggestions — CE-scoped. Prefer CE-specific over NULL-scoped rows
  // the same way confirmed mappings do.
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
        `SELECT DISTINCT ON (ms.cad_block_name)
                ms.cad_block_name, ms.suggested_rate_card_item_id, ms.confidence, ms.reasoning,
                rci.description, rci.section_name, rci.labour_rate, rci.material_rate, rci.uom
         FROM mapping_suggestions ms
         LEFT JOIN rate_card_items rci ON rci.id = ms.suggested_rate_card_item_id
         WHERE ms.tenant_id = $1
           AND ms.rate_card_version_id = $2
           AND (ms.consulting_engineer_id = $3 OR ms.consulting_engineer_id IS NULL)
         ORDER BY ms.cad_block_name,
           CASE WHEN ms.consulting_engineer_id = $3 THEN 1 ELSE 2 END`,
        [tenantId, rateCardVersionId, ceId]
      )
    : [];
  const suggestionMap = Object.fromEntries(suggestions.map(s => [s.cad_block_name, s]));

  const result = allNames.map(({ name, type, drawing_id, drawing_filename, project_name }) => {
    const confirmed = mappingMap[name];
    const suggested = suggestionMap[name];
    const u = usageMap[name];
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
      // Scope tells the UI whether this was mapped just for this CE or
      // applies tenant-wide.
      mapping_scope: confirmed?.scope ?? null,
      usage_count: u?.usage_count ?? 0,
      est_value: u?.est_value ?? 0,
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

  return NextResponse.json({
    rate_card_version_id: rateCardVersionId,
    consulting_engineer_id: ceId,
    rows: result,
  });
}

/**
 * POST /api/mappings — confirm a mapping.
 *
 * Body:
 *   name                         required
 *   rateCardItemId               required
 *   consultingEngineerId         optional — null = tenant-wide mapping
 *                                (applies to every CE this tenant has seen);
 *                                number = only applies when drawings come
 *                                from that specific CE
 *   rejectedRateCardItemId       optional — triggers feedback-loop record
 *   rejectedReasoning            optional — AI's original reasoning
 */
export async function POST(request: NextRequest) {
  const authed = await requireTenant();
  if (!authed.ok) return authed.response;
  const { tenantId, userId } = authed.ctx;

  const { name, rateCardItemId, consultingEngineerId, rejectedRateCardItemId, rejectedReasoning } = await request.json();
  if (!name || !rateCardItemId) {
    return NextResponse.json({ error: 'name and rateCardItemId required' }, { status: 400 });
  }

  const ceId: number | null = consultingEngineerId ?? null;

  // Delete existing mapping for this exact (tenant, CE, name) triple. We
  // use IS NOT DISTINCT FROM so NULL matches NULL (standard = treats
  // NULL = NULL as NULL, not TRUE).
  await query(
    `DELETE FROM symbol_mappings
     WHERE tenant_id = $1 AND cad_block_name = $2
       AND consulting_engineer_id IS NOT DISTINCT FROM $3`,
    [tenantId, name, ceId]
  );
  await query(
    `INSERT INTO symbol_mappings (tenant_id, consulting_engineer_id, cad_block_name, rate_card_item_id, created_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, ceId, name, rateCardItemId, userId]
  );

  if (rejectedRateCardItemId && rejectedRateCardItemId !== rateCardItemId) {
    await recordRejection({
      tenantId,
      userId,
      consultingEngineerId: ceId,
      cadBlockName: name,
      rejectedRateCardItemId,
      chosenRateCardItemId: rateCardItemId,
      rejectedReasoning: rejectedReasoning ?? null,
    });
  }

  return NextResponse.json({ saved: true });
}

/**
 * DELETE /api/mappings — clear a mapping.
 * Body: { name, consultingEngineerId? } — scope defaults to tenant-wide
 * (NULL); pass a CE id to clear only the CE-specific override.
 */
export async function DELETE(request: NextRequest) {
  const authed = await requireTenant();
  if (!authed.ok) return authed.response;
  const { tenantId } = authed.ctx;

  const { name, consultingEngineerId } = await request.json();
  const ceId: number | null = consultingEngineerId ?? null;
  await query(
    `DELETE FROM symbol_mappings
     WHERE tenant_id = $1 AND cad_block_name = $2
       AND consulting_engineer_id IS NOT DISTINCT FROM $3`,
    [tenantId, name, ceId]
  );
  return NextResponse.json({ deleted: true });
}

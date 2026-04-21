import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { extractDrawing } from '@/lib/extraction-client';
import { requireTenant } from '@/lib/require-tenant';
import { recordLlmUsage } from '@/lib/llm-usage';
import { detectFirms, upsertFirm } from '@/lib/firm-detector';

interface LegendDataWithUsage {
  _usage?: {
    purpose: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    request_id?: string | null;
  };
}

interface ExtractionResult {
  annotations?: Array<{ text?: string; layer?: string; position?: unknown }>;
  fixtures?: Array<{ block_name?: string; layer?: string }>;
  pipes?: Array<{ layer?: string }>;
  legend_data?: LegendDataWithUsage | null;
}

export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authed = await requireTenant();
  if (!authed.ok) return authed.response;
  const { tenantId } = authed.ctx;

  const { id } = await params;

  const drawings = await query<{ id: number; file_path: string; filename: string; format: string }>(
    `SELECT d.* FROM drawings d
     JOIN projects p ON p.id = d.project_id
     WHERE d.project_id = $1 AND p.tenant_id = $2 AND d.extraction_status = 'pending'`,
    [id, tenantId]
  );

  if (drawings.length === 0) {
    return NextResponse.json({ message: 'No pending drawings to extract' });
  }

  const [project] = await query<{ consulting_engineer_id: number | null; builder_id: number | null }>(
    'SELECT consulting_engineer_id, builder_id FROM projects WHERE id = $1',
    [id]
  );
  let projectCeId = project?.consulting_engineer_id ?? null;
  let projectBuilderId = project?.builder_id ?? null;

  const results = [];
  for (const drawing of drawings) {
    await query(
      "UPDATE drawings SET extraction_status = 'processing', extraction_started_at = now(), extraction_completed_at = NULL WHERE id = $1",
      [drawing.id]
    );

    try {
      const result = await extractDrawing(drawing.file_path, drawing.filename) as ExtractionResult;

      // Log Python-side legend_parser usage if present.
      const legend = result.legend_data;
      if (legend && typeof legend === 'object' && legend._usage) {
        const u = legend._usage;
        await recordLlmUsage(tenantId, {
          purpose: u.purpose,
          model: u.model,
          input_tokens: u.input_tokens,
          output_tokens: u.output_tokens,
          cache_creation_input_tokens: u.cache_creation_input_tokens,
          cache_read_input_tokens: u.cache_read_input_tokens,
          request_id: u.request_id,
        });
        delete legend._usage;
      }

      // Detect consulting engineer AND builder in one Claude call.
      const detection = await detectFirms(tenantId, {
        annotations: (result.annotations ?? []).map(a => ({
          text: a.text ?? '',
          position: a.position,
          layer: a.layer,
        })),
        blockNames: Array.from(new Set((result.fixtures ?? []).map(f => f.block_name ?? '').filter(Boolean))),
        layerNames: Array.from(new Set([
          ...(result.fixtures ?? []).map(f => f.layer ?? ''),
          ...(result.pipes ?? []).map(p => p.layer ?? ''),
        ].filter(Boolean))),
      });

      // Upsert each detected firm into the right table. If the firm
      // already exists (by slug), we reuse its id. Empty names skip.
      let detectedCeId: number | null = null;
      if (detection.consulting_engineer.name) {
        detectedCeId = await upsertFirm('consulting_engineers', tenantId, detection.consulting_engineer.name);
      }
      let detectedBuilderId: number | null = null;
      if (detection.builder.name) {
        detectedBuilderId = await upsertFirm('builders', tenantId, detection.builder.name);
      }

      await query(
        `UPDATE drawings SET extraction_status = 'complete',
                              extraction_result = $1,
                              extraction_completed_at = now(),
                              detected_consulting_engineer_id = $2,
                              detected_ce_confidence = $3,
                              detected_ce_evidence = $4
         WHERE id = $5`,
        [
          JSON.stringify(result),
          detectedCeId,
          detection.consulting_engineer.confidence,
          detection.consulting_engineer.evidence,
          drawing.id,
        ]
      );

      // Auto-attach project to detected CE if not already set and detection
      // is "high" confidence. Medium/low require manual confirmation so we
      // don't accidentally train the wrong dictionary.
      if (!projectCeId && detectedCeId && detection.consulting_engineer.confidence === 'high') {
        await query(
          'UPDATE projects SET consulting_engineer_id = $1 WHERE id = $2 AND consulting_engineer_id IS NULL',
          [detectedCeId, id]
        );
        projectCeId = detectedCeId;
      }
      // Same rule for builder.
      if (!projectBuilderId && detectedBuilderId && detection.builder.confidence === 'high') {
        await query(
          'UPDATE projects SET builder_id = $1 WHERE id = $2 AND builder_id IS NULL',
          [detectedBuilderId, id]
        );
        projectBuilderId = detectedBuilderId;
      }

      results.push({
        id: drawing.id,
        status: 'complete',
        detected_ce: detection.consulting_engineer.name,
        detected_ce_confidence: detection.consulting_engineer.confidence,
        detected_builder: detection.builder.name,
        detected_builder_confidence: detection.builder.confidence,
      });
    } catch (error) {
      await query(
        "UPDATE drawings SET extraction_status = 'failed', extraction_completed_at = now() WHERE id = $1",
        [drawing.id]
      );
      results.push({ id: drawing.id, status: 'failed', error: String(error) });
    }
  }

  return NextResponse.json(results);
}

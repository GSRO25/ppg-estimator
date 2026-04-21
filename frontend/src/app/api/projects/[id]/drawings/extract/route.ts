import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { extractDrawing } from '@/lib/extraction-client';
import { requireTenant } from '@/lib/require-tenant';
import { recordLlmUsage } from '@/lib/llm-usage';
import { detectConsultingEngineer } from '@/lib/ce-detector';

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

  // Current project CE — if already set, don't auto-override; we still run
  // detection per drawing for the telemetry, but the project's binding is
  // sticky once established.
  const [project] = await query<{ consulting_engineer_id: number | null }>(
    'SELECT consulting_engineer_id FROM projects WHERE id = $1',
    [id]
  );
  let projectCeId = project?.consulting_engineer_id ?? null;

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

      // Auto-detect consulting engineer from this drawing's content. Runs
      // even when the project already has a CE so that individual drawings
      // get their own detection record (useful if someone uploads mixed
      // drawings by mistake).
      const detection = await detectConsultingEngineer(tenantId, {
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
          detection.consulting_engineer_id,
          detection.confidence,
          detection.evidence,
          drawing.id,
        ]
      );

      // Auto-attach the project to the detected CE if:
      //   - project has no CE yet
      //   - detection is high-confidence
      // Medium/low needs manual confirmation so we don't accidentally
      // train the wrong dictionary.
      if (!projectCeId && detection.consulting_engineer_id && detection.confidence === 'high') {
        await query(
          'UPDATE projects SET consulting_engineer_id = $1 WHERE id = $2 AND consulting_engineer_id IS NULL',
          [detection.consulting_engineer_id, id]
        );
        projectCeId = detection.consulting_engineer_id;
      }

      results.push({
        id: drawing.id,
        status: 'complete',
        detected_ce: detection.consulting_engineer_name,
        detected_confidence: detection.confidence,
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

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { extractDrawing } from '@/lib/extraction-client';
import { requireTenant } from '@/lib/require-tenant';
import { recordLlmUsage } from '@/lib/llm-usage';

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

export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authed = await requireTenant();
  if (!authed.ok) return authed.response;
  const { tenantId } = authed.ctx;

  const { id } = await params;

  // Only extract drawings that belong to a project in this tenant.
  const drawings = await query<{ id: number; file_path: string; filename: string; format: string }>(
    `SELECT d.* FROM drawings d
     JOIN projects p ON p.id = d.project_id
     WHERE d.project_id = $1 AND p.tenant_id = $2 AND d.extraction_status = 'pending'`,
    [id, tenantId]
  );

  if (drawings.length === 0) {
    return NextResponse.json({ message: 'No pending drawings to extract' });
  }

  const results = [];
  for (const drawing of drawings) {
    await query(
      "UPDATE drawings SET extraction_status = 'processing', extraction_started_at = now(), extraction_completed_at = NULL WHERE id = $1",
      [drawing.id]
    );

    try {
      const result = await extractDrawing(drawing.file_path, drawing.filename);

      // Forward Python-side legend_parser usage into the tenant-scoped
      // llm_usage table. Strip _usage from the stored legend_data so the
      // extraction_result JSONB stays clean.
      const legend = result.legend_data as LegendDataWithUsage | null | undefined;
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

      await query(
        "UPDATE drawings SET extraction_status = 'complete', extraction_result = $1, extraction_completed_at = now() WHERE id = $2",
        [JSON.stringify(result), drawing.id]
      );
      results.push({ id: drawing.id, status: 'complete' });
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

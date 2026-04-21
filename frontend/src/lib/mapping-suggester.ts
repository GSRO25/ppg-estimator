import Anthropic from '@anthropic-ai/sdk';
import { query } from '@/lib/db';
import { recordLlmUsage } from '@/lib/llm-usage';

/**
 * mapping_suggester — given a batch of CAD block names (and their layer +
 * legend context + source consulting engineer), ask Claude to pick the
 * best rate-card match for each, with a confidence level and brief reasoning.
 *
 * Results are cached in mapping_suggestions keyed by
 * (tenant_id, consulting_engineer_id, cad_block_name, rate_card_version_id)
 * so each unique block is only asked about once per (CE, rate card) pair.
 * Two CEs drafting the same block name independently get separate cache
 * entries and can legitimately resolve to different rate-card items.
 *
 * Feedback loop: mapping_suggestion_feedback rows for the same tenant +
 * block (optionally CE-scoped) are folded into the prompt as "do not pick"
 * examples, so the model learns from past corrections without fine-tuning.
 */

export interface SuggestionInput {
  cad_block_name: string;
  layer?: string | null;
  legend_matches?: Array<{ description: string; size?: string | null; material?: string | null }>;
}

export interface SuggestionOutput {
  cad_block_name: string;
  rate_card_item_id: number | null;
  confidence: 'high' | 'medium' | 'low' | null;
  reasoning: string;
  prompt_version: number;
}

let _client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  _client = new Anthropic({ apiKey });
  return _client;
}

interface RateCardRow {
  id: number;
  section_number: number;
  section_name: string;
  description: string;
  uom: string | null;
}

interface PromptRow {
  id: number;
  version: number;
  system_prompt: string;
}

interface FeedbackRow {
  cad_block_name: string;
  rejected_rate_card_item_id: number | null;
  chosen_rate_card_item_id: number | null;
}

interface ConsultingEngineerRow {
  id: number;
  name: string;
  slug: string;
}

/**
 * Run a batch of suggestions. When `consultingEngineerId` is supplied, the
 * CE's name is passed to the model as context (helps it interpret
 * firm-specific block naming conventions) and results are cached scoped
 * to that CE. Pass null for tenant-wide suggestions.
 */
export async function suggestMappings(
  tenantId: number,
  rateCardVersionId: number,
  inputs: SuggestionInput[],
  consultingEngineerId: number | null = null
): Promise<SuggestionOutput[]> {
  if (inputs.length === 0) return [];

  const client = getClient();
  if (!client) {
    return inputs.map(i => ({
      cad_block_name: i.cad_block_name,
      rate_card_item_id: null,
      confidence: null,
      reasoning: 'ANTHROPIC_API_KEY not configured; suggestion skipped.',
      prompt_version: 0,
    }));
  }

  const [prompt] = await query<PromptRow>(
    `SELECT id, version, system_prompt FROM prompts
     WHERE name = 'mapping_suggester' AND is_active = TRUE
       AND (tenant_id = $1 OR tenant_id IS NULL)
     ORDER BY tenant_id NULLS LAST LIMIT 1`,
    [tenantId]
  );
  if (!prompt) throw new Error('No active mapping_suggester prompt found');

  const rateItems = await query<RateCardRow>(
    `SELECT id, section_number, section_name, description, uom
     FROM rate_card_items
     WHERE rate_card_version_id = $1
     ORDER BY section_number, sort_order`,
    [rateCardVersionId]
  );

  // Fetch the CE's name for the prompt context.
  let ceContext: ConsultingEngineerRow | null = null;
  if (consultingEngineerId) {
    const [row] = await query<ConsultingEngineerRow>(
      `SELECT id, name, slug FROM consulting_engineers WHERE id = $1`,
      [consultingEngineerId]
    );
    ceContext = row ?? null;
  }

  // Load past rejections. Prefer CE-specific rejections; fall back to
  // tenant-wide ones so early use (before CE-scoped rejections exist) still
  // benefits from past corrections.
  const blockNames = Array.from(new Set(inputs.map(i => i.cad_block_name)));
  const feedback = await query<FeedbackRow>(
    `SELECT cad_block_name, rejected_rate_card_item_id, chosen_rate_card_item_id
     FROM mapping_suggestion_feedback
     WHERE tenant_id = $1 AND cad_block_name = ANY($2)
       AND (consulting_engineer_id IS NOT DISTINCT FROM $3
            OR consulting_engineer_id IS NULL)`,
    [tenantId, blockNames, consultingEngineerId]
  );
  const feedbackByBlock = new Map<string, FeedbackRow[]>();
  for (const f of feedback) {
    const list = feedbackByBlock.get(f.cad_block_name) ?? [];
    list.push(f);
    feedbackByBlock.set(f.cad_block_name, list);
  }

  const userPayload = {
    consulting_engineer: ceContext ? { name: ceContext.name, slug: ceContext.slug } : null,
    rate_card_items: rateItems.map(r => ({
      id: r.id,
      section: `${r.section_number} — ${r.section_name}`,
      description: r.description,
      uom: r.uom,
    })),
    blocks: inputs.map(i => ({
      cad_block_name: i.cad_block_name,
      layer: i.layer ?? null,
      legend_matches: i.legend_matches ?? [],
      previous_rejections: (feedbackByBlock.get(i.cad_block_name) ?? []).map(f => ({
        rejected_rate_card_item_id: f.rejected_rate_card_item_id,
        chosen_rate_card_item_id: f.chosen_rate_card_item_id,
      })),
    })),
  };

  const batchInstruction = `
You will receive one rate_card_items catalog and an array of "blocks" to map.
The "consulting_engineer" field identifies the firm that drew these drawings —
use that as context for interpreting their drafting conventions (block names,
layer names, abbreviations). Different firms use different conventions: e.g.
Jacobs prefers H_* prefixes for hydraulic blocks; other firms may use P_* or
descriptive names. Let this inform your match.

Return STRICT JSON ONLY in this exact shape — one object per input block, in
the same order:
{
  "suggestions": [
    {
      "cad_block_name": "<echoed from input>",
      "rate_card_item_id": <number|null>,
      "confidence": "high"|"medium"|"low"|null,
      "reasoning": "<one sentence>"
    },
    ...
  ]
}`;

  const systemWithBatch = prompt.system_prompt + '\n\n' + batchInstruction;

  const model = 'claude-opus-4-7';
  const msg = await client.messages.create({
    model,
    max_tokens: 4000,
    system: systemWithBatch,
    messages: [{ role: 'user', content: JSON.stringify(userPayload) }],
  });

  await recordLlmUsage(tenantId, {
    purpose: 'mapping_suggester',
    model,
    input_tokens: msg.usage?.input_tokens ?? 0,
    output_tokens: msg.usage?.output_tokens ?? 0,
    cache_creation_input_tokens: msg.usage?.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: msg.usage?.cache_read_input_tokens ?? 0,
    request_id: msg.id ?? null,
  });

  const firstBlock = msg.content[0];
  if (firstBlock.type !== 'text') throw new Error('Unexpected non-text response from Claude');
  let text = firstBlock.text.trim();
  if (text.startsWith('```')) {
    text = text.split('```')[1];
    if (text.startsWith('json')) text = text.slice(4);
    text = text.trim();
  }
  const parsed = JSON.parse(text) as {
    suggestions: Array<{
      cad_block_name: string;
      rate_card_item_id: number | null;
      confidence: 'high' | 'medium' | 'low' | null;
      reasoning: string;
    }>;
  };

  const byBlock = new Map(parsed.suggestions.map(s => [s.cad_block_name, s]));

  const outputs: SuggestionOutput[] = [];
  for (const input of inputs) {
    const s = byBlock.get(input.cad_block_name);
    const out: SuggestionOutput = {
      cad_block_name: input.cad_block_name,
      rate_card_item_id: s?.rate_card_item_id ?? null,
      confidence: s?.confidence ?? null,
      reasoning: s?.reasoning ?? 'Model did not return a suggestion for this block.',
      prompt_version: prompt.version,
    };
    outputs.push(out);

    // Cache. DELETE+INSERT avoids the ON CONFLICT-on-expression-index
    // syntax dance. The unique index uses COALESCE(consulting_engineer_id, 0)
    // so NULL-scoped rows are distinct cache entries from CE-scoped ones.
    // IS NOT DISTINCT FROM handles NULL comparison correctly.
    await query(
      `DELETE FROM mapping_suggestions
       WHERE tenant_id = $1
         AND consulting_engineer_id IS NOT DISTINCT FROM $2
         AND cad_block_name = $3
         AND rate_card_version_id = $4`,
      [tenantId, consultingEngineerId, input.cad_block_name, rateCardVersionId]
    );
    await query(
      `INSERT INTO mapping_suggestions
         (tenant_id, consulting_engineer_id, cad_block_name, rate_card_version_id,
          suggested_rate_card_item_id, confidence, reasoning, prompt_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [tenantId, consultingEngineerId, input.cad_block_name, rateCardVersionId,
       out.rate_card_item_id, out.confidence, out.reasoning, out.prompt_version]
    );
  }

  return outputs;
}

/**
 * Record that an estimator rejected a suggestion and picked something else.
 * Stored scoped to the CE so future suggestions for the same firm avoid
 * the same mistake.
 */
export async function recordRejection(params: {
  tenantId: number;
  userId: number;
  consultingEngineerId: number | null;
  cadBlockName: string;
  rejectedRateCardItemId: number | null;
  chosenRateCardItemId: number | null;
  rejectedReasoning: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO mapping_suggestion_feedback
       (tenant_id, consulting_engineer_id, cad_block_name,
        rejected_rate_card_item_id, chosen_rate_card_item_id,
        rejected_reasoning, user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [params.tenantId, params.consultingEngineerId, params.cadBlockName,
     params.rejectedRateCardItemId, params.chosenRateCardItemId,
     params.rejectedReasoning, params.userId]
  );
}

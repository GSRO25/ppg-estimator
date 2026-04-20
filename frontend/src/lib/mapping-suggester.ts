import Anthropic from '@anthropic-ai/sdk';
import { query } from '@/lib/db';

/**
 * mapping_suggester — given a batch of CAD block names (and their layer +
 * legend context), ask Claude to pick the best rate-card match for each,
 * with a confidence level and brief reasoning.
 *
 * Results are cached in mapping_suggestions keyed by
 * (tenant_id, cad_block_name, rate_card_version_id) so each unique block
 * is only ever asked about once per rate-card version.
 *
 * Feedback loop: mapping_suggestion_feedback rows for the same tenant +
 * block are folded into the prompt as "rejected examples", so the model
 * learns from past corrections without fine-tuning.
 */

export interface SuggestionInput {
  cad_block_name: string;
  layer?: string | null;
  // Legend hits from this block's source drawing (e.g. { symbol: "WM", description: "20mm Water Meter" })
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

/**
 * Run a batch of suggestions. Returns one output per input. Writes results
 * (including nulls) to mapping_suggestions so a subsequent call for the
 * same (tenant, block, rate_card_version) trio is cache-only.
 */
export async function suggestMappings(
  tenantId: number,
  rateCardVersionId: number,
  inputs: SuggestionInput[]
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

  // Load the active mapping_suggester prompt. Tenant-specific prompt wins
  // over the global default.
  const [prompt] = await query<PromptRow>(
    `SELECT id, version, system_prompt FROM prompts
     WHERE name = 'mapping_suggester' AND is_active = TRUE
       AND (tenant_id = $1 OR tenant_id IS NULL)
     ORDER BY tenant_id NULLS LAST LIMIT 1`,
    [tenantId]
  );
  if (!prompt) throw new Error('No active mapping_suggester prompt found');

  // Load the full rate card once — we pass it to the model as JSON context
  // so it can pick the best match by id.
  const rateItems = await query<RateCardRow>(
    `SELECT id, section_number, section_name, description, uom
     FROM rate_card_items
     WHERE rate_card_version_id = $1
     ORDER BY section_number, sort_order`,
    [rateCardVersionId]
  );

  // Load past rejections for these blocks (tenant-scoped) and group by
  // block name so we can include them as "do not pick" examples per block.
  const blockNames = Array.from(new Set(inputs.map(i => i.cad_block_name)));
  const feedback = await query<FeedbackRow>(
    `SELECT cad_block_name, rejected_rate_card_item_id, chosen_rate_card_item_id
     FROM mapping_suggestion_feedback
     WHERE tenant_id = $1 AND cad_block_name = ANY($2)`,
    [tenantId, blockNames]
  );
  const feedbackByBlock = new Map<string, FeedbackRow[]>();
  for (const f of feedback) {
    const list = feedbackByBlock.get(f.cad_block_name) ?? [];
    list.push(f);
    feedbackByBlock.set(f.cad_block_name, list);
  }

  // Build a single LLM call containing all inputs. One round-trip per batch
  // of ~10 is dramatically cheaper than one call per block.
  const userPayload = {
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

  // Batch-wrapping instruction appended to the stored system prompt so the
  // model returns one array, not N separate JSON blobs.
  const batchInstruction = `
You will receive one rate_card_items catalog and an array of "blocks" to map.
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

  const msg = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 4000,
    system: systemWithBatch,
    messages: [{ role: 'user', content: JSON.stringify(userPayload) }],
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

  // Index by block name so we tolerate the model returning suggestions in
  // a different order than inputs.
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

    // Cache (UPSERT). Even null suggestions are cached so we don't waste API
    // calls re-asking about blocks the model had nothing to say about.
    await query(
      `INSERT INTO mapping_suggestions
         (tenant_id, cad_block_name, rate_card_version_id,
          suggested_rate_card_item_id, confidence, reasoning, prompt_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tenant_id, cad_block_name, rate_card_version_id)
       DO UPDATE SET
         suggested_rate_card_item_id = EXCLUDED.suggested_rate_card_item_id,
         confidence = EXCLUDED.confidence,
         reasoning = EXCLUDED.reasoning,
         prompt_version = EXCLUDED.prompt_version,
         computed_at = NOW()`,
      [tenantId, input.cad_block_name, rateCardVersionId, out.rate_card_item_id, out.confidence, out.reasoning, out.prompt_version]
    );
  }

  return outputs;
}

/**
 * Record that an estimator rejected a suggestion and picked something else.
 * Feeds future suggestion calls as a "do not pick" example for the same
 * block name.
 */
export async function recordRejection(params: {
  tenantId: number;
  userId: number;
  cadBlockName: string;
  rejectedRateCardItemId: number | null;
  chosenRateCardItemId: number | null;
  rejectedReasoning: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO mapping_suggestion_feedback
       (tenant_id, cad_block_name, rejected_rate_card_item_id,
        chosen_rate_card_item_id, rejected_reasoning, user_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [params.tenantId, params.cadBlockName, params.rejectedRateCardItemId,
     params.chosenRateCardItemId, params.rejectedReasoning, params.userId]
  );
}

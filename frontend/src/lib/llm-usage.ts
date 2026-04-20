import { query } from '@/lib/db';

// Anthropic published list prices per million tokens (USD). Stored on each
// llm_usage row at call time so future price changes don't rewrite history.
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-7':   { input: 15, output: 75 },
  'claude-sonnet-4-6': { input: 3,  output: 15 },
  'claude-haiku-4-5':  { input: 1,  output: 5 },
};

export interface UsageRecord {
  purpose: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  request_id?: string | null;
}

/**
 * Log a single Claude API call into llm_usage. Best-effort — any failure is
 * caught so the caller never breaks on telemetry. Works whether the call
 * was made server-side by mapping_suggester (Node SDK) or forwarded up from
 * the Python legend_parser via the ExtractionResult.
 */
export async function recordLlmUsage(tenantId: number, usage: UsageRecord): Promise<void> {
  try {
    const price = PRICING[usage.model] ?? { input: 15, output: 75 };
    const inputTokens = usage.input_tokens ?? 0;
    const outputTokens = usage.output_tokens ?? 0;
    const cacheCreate = usage.cache_creation_input_tokens ?? 0;
    const cacheRead = usage.cache_read_input_tokens ?? 0;
    // Cache reads billed at 10% of input price; writes at 125%.
    const cost =
      (inputTokens * price.input / 1_000_000) +
      (outputTokens * price.output / 1_000_000) +
      (cacheRead * price.input * 0.1 / 1_000_000) +
      (cacheCreate * price.input * 1.25 / 1_000_000);
    await query(
      `INSERT INTO llm_usage (tenant_id, purpose, model, input_tokens, output_tokens,
                              cache_creation_input_tokens, cache_read_input_tokens,
                              input_price_per_million, output_price_per_million,
                              cost_usd, request_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [tenantId, usage.purpose, usage.model, inputTokens, outputTokens,
       cacheCreate, cacheRead, price.input, price.output, cost, usage.request_id ?? null]
    );
  } catch (e) {
    console.error('[llm_usage] failed to record', e);
  }
}

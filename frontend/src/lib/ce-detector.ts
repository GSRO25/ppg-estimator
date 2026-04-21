import Anthropic from '@anthropic-ai/sdk';
import { query } from '@/lib/db';
import { recordLlmUsage } from '@/lib/llm-usage';

/**
 * ce-detector — identify which consulting engineer drew a given drawing.
 *
 * Called from the extract route AFTER extraction completes. Takes the
 * extraction result's annotations + fixture block names + pipe layer names
 * and asks Claude to match against the tenant-visible CE list.
 *
 * Results:
 *   - confident match → drawing is auto-tagged, project's
 *     consulting_engineer_id is set if still empty
 *   - no match → drawing stays unattributed, UI prompts user on first visit
 *
 * Cost: ~$0.005–0.02 per drawing.
 */

interface DetectionInput {
  annotations: Array<{ text: string; position?: unknown; layer?: string }>;
  blockNames: string[];
  layerNames: string[];
}

export interface DetectionResult {
  consulting_engineer_id: number | null;
  consulting_engineer_name: string | null;
  confidence: 'high' | 'medium' | 'low' | null;
  evidence: string | null;
}

interface CERow {
  id: number;
  name: string;
}

const SYSTEM_PROMPT = `You are analyzing Australian hydraulic/plumbing CAD drawings to identify the drafting firm (consulting engineer) that drew them.

You will receive:
  - Text annotations extracted from the drawing (typically includes title block text, firm names in footers, drafter initials)
  - CAD block names used in the drawing
  - CAD layer names used in the drawing
  - A candidate list of known consulting engineers

Rules:
  1. Only return a name from the candidate list. Never invent a firm name.
  2. Primary signal: title block text. A direct firm name match in annotations is HIGH confidence.
  3. Secondary signal: block/layer naming conventions. Some firms have house styles (e.g. H_* prefixes). Distinctive naming without title-block evidence = MEDIUM or LOW.
  4. If signals conflict, prefer title block over conventions.
  5. If no candidate is plausibly the author, return match: null with confidence: null.
  6. Never return "high" confidence without a direct title-block match.

Return STRICT JSON ONLY (no markdown):
{
  "match": "<firm name exactly as in candidate list>" | null,
  "confidence": "high" | "medium" | "low" | null,
  "evidence": "<one short sentence pointing to the signal>"
}`;

let _client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  _client = new Anthropic({ apiKey });
  return _client;
}

/**
 * Detect the consulting engineer that drew this drawing. Tenant-scoped —
 * candidates are the list of CEs visible to this tenant (seed + custom).
 */
export async function detectConsultingEngineer(
  tenantId: number,
  input: DetectionInput
): Promise<DetectionResult> {
  const client = getClient();
  if (!client) {
    return { consulting_engineer_id: null, consulting_engineer_name: null, confidence: null, evidence: 'ANTHROPIC_API_KEY not set' };
  }

  const candidates = await query<CERow>(
    `SELECT id, name FROM consulting_engineers
     WHERE tenant_id = $1 OR tenant_id IS NULL
     ORDER BY name`,
    [tenantId]
  );
  if (candidates.length === 0) {
    return { consulting_engineer_id: null, consulting_engineer_name: null, confidence: null, evidence: 'no CE candidates' };
  }
  const candidateNames = candidates.map(c => c.name);

  const payload = {
    annotations: input.annotations
      .filter(a => a.text && a.text.trim().length > 0)
      .slice(0, 300),
    block_names: input.blockNames.slice(0, 80),
    layer_names: input.layerNames.slice(0, 80),
    candidates: candidateNames,
  };

  try {
    const model = 'claude-opus-4-7';
    const msg = await client.messages.create({
      model,
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
    });

    await recordLlmUsage(tenantId, {
      purpose: 'ce_detector',
      model,
      input_tokens: msg.usage?.input_tokens ?? 0,
      output_tokens: msg.usage?.output_tokens ?? 0,
      cache_creation_input_tokens: msg.usage?.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: msg.usage?.cache_read_input_tokens ?? 0,
      request_id: msg.id ?? null,
    });

    const firstBlock = msg.content[0];
    if (firstBlock.type !== 'text') throw new Error('Non-text response');
    let text = firstBlock.text.trim();
    if (text.startsWith('```')) {
      text = text.split('```')[1];
      if (text.startsWith('json')) text = text.slice(4);
      text = text.trim();
    }
    const parsed = JSON.parse(text) as {
      match: string | null;
      confidence: 'high' | 'medium' | 'low' | null;
      evidence: string | null;
    };

    if (!parsed.match) {
      return { consulting_engineer_id: null, consulting_engineer_name: null, confidence: null, evidence: parsed.evidence };
    }

    // Match name back to an id. Case-insensitive to tolerate minor casing drift.
    const matched = candidates.find(c => c.name.toLowerCase() === parsed.match!.toLowerCase());
    if (!matched) {
      return { consulting_engineer_id: null, consulting_engineer_name: null, confidence: null,
               evidence: `Model returned name not in candidate list: ${parsed.match}` };
    }
    return {
      consulting_engineer_id: matched.id,
      consulting_engineer_name: matched.name,
      confidence: parsed.confidence,
      evidence: parsed.evidence,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { consulting_engineer_id: null, consulting_engineer_name: null, confidence: null, evidence: msg };
  }
}

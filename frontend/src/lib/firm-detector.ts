import Anthropic from '@anthropic-ai/sdk';
import { query } from '@/lib/db';
import { recordLlmUsage } from '@/lib/llm-usage';

/**
 * firm-detector — identify the consulting engineer AND builder that are
 * associated with a drawing, based on title block text + CAD naming
 * conventions.
 *
 * Design notes:
 *   - NO candidate list. The model extracts firm names as free-form text
 *     (as written in the title block). The caller then upserts into the
 *     DB by slug, so names growing organically across tenants.
 *   - Both firms detected in one Claude call to save API $.
 *   - Confidence is per-field — you can have high-confidence CE and
 *     no-confidence builder from the same drawing.
 */

export interface DetectionInput {
  annotations: Array<{ text: string; position?: unknown; layer?: string }>;
  blockNames: string[];
  layerNames: string[];
}

export interface DetectionResult {
  consulting_engineer: FirmDetection;
  builder: FirmDetection;
}

export interface FirmDetection {
  name: string | null;
  confidence: 'high' | 'medium' | 'low' | null;
  evidence: string | null;
}

const SYSTEM_PROMPT = `You are analyzing Australian hydraulic/plumbing CAD drawings to identify two firms:
  1. The CONSULTING ENGINEER (drafting firm) that drew the drawings
  2. The BUILDER (construction company) that will construct the project

You will receive:
  - Text annotations extracted from the drawing (typically includes title block text, firm names, drafter initials)
  - CAD block names used in the drawing
  - CAD layer names used in the drawing

Rules:
  1. Extract firm names as they appear in the drawing. Normalise minor formatting (e.g. "JACOBS" → "Jacobs", "LENDLEASE Pty Ltd" → "Lendlease") but DO NOT invent firms.
  2. Primary signal is title block text. A direct firm name = HIGH confidence.
  3. Consulting engineer has hints like: stamp text, "Drawn by", drafter initials (DC, MG, etc.), address with engineering license numbers.
  4. Builder has hints like: "Client:", "For:", "Contractor:", project management company names.
  5. If signals are weak (only drafting conventions suggest a firm, no title block text) → MEDIUM or LOW.
  6. If you can't identify a firm from the drawing, return null — DO NOT guess.
  7. The consulting engineer and builder are DIFFERENT companies. Never return the same name for both.

Return STRICT JSON ONLY (no markdown):
{
  "consulting_engineer": {
    "name": "<firm name>" | null,
    "confidence": "high" | "medium" | "low" | null,
    "evidence": "<one short sentence pointing to the signal used>"
  },
  "builder": {
    "name": "<firm name>" | null,
    "confidence": "high" | "medium" | "low" | null,
    "evidence": "<one short sentence>"
  }
}`;

let _client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  _client = new Anthropic({ apiKey });
  return _client;
}

export async function detectFirms(
  tenantId: number,
  input: DetectionInput
): Promise<DetectionResult> {
  const empty: FirmDetection = { name: null, confidence: null, evidence: null };

  const client = getClient();
  if (!client) {
    return {
      consulting_engineer: { ...empty, evidence: 'ANTHROPIC_API_KEY not set' },
      builder: { ...empty, evidence: 'ANTHROPIC_API_KEY not set' },
    };
  }

  // Early exit when there's nothing worth sending. A real title block
  // has a firm name + address + project name + drawing number + etc. If
  // we have fewer than ~5 meaningful text annotations, Claude can only
  // reply "I see no title block" — and we'd pay ~$0.20 for that answer.
  // Filter out pure-numeric dimensions ("225", "L/s"), single letters,
  // and whitespace. If what remains is thin, skip the call.
  const meaningfulAnnotations = input.annotations.filter(a => {
    const t = (a.text ?? '').trim();
    if (t.length < 3) return false;                 // "A", "*", ""
    if (/^[\d\s.,\-+=\/x×]+$/.test(t)) return false; // "225", "1:100", "12.5"
    return true;
  });
  const MIN_MEANINGFUL = 5;
  if (meaningfulAnnotations.length < MIN_MEANINGFUL) {
    return {
      consulting_engineer: {
        ...empty,
        evidence: `Skipped (saved API call): only ${meaningfulAnnotations.length} readable annotations on the drawing — title block not in modelspace.`,
      },
      builder: {
        ...empty,
        evidence: `Skipped (saved API call): only ${meaningfulAnnotations.length} readable annotations.`,
      },
    };
  }

  const payload = {
    annotations: meaningfulAnnotations.slice(0, 300),
    block_names: input.blockNames.slice(0, 80),
    layer_names: input.layerNames.slice(0, 80),
  };

  try {
    const model = 'claude-opus-4-7';
    const msg = await client.messages.create({
      model,
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
    });

    await recordLlmUsage(tenantId, {
      purpose: 'firm_detector',
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
    return JSON.parse(text) as DetectionResult;
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return {
      consulting_engineer: { ...empty, evidence: err },
      builder: { ...empty, evidence: err },
    };
  }
}

/**
 * Upsert a detected firm into the given table. Matches existing rows by
 * slug (case-insensitive normalisation) — "Jacobs" and "JACOBS" resolve
 * to the same row. Returns the row id.
 *
 * Scopes to the caller's tenant. Global seed rows (tenant_id NULL) are
 * also matched — we don't create a tenant-specific duplicate if a global
 * row already exists. (Currently no globals after migration 011, but the
 * fallback keeps the function safe if seeds are ever re-added.)
 */
export async function upsertFirm(
  table: 'consulting_engineers' | 'builders',
  tenantId: number,
  name: string
): Promise<number> {
  const trimmed = name.trim();
  const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!slug) throw new Error('Empty slug — cannot upsert firm');

  // Match existing (this tenant OR global).
  const [existing] = await query<{ id: number }>(
    `SELECT id FROM ${table}
     WHERE (tenant_id = $1 OR tenant_id IS NULL)
       AND slug = $2
     ORDER BY tenant_id NULLS LAST LIMIT 1`,
    [tenantId, slug]
  );
  if (existing) return existing.id;

  // Insert as tenant-specific.
  const [created] = await query<{ id: number }>(
    `INSERT INTO ${table} (tenant_id, name, slug, is_seed)
     VALUES ($1, $2, $3, FALSE)
     RETURNING id`,
    [tenantId, trimmed, slug]
  );
  return created.id;
}

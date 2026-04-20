-- 008_multi_tenant_and_suggestions.sql
-- Phase 1 foundation: multi-tenant schema + AI mapping-suggestion cache.
--
-- Additive and backward compatible. All existing data is assigned to
-- tenant_id = 1 (PPG). Single-tenant deployments continue to work
-- unchanged; multi-tenant is enabled by the app layer on top of these
-- columns.

-- ---------------------------------------------------------------------------
-- Tenants
-- ---------------------------------------------------------------------------
CREATE TABLE tenants (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,          -- URL-safe identifier (e.g. 'ppg')
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER tenants_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed the only tenant we have today. Hard-coded id = 1 so backfills below
-- can reference it unambiguously.
INSERT INTO tenants (id, name, slug) VALUES (1, 'Prime Plumbing Group', 'ppg');
SELECT setval(pg_get_serial_sequence('tenants', 'id'), 1);

-- ---------------------------------------------------------------------------
-- Tenant FKs on existing tables
-- ---------------------------------------------------------------------------
-- Pattern for each: add nullable column, backfill to 1, then enforce NOT NULL
-- and add an index for the tenant_id filter.

ALTER TABLE users ADD COLUMN tenant_id INTEGER REFERENCES tenants(id);
UPDATE users SET tenant_id = 1 WHERE tenant_id IS NULL;
ALTER TABLE users ALTER COLUMN tenant_id SET NOT NULL;
CREATE INDEX idx_users_tenant ON users(tenant_id);

ALTER TABLE projects ADD COLUMN tenant_id INTEGER REFERENCES tenants(id);
UPDATE projects SET tenant_id = 1 WHERE tenant_id IS NULL;
ALTER TABLE projects ALTER COLUMN tenant_id SET NOT NULL;
CREATE INDEX idx_projects_tenant ON projects(tenant_id);

ALTER TABLE rate_card_versions ADD COLUMN tenant_id INTEGER REFERENCES tenants(id);
UPDATE rate_card_versions SET tenant_id = 1 WHERE tenant_id IS NULL;
ALTER TABLE rate_card_versions ALTER COLUMN tenant_id SET NOT NULL;
CREATE INDEX idx_rate_versions_tenant ON rate_card_versions(tenant_id);

-- symbol_mappings: tenant-scoped because each plumbing business has its own
-- institutional knowledge of how its architects name blocks.
ALTER TABLE symbol_mappings ADD COLUMN tenant_id INTEGER REFERENCES tenants(id);
UPDATE symbol_mappings SET tenant_id = 1 WHERE tenant_id IS NULL;
ALTER TABLE symbol_mappings ALTER COLUMN tenant_id SET NOT NULL;
CREATE INDEX idx_symbol_mappings_tenant ON symbol_mappings(tenant_id);

-- The pre-existing UNIQUE(cad_block_name, architect_name) is no longer
-- correct once mappings are tenant-scoped — two tenants can legitimately
-- both have their own mapping for the same block name. Replace it with a
-- tenant-scoped uniqueness constraint.
ALTER TABLE symbol_mappings DROP CONSTRAINT IF EXISTS symbol_mappings_cad_block_name_architect_name_key;
ALTER TABLE symbol_mappings
  ADD CONSTRAINT symbol_mappings_tenant_block_architect_unique
  UNIQUE (tenant_id, cad_block_name, architect_name);

-- ---------------------------------------------------------------------------
-- Prompts (DB-stored, versionable per tenant)
-- ---------------------------------------------------------------------------
-- Stored in DB so non-engineers can iterate on prompt wording without a
-- redeploy. Keyed by `name` (e.g. 'mapping_suggester') + tenant + version.
-- tenant_id NULL => global default prompt; tenant-specific rows override.
CREATE TABLE prompts (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER REFERENCES tenants(id),       -- NULL = global default
  name TEXT NOT NULL,                              -- e.g. 'mapping_suggester'
  version INTEGER NOT NULL DEFAULT 1,
  system_prompt TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,                                      -- free-form changelog
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER prompts_updated_at BEFORE UPDATE ON prompts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE UNIQUE INDEX idx_prompts_active_per_tenant
  ON prompts(COALESCE(tenant_id, 0), name) WHERE is_active = TRUE;

-- Seed the initial mapping_suggester prompt. Editable via the prompts table
-- later; service code reads the active row by name.
INSERT INTO prompts (tenant_id, name, version, system_prompt, notes) VALUES (
  NULL, 'mapping_suggester', 1,
  'You are an expert plumbing estimator for the Australian construction market.

You will be given:
  - A CAD block name (or pipe layer name) extracted from a plumbing drawing
  - The CAD layer it sits on
  - Optional legend/schedule data from the same drawing
  - Optional examples of mappings the estimator has previously REJECTED for this block

Your job: suggest the single best match from a rate card, or return null if
nothing is a reasonable match. Also return a confidence level:
  - "high" if the block name or legend directly names the rate-card item
           (e.g. "WATR Tap" → "Water Tap 15mm")
  - "medium" if the match is inferred from category + layer (e.g. drainage
           fittings → "Drainage Cleanout") but the specific size/material
           is uncertain
  - "low" if the only signal is a weak category hint

Return STRICT JSON ONLY (no markdown, no prose):
{
  "rate_card_item_id": 1234,    // or null if no reasonable match
  "confidence": "high",         // "high" | "medium" | "low"
  "reasoning": "Brief one-sentence explanation of why this is the match."
}

Hard rules:
  - Never pick a rate-card item that was in the "rejected examples" list
  - If confidence would be below "low", return rate_card_item_id: null
  - AS/NZS 3500 terminology applies — prefer AU fixture names over US equivalents',
  'Initial prompt for Phase 1 mapping_suggester.'
);

-- ---------------------------------------------------------------------------
-- mapping_suggestions (Claude-generated cache)
-- ---------------------------------------------------------------------------
-- Keyed by (tenant_id, cad_block_name, rate_card_version_id) so:
--   1. Tenants don't share suggestions (they may have different rate cards)
--   2. Suggestions auto-invalidate when the rate card version changes
--   3. Same block seen in 100 drawings = 1 LLM call, ever
CREATE TABLE mapping_suggestions (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  cad_block_name TEXT NOT NULL,
  rate_card_version_id INTEGER NOT NULL REFERENCES rate_card_versions(id) ON DELETE CASCADE,
  suggested_rate_card_item_id INTEGER REFERENCES rate_card_items(id) ON DELETE SET NULL,
  confidence confidence_level,                     -- reuse existing enum
  reasoning TEXT,
  prompt_version INTEGER,                          -- which prompt row produced this
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, cad_block_name, rate_card_version_id)
);
CREATE INDEX idx_mapping_suggestions_lookup
  ON mapping_suggestions(tenant_id, rate_card_version_id, cad_block_name);

-- ---------------------------------------------------------------------------
-- mapping_suggestion_feedback (rejected suggestions = few-shot training data)
-- ---------------------------------------------------------------------------
-- When an estimator rejects a suggestion and picks a different rate-card
-- item, we store BOTH the rejected item and the chosen correction. Future
-- LLM calls for the same block name see these as examples of what NOT to
-- pick — a cheap per-tenant learning loop without model fine-tuning.
CREATE TABLE mapping_suggestion_feedback (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  cad_block_name TEXT NOT NULL,
  rejected_rate_card_item_id INTEGER REFERENCES rate_card_items(id) ON DELETE SET NULL,
  chosen_rate_card_item_id INTEGER REFERENCES rate_card_items(id) ON DELETE SET NULL,
  rejected_reasoning TEXT,                         -- what the LLM said
  user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_mapping_feedback_lookup
  ON mapping_suggestion_feedback(tenant_id, cad_block_name);

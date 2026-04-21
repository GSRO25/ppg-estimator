-- 010_consulting_engineers_and_builders.sql
--
-- Two tables that serve different jobs:
--
--   consulting_engineers: the firm that DREW the drawings. Drives the
--     drafting conventions (block names, layer names), so this is what
--     scopes symbol_mappings + mapping_suggestions. A project's
--     consulting_engineer drives which prior mappings apply.
--
--   builders: the construction company PPG is paid by. Tracked on the
--     project for business reporting but has no bearing on drafting.
--
-- Both tables support a global seed list (tenant_id NULL = available to
-- every tenant as a starter option). Custom tenant-specific entries have
-- tenant_id set. Queries combine both with
--   WHERE tenant_id = $1 OR tenant_id IS NULL.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
CREATE TABLE consulting_engineers (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER REFERENCES tenants(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  notes TEXT,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,  -- TRUE for pre-populated global rows
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER consulting_engineers_updated_at BEFORE UPDATE ON consulting_engineers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE INDEX idx_ce_tenant_or_global ON consulting_engineers(tenant_id);
-- Expression unique constraint via index: global rows (tenant_id NULL) and
-- tenant-specific rows co-exist, but each (tenant, slug) pair is unique.
CREATE UNIQUE INDEX consulting_engineers_tenant_slug_unique
  ON consulting_engineers (COALESCE(tenant_id, 0), slug);

CREATE TABLE builders (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER REFERENCES tenants(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  notes TEXT,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER builders_updated_at BEFORE UPDATE ON builders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE INDEX idx_builders_tenant_or_global ON builders(tenant_id);
CREATE UNIQUE INDEX builders_tenant_slug_unique
  ON builders (COALESCE(tenant_id, 0), slug);

-- ---------------------------------------------------------------------------
-- FK columns on existing tables
-- ---------------------------------------------------------------------------

-- Projects get both — consulting_engineer drives mappings; builder is
-- business context.
ALTER TABLE projects ADD COLUMN consulting_engineer_id INTEGER REFERENCES consulting_engineers(id);
ALTER TABLE projects ADD COLUMN builder_id INTEGER REFERENCES builders(id);
CREATE INDEX idx_projects_consulting_engineer ON projects(consulting_engineer_id);
CREATE INDEX idx_projects_builder ON projects(builder_id);

-- symbol_mappings: scope by consulting engineer. NULL = applies to all
-- drafting conventions this tenant has seen. The resolution ladder in the
-- app prefers the most specific match (CE-specific > tenant-wide).
ALTER TABLE symbol_mappings ADD COLUMN consulting_engineer_id INTEGER REFERENCES consulting_engineers(id);
CREATE INDEX idx_symbol_mappings_ce ON symbol_mappings(tenant_id, consulting_engineer_id, cad_block_name);

-- Replace the tenant-scoped uniqueness constraint with one that also
-- includes the consulting_engineer_id so two different CEs can
-- legitimately map the same block name to different rate-card items.
ALTER TABLE symbol_mappings DROP CONSTRAINT IF EXISTS symbol_mappings_tenant_block_architect_unique;
CREATE UNIQUE INDEX symbol_mappings_tenant_ce_block_unique
  ON symbol_mappings (tenant_id, COALESCE(consulting_engineer_id, 0), cad_block_name, COALESCE(architect_name, ''));

-- mapping_suggestions: also scope by consulting engineer so the AI cache
-- differentiates "Jacobs H_CO" from "Beca H_CO" even if they happen to
-- share a block name coincidentally.
ALTER TABLE mapping_suggestions ADD COLUMN consulting_engineer_id INTEGER REFERENCES consulting_engineers(id);
ALTER TABLE mapping_suggestions DROP CONSTRAINT IF EXISTS mapping_suggestions_tenant_id_cad_block_name_rate_card_versio_key;
CREATE UNIQUE INDEX mapping_suggestions_unique
  ON mapping_suggestions (tenant_id, COALESCE(consulting_engineer_id, 0), cad_block_name, rate_card_version_id);

-- mapping_suggestion_feedback also benefits from CE context so "don't pick
-- X" examples are scoped to the same drafting dialect that produced them.
ALTER TABLE mapping_suggestion_feedback ADD COLUMN consulting_engineer_id INTEGER REFERENCES consulting_engineers(id);
CREATE INDEX idx_mapping_feedback_ce
  ON mapping_suggestion_feedback(tenant_id, consulting_engineer_id, cad_block_name);

-- Drawings get auto-detection output so the UI can show "We think Jacobs
-- drew this — confirm?" prompts on first upload.
ALTER TABLE drawings ADD COLUMN detected_consulting_engineer_id INTEGER REFERENCES consulting_engineers(id);
ALTER TABLE drawings ADD COLUMN detected_ce_confidence confidence_level;
ALTER TABLE drawings ADD COLUMN detected_ce_evidence TEXT;

-- ---------------------------------------------------------------------------
-- Seed list — Australian hydraulic consulting engineers
-- ---------------------------------------------------------------------------
-- tenant_id NULL so it's globally visible as a starter list. Tenants can
-- add their own rows on top.

INSERT INTO consulting_engineers (tenant_id, name, slug, is_seed, notes) VALUES
  (NULL, 'Jacobs', 'jacobs', TRUE, 'Global engineering firm, active AU hydraulic practice'),
  (NULL, 'Aurecon', 'aurecon', TRUE, 'AU-headquartered engineering consultancy'),
  (NULL, 'GHD', 'ghd', TRUE, 'AU multi-disciplinary engineering'),
  (NULL, 'Beca', 'beca', TRUE, 'Trans-Tasman consulting engineers'),
  (NULL, 'SMEC', 'smec', TRUE, 'Infrastructure engineering (Surbana Jurong)'),
  (NULL, 'WSP', 'wsp', TRUE, 'Global engineering and professional services'),
  (NULL, 'Stantec', 'stantec', TRUE, 'Global design and consulting'),
  (NULL, 'Arcadis', 'arcadis', TRUE, 'Global design and consultancy'),
  (NULL, 'Arup', 'arup', TRUE, 'Global engineering, AU hydraulic teams'),
  (NULL, 'Mott MacDonald', 'mott-macdonald', TRUE, 'Global engineering consultancy'),
  (NULL, 'TTW', 'ttw', TRUE, 'Taylor Thomson Whitting — NSW engineering'),
  (NULL, 'Warren Smith Hydraulics', 'warren-smith', TRUE, 'AU hydraulic specialists'),
  (NULL, 'Steensen Varming', 'steensen-varming', TRUE, 'Building services / hydraulic engineers'),
  (NULL, 'Lucid Consulting', 'lucid-consulting', TRUE, 'AU hydraulic consulting'),
  (NULL, 'JHA Engineers', 'jha-engineers', TRUE, 'AU hydraulic specialists'),
  (NULL, 'Norman Disney & Young (NDY)', 'ndy', TRUE, 'Now Tetra Tech — AU building services'),
  (NULL, 'Umow Lai', 'umow-lai', TRUE, 'AU building services engineers'),
  (NULL, 'Hardinger Hydraulics', 'hardinger', TRUE, 'AU hydraulic consulting'),
  (NULL, 'DHA Hydraulic Design', 'dha', TRUE, 'AU hydraulic design specialists'),
  (NULL, 'ADP Consulting', 'adp-consulting', TRUE, 'AU mechanical/hydraulic consulting');

-- Australian builders (construction companies) — seeded for project tagging
INSERT INTO builders (tenant_id, name, slug, is_seed, notes) VALUES
  (NULL, 'Lendlease', 'lendlease', TRUE, 'AU tier-1 builder'),
  (NULL, 'Multiplex', 'multiplex', TRUE, 'AU tier-1 builder (Brookfield)'),
  (NULL, 'John Holland', 'john-holland', TRUE, 'AU tier-1 builder'),
  (NULL, 'CPB Contractors', 'cpb', TRUE, 'CIMIC group builder'),
  (NULL, 'Built', 'built', TRUE, 'AU tier-1 builder'),
  (NULL, 'Probuild', 'probuild', TRUE, 'AU tier-1 builder'),
  (NULL, 'Richard Crookes', 'richard-crookes', TRUE, 'NSW tier-2 builder'),
  (NULL, 'ADCO Constructions', 'adco', TRUE, 'AU national builder'),
  (NULL, 'Hutchinson Builders', 'hutchinson', TRUE, 'AU national builder'),
  (NULL, 'Kane Constructions', 'kane', TRUE, 'AU VIC/NSW/QLD builder'),
  (NULL, 'FDC Construction', 'fdc', TRUE, 'NSW tier-2 builder'),
  (NULL, 'Growthbuilt', 'growthbuilt', TRUE, 'NSW residential builder'),
  (NULL, 'Taylor Construction', 'taylor', TRUE, 'NSW tier-2 builder'),
  (NULL, 'Roberts Co', 'roberts-co', TRUE, 'AU tier-2 builder');

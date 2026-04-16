CREATE TABLE rate_card_versions (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  source_filename TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  imported_by INTEGER REFERENCES users(id)
);

CREATE TABLE rate_card_items (
  id SERIAL PRIMARY KEY,
  rate_card_version_id INTEGER NOT NULL REFERENCES rate_card_versions(id) ON DELETE CASCADE,
  section_number INTEGER NOT NULL,
  section_name TEXT NOT NULL,
  description TEXT NOT NULL,
  production_rate NUMERIC(10,2),
  uom TEXT,
  labour_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
  material_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
  plant_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_subtotal BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX idx_rate_items_version ON rate_card_items(rate_card_version_id);
CREATE INDEX idx_rate_items_section ON rate_card_items(rate_card_version_id, section_number);

CREATE TABLE symbol_mappings (
  id SERIAL PRIMARY KEY,
  cad_block_name TEXT NOT NULL,
  architect_name TEXT,
  rate_card_item_id INTEGER NOT NULL REFERENCES rate_card_items(id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(cad_block_name, architect_name)
);

ALTER TABLE projects
  ADD CONSTRAINT fk_projects_rate_card
  FOREIGN KEY (rate_card_version_id) REFERENCES rate_card_versions(id);

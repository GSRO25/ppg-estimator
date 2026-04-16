CREATE TABLE takeoff_items (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  drawing_id INTEGER REFERENCES drawings(id) ON DELETE SET NULL,
  rate_card_item_id INTEGER REFERENCES rate_card_items(id),
  section_number INTEGER NOT NULL,
  section_name TEXT NOT NULL,
  description TEXT NOT NULL,
  uom TEXT NOT NULL DEFAULT '',
  extracted_qty NUMERIC(12,3) NOT NULL DEFAULT 0,
  final_qty NUMERIC(12,3) NOT NULL DEFAULT 0,
  confidence confidence_level NOT NULL DEFAULT 'high',
  source takeoff_source NOT NULL DEFAULT 'manual',
  drawing_region JSONB,
  reviewed BOOLEAN NOT NULL DEFAULT FALSE,
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TIMESTAMPTZ
);
CREATE INDEX idx_takeoff_project ON takeoff_items(project_id);
CREATE INDEX idx_takeoff_section ON takeoff_items(project_id, section_number);

CREATE TABLE corrections (
  id SERIAL PRIMARY KEY,
  takeoff_item_id INTEGER NOT NULL REFERENCES takeoff_items(id) ON DELETE CASCADE,
  original_qty NUMERIC(12,3) NOT NULL,
  corrected_qty NUMERIC(12,3) NOT NULL,
  correction_type TEXT NOT NULL DEFAULT 'quantity',
  corrected_by INTEGER REFERENCES users(id),
  corrected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT
);

CREATE TABLE estimates (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  file_path TEXT,
  exported_by INTEGER REFERENCES users(id),
  exported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

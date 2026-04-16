-- Enums
CREATE TYPE project_status AS ENUM ('draft','extracting','review','estimated','exported','archived');
CREATE TYPE drawing_format AS ENUM ('dwg','dxf','pdf');
CREATE TYPE drawing_category AS ENUM (
  'cover','notes','site_drainage','site_pressure','site_fire',
  'drainage','pressure','fire','details','amenities','stormwater','other'
);
CREATE TYPE extraction_status AS ENUM ('pending','processing','complete','failed');
CREATE TYPE confidence_level AS ENUM ('high','medium','low');
CREATE TYPE takeoff_source AS ENUM ('dwg_parser','pdf_vision','manual');
CREATE TYPE user_role AS ENUM ('admin','estimator');

-- Timestamps trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- Users
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'estimator',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Projects
CREATE TABLE projects (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  client TEXT,
  address TEXT,
  start_date DATE,
  end_date DATE,
  rate_card_version_id INTEGER,
  margin_percent NUMERIC(5,2) NOT NULL DEFAULT 10.00,
  status project_status NOT NULL DEFAULT 'draft',
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER projects_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Drawings
CREATE TABLE drawings (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  format drawing_format NOT NULL,
  category drawing_category NOT NULL DEFAULT 'other',
  extraction_status extraction_status NOT NULL DEFAULT 'pending',
  extraction_result JSONB,
  tile_path TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_drawings_project ON drawings(project_id);
CREATE INDEX idx_drawings_status ON drawings(extraction_status);

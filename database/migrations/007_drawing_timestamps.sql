ALTER TABLE drawings
  ADD COLUMN IF NOT EXISTS extraction_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS extraction_completed_at TIMESTAMPTZ;

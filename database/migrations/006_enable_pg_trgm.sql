CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_rate_card_items_description_trgm
  ON rate_card_items USING gin (LOWER(description) gin_trgm_ops);

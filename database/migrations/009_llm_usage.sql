-- 009_llm_usage.sql
-- Per-call LLM usage log so we can show cost-to-date and break it down by
-- purpose (mapping_suggester, legend_parser, etc.) in the admin UI.
--
-- Pricing (input_price_per_million, output_price_per_million) is stored on
-- EACH row rather than looked up later so that future Anthropic price
-- changes don't retroactively inflate historical totals. The cost column
-- is the authoritative dollar figure at the moment of the call.

CREATE TABLE llm_usage (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  purpose TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_input_tokens INTEGER NOT NULL DEFAULT 0,
  input_price_per_million NUMERIC(10,4) NOT NULL,
  output_price_per_million NUMERIC(10,4) NOT NULL,
  cost_usd NUMERIC(10,6) NOT NULL,
  request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_llm_usage_tenant_date ON llm_usage(tenant_id, created_at DESC);
CREATE INDEX idx_llm_usage_purpose ON llm_usage(tenant_id, purpose, created_at DESC);

-- ============================================================================
-- 010: search_intent_cache
-- ============================================================================
-- Persistent cache of natural-language query → ClassifiedIntent results
-- produced by the LLM classifier (lib/search-intent/classify-llm.ts).
--
-- Purpose
--   Every search-bar question normally costs ~$0.001 + ~300ms of latency on
--   Claude Haiku. The cache lets us serve identical or near-identical queries
--   for free after the first hit.
--
-- Cache key
--   (query_hash, model_version) — two distinct fields, not a composite of the
--   normalized query, so a model upgrade leaves the old rows in place rather
--   than serving stale classifications. We can prune old model rows later.
--
-- Access
--   Read/write only via SUPABASE_SERVICE_ROLE_KEY (server side). RLS is
--   enabled with no policies, so anon users cannot read or write.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.
-- Safe to re-run.
--
-- Execution path
--   Supabase Dashboard SQL Editor, or scripts/lib/run-migration.ts.
-- ============================================================================

CREATE TABLE IF NOT EXISTS search_intent_cache (
  -- SHA-256 hex of normalized query (lowercased, whitespace-collapsed).
  query_hash       TEXT NOT NULL,
  -- Model identifier, e.g. "claude-haiku-4-5". Lets us version cache entries.
  model_version    TEXT NOT NULL,
  -- The normalized query, kept for debugging / human inspection.
  query            TEXT NOT NULL,
  -- Full ClassifiedIntent payload (intent + confidence + optional reasoning).
  classification   JSONB NOT NULL,
  -- Mirror of classification.confidence for index/filter use.
  confidence       NUMERIC(4, 3) NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Touched on every cache hit so we can drive LRU eviction later.
  accessed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (query_hash, model_version)
);

-- LRU eviction will scan by accessed_at; index supports that.
CREATE INDEX IF NOT EXISTS search_intent_cache_accessed_at_idx
  ON search_intent_cache (accessed_at);

-- Optional analytics: confidence histogram.
CREATE INDEX IF NOT EXISTS search_intent_cache_confidence_idx
  ON search_intent_cache (confidence);

-- Lock down: server-side service role only.
ALTER TABLE search_intent_cache ENABLE ROW LEVEL SECURITY;

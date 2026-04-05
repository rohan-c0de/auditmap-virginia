-- Track scraper executions for monitoring and debugging.
-- Each row represents one scraper invocation (manual or automated).

CREATE TABLE IF NOT EXISTS scraper_runs (
  id BIGSERIAL PRIMARY KEY,
  scraper_name TEXT NOT NULL,                          -- e.g. "ga/scrape-banner-ssb"
  state TEXT NOT NULL,                                 -- e.g. "ga"
  college_code TEXT,                                   -- e.g. "atlanta-tech" (null for multi-college scrapers)
  term TEXT,                                           -- e.g. "2026SP" (null for multi-term scrapers)
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',              -- running | success | failure | partial
  sections_imported INT DEFAULT 0,
  error_message TEXT,
  workflow_run_id TEXT,                                -- GitHub Actions run ID for linking
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup: recent runs per state
CREATE INDEX idx_scraper_runs_state ON scraper_runs(state, started_at DESC);

-- Fast lookup: find failures
CREATE INDEX idx_scraper_runs_status ON scraper_runs(status) WHERE status != 'success';

-- Staleness detection view: flag scrapers that haven't succeeded in 48+ hours
CREATE OR REPLACE VIEW stale_scrapers AS
SELECT
  state,
  scraper_name,
  MAX(finished_at) AS last_success,
  NOW() - MAX(finished_at) AS staleness
FROM scraper_runs
WHERE status = 'success'
GROUP BY state, scraper_name
HAVING NOW() - MAX(finished_at) > INTERVAL '48 hours';

-- Allow service role full access (scrapers use service role key)
ALTER TABLE scraper_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can do everything on scraper_runs"
  ON scraper_runs
  FOR ALL
  USING (true)
  WITH CHECK (true);

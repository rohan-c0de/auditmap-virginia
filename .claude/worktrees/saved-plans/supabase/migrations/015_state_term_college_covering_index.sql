-- ---------------------------------------------------------------------------
-- 015_state_term_college_covering_index.sql
--
-- Fixes a production build failure where `npm run build` on Vercel was timing
-- out generating `/[state]/page` for any state with ≥25k course rows (CA, NC,
-- GA, VA, TX, MD, etc.). The failing query is `get_term_college_counts(p_state)`
-- from migration 009:
--
--   SELECT term, COUNT(DISTINCT college_code) FROM courses
--   WHERE state = p_state GROUP BY term ORDER BY term;
--
-- With only `idx_courses_state_term (state, term)`, Postgres did an Index Scan
-- plus a heap fetch per row to read college_code. For CA's 93k rows that's
-- ~800ms single-shot; under the 2000-page Vercel build's concurrent worker
-- pressure each query stretched past the 60s statement_timeout, aborting the
-- whole export.
--
-- This index adds college_code to the trailing position so the same query
-- resolves as an Index Only Scan with zero heap fetches:
--
--   GroupAggregate (actual time=12.7..27.0 rows=7 loops=1)
--     Index Only Scan using idx_courses_state_term_college (Heap Fetches: 0)
--
--   793 ms → 27 ms (29× speed-up on CA).
--
-- We keep idx_courses_state_term in place — narrower index still wins for
-- queries that only filter on state+term without reading college_code, and the
-- overhead of two indexes on the same leading column pair is trivial relative
-- to the time we just won back.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_courses_state_term_college
  ON courses(state, term, college_code);

-- Heap-fetch counts in the EXPLAIN above were initially high (35k) because
-- recent imports had not yet been marked all-visible. Production was VACUUM
-- ANALYZE'd as part of the rollout; subsequent fresh imports will lag the
-- visibility map briefly until autovacuum catches up, which is fine — the
-- query still uses the new index and degrades gracefully.

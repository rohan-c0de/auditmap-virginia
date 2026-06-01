-- ---------------------------------------------------------------------------
-- 020_batch_term_college_counts.sql
--
-- Adds get_all_term_college_counts() — a batch version of
-- get_term_college_counts(p_state) that returns (state, term, college_count)
-- for ALL states in one call.
--
-- During Next.js static generation, dozens of pages call getCurrentTerm() for
-- different states concurrently. With the courses table at 1M+ rows, N
-- per-state RPCs accumulated enough Supabase connection-pool pressure to
-- exceed the 2-minute statement_timeout, failing the Vercel production build.
--
-- This function replaces those N calls with a single Index Only Scan on
-- idx_courses_state_term_college (~400ms total). The app-side cache in
-- lib/terms.ts fetches this once and serves all states from the result map.
--
-- Idempotent (CREATE OR REPLACE). Safe to run in the SQL Editor or via
-- scripts/lib/run-migration.ts.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_all_term_college_counts()
RETURNS TABLE(state text, term text, college_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT c.state, c.term, COUNT(DISTINCT c.college_code) AS college_count
  FROM courses c
  GROUP BY c.state, c.term
  ORDER BY c.state, c.term;
$$;

GRANT EXECUTE ON FUNCTION get_all_term_college_counts() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

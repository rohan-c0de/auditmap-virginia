-- ============================================================================
-- 009: RPC functions for build-time performance
-- ============================================================================
-- Creates three RPC functions that replace slow fallback query paths used
-- during Next.js static generation:
--
--   get_distinct_terms(p_state)
--     Called by getAvailableTerms(). Without this, the fallback downloads up
--     to 50k rows just to extract distinct term codes.
--
--   get_term_college_counts(p_state)
--     Called by getCurrentTerm(). Without this, the fallback runs one COUNT
--     query per term per state — N+1 queries at build time.
--
--   get_terms_for_college_subject(p_college_code, p_prefix, p_state)
--     Called by getTermsWithDataForCollegeSubject(). Without this, the
--     fallback paginates through all matching rows; the query was hitting
--     Supabase statement_timeout during parallel static generation.
--
-- Also adds a supporting index for the college+subject term lookup.
--
-- All statements are idempotent (CREATE OR REPLACE / IF NOT EXISTS).
-- Safe to run in the Supabase Dashboard SQL Editor or via
-- scripts/lib/run-migration.ts.
--
-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction — run
-- that statement separately if using a transaction-wrapped executor.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- get_distinct_terms
-- Returns all distinct term codes that have at least one course for a state.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_distinct_terms(p_state text)
RETURNS TABLE(term text)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT DISTINCT c.term
  FROM courses c
  WHERE c.state = p_state
  ORDER BY c.term;
$$;

-- ---------------------------------------------------------------------------
-- get_term_college_counts
-- Returns each term with the count of distinct colleges that have courses,
-- used to determine the "current" term (most colleges = most active).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_term_college_counts(p_state text)
RETURNS TABLE(term text, college_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT c.term, COUNT(DISTINCT c.college_code) AS college_count
  FROM courses c
  WHERE c.state = p_state
  GROUP BY c.term
  ORDER BY c.term;
$$;

-- ---------------------------------------------------------------------------
-- get_terms_for_college_subject
-- Returns distinct terms that have at least one section of a given subject
-- prefix at a specific college. Replaces the paginated scan in
-- getTermsWithDataForCollegeSubject() which was hitting statement_timeout.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_terms_for_college_subject(
  p_college_code text,
  p_prefix text,
  p_state text
)
RETURNS TABLE(term text)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT DISTINCT c.term
  FROM courses c
  WHERE c.college_code = p_college_code
    AND c.course_prefix = p_prefix
    AND c.state = p_state
  ORDER BY c.term;
$$;

-- ---------------------------------------------------------------------------
-- Supporting index for get_terms_for_college_subject
-- The existing idx_courses_state_term_prefix_number index leads with state+term
-- and can't efficiently serve WHERE college_code=? AND course_prefix=? AND state=?.
-- This index lets Postgres resolve that query with a single index scan.
-- ---------------------------------------------------------------------------
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_courses_college_prefix_state
  ON courses(college_code, course_prefix, state);

-- ---------------------------------------------------------------------------
-- Grant execute permissions to PostgREST roles
-- Without these grants the anon/authenticated roles can't call the RPCs
-- via the Supabase JS client, causing silent fallback to slow query paths.
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION get_distinct_terms(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_term_college_counts(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_terms_for_college_subject(text, text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

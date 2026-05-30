-- ============================================================
-- RPC functions for efficient queries (avoids downloading all rows)
-- Run via Supabase Dashboard → SQL Editor
-- ============================================================

-- Get distinct term codes for a state (replaces downloading all rows)
CREATE OR REPLACE FUNCTION get_distinct_terms(p_state text)
RETURNS TABLE(term text) AS $$
  SELECT DISTINCT c.term FROM courses c WHERE c.state = p_state ORDER BY c.term;
$$ LANGUAGE sql STABLE;

-- Get term → distinct college count for a state (replaces N full-table scans)
CREATE OR REPLACE FUNCTION get_term_college_counts(p_state text)
RETURNS TABLE(term text, college_count bigint) AS $$
  SELECT c.term, COUNT(DISTINCT c.college_code) as college_count
  FROM courses c WHERE c.state = p_state GROUP BY c.term;
$$ LANGUAGE sql STABLE;

-- ============================================================================
-- 031_subject_course_list_rpc.sql
--
-- Adds get_subject_course_list — a tiny DISTINCT-ON RPC backing the "Related
-- courses" sidebar on the course-detail page (app/[state]/course/[code]).
--
-- Problem (the /ca/course/* 504s, 2026-06): the course page called
-- loadCoursesBySubject() to get the whole subject's sections, then used them
-- for only two things — the target course's own sections (already served fast
-- by loadCourseByCode via the (state,term,course_prefix,course_number) index)
-- and a list of OTHER course numbers in the same subject for a 12-link sidebar.
-- For a big subject in a big state (CA Fall ENGL = 9,120 rows of 134,378 in the
-- state×term partition) that pulled ~9k full-width rows across ~9 paginated
-- round trips on every cold Vercel lambda — 15s+, tripping FUNCTION_INVOCATION
-- _TIMEOUT. Same shape as the transfer-destinations fix in migration 016.
--
-- Fix: the sidebar only needs distinct (course_number, course_title). This RPC
-- returns them in one round trip (~600 small rows, ~30ms) using DISTINCT ON,
-- which the existing idx_courses_state_term_prefix_number index serves without
-- a sort (it is already ordered by course_number within the prefix).
--
-- Execution: safe to run in a single transaction.
-- Run via: Supabase Dashboard SQL Editor, or scripts/lib/run-migration.ts
-- ============================================================================

CREATE OR REPLACE FUNCTION get_subject_course_list(
  p_state text,
  p_term text,
  p_prefix text
)
RETURNS TABLE(course_number text, course_title text)
LANGUAGE sql
STABLE
SECURITY INVOKER
PARALLEL SAFE
AS $$
  SELECT DISTINCT ON (c.course_number)
    c.course_number,
    c.course_title
  FROM courses c
  WHERE c.state = p_state
    AND c.term = p_term
    AND c.course_prefix = p_prefix
  ORDER BY c.course_number, c.course_title
$$;

-- Anon + authenticated read it (same public-read posture as the courses table).
GRANT EXECUTE ON FUNCTION get_subject_course_list(text, text, text) TO anon, authenticated;

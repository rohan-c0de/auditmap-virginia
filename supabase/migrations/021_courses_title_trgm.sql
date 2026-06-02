-- 021_courses_title_trgm.sql
--
-- What: trigram GIN index on courses.course_title to accelerate keyword course
--   search (`course_title ILIKE '%kw%'`), now that search pushes its predicate
--   into Postgres (lib/courses.ts searchSections) instead of loading every
--   section for a (state, term) and filtering in JS.
--
-- Why: the JS load-all path 504'd on large states (CA ~188k sections/term).
--   The SQL pushdown alone fixes the timeout (code queries hit the existing
--   idx_courses_state_term_prefix_number). Keyword queries still scanned the
--   ~30k (state, term) rows for the ILIKE (~1-2s on CA). This trigram index
--   lets the planner satisfy the ILIKE from the index (~100ms).
--
-- Caveats:
--   - courses is large (~1M+ rows). CREATE INDEX CONCURRENTLY does not lock
--     writes but CANNOT run inside a transaction — run this statement-by-
--     statement (Supabase Dashboard SQL Editor, or one execute_sql call each),
--     NOT wrapped in BEGIN/COMMIT.
--   - Idempotent: IF NOT EXISTS on both the extension and the index.
--   - pg_trgm is a standard Postgres extension (available on Supabase).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_courses_title_trgm
  ON courses USING gin (course_title gin_trgm_ops);

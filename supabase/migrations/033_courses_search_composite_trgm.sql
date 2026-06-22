-- 033_courses_search_composite_trgm.sql
--
-- What:
--   1. Add a composite GIN index on courses (state, term, course_title) that
--      combines the scalar equality predicates with the title trigram match in
--      a single index, via the btree_gin extension.
--   2. Drop the dead idx_courses_fts (the GENERATED `fts` tsvector index from
--      001_initial_schema.sql).
--
-- Why:
--   Course keyword search runs `WHERE state = ? AND term = ? AND course_title
--   ILIKE '%kw%'`. With only the single-column trigram index (021) plus the
--   (state, term) btree, the planner had to BitmapAnd two huge bitmaps — the
--   trigram match returns every "%kw%" title NATIONWIDE and (state, term)
--   returns every section in that term — then intersect. On CA Fall that is
--   ~41k ⋂ ~135k rows ≈ 1.4 s per keyword search (and the same shape caused the
--   historical search 504s). A composite (state, term, course_title gin_trgm_ops)
--   index lets a single bitmap index scan satisfy all three predicates at once.
--
--   idx_courses_fts has never been used (Supabase performance advisor: unused
--   index) — title search is served by the trigram index, not the tsvector. The
--   GIN index on `fts` is pure write-amplification on every course import, so we
--   drop it. (The generated `fts` column itself is left in place; removing the
--   column is a separate, more invasive change and is not needed to stop the
--   index maintenance cost.)
--
-- Measured (EXPLAIN ANALYZE, prod, 1.45M-row courses):
--   state=ca term=2026FA title ILIKE '%biology%'  1412 ms → 28 ms   (~50x)
--   state=wa term=2026FA title ILIKE '%cse%'        410 ms →  0.8 ms (~500x)
--   Both now use idx_courses_state_term_title_trgm as a single index scan.
--
-- Caveats / execution path:
--   - Run statement-by-statement (Supabase Dashboard SQL Editor or one
--     execute_sql call each). CREATE/DROP INDEX CONCURRENTLY CANNOT run inside a
--     transaction (do not wrap in BEGIN/COMMIT).
--   - CONCURRENTLY does not lock writes; the GIN build scans the table twice.
--   - Idempotent: IF NOT EXISTS / IF EXISTS throughout.
--   - Already applied to prod (project CC) via MCP on 2026-06-22; this file is
--     the source-of-truth record (migrations here are applied by hand).

CREATE EXTENSION IF NOT EXISTS btree_gin;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_courses_state_term_title_trgm
  ON courses USING gin (state, term, course_title gin_trgm_ops);

DROP INDEX CONCURRENTLY IF EXISTS idx_courses_fts;

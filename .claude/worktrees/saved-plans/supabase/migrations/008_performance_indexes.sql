-- ============================================================================
-- 008: Performance indexes for hot-path queries
-- ============================================================================
-- Adds composite indexes on `courses` and `saved_*` tables that were missing
-- after the audit of all Supabase call sites (27 distinct query signatures
-- across 7 tables).
--
-- Uses `CREATE INDEX CONCURRENTLY` on the large `courses` table (~450k rows)
-- to avoid blocking writes during build. Small tables use plain CREATE INDEX.
-- All statements use `IF NOT EXISTS` — safe to re-run.
--
-- CONCURRENTLY cannot run inside a transaction. Paste the block into Supabase
-- Dashboard → SQL Editor and run each statement individually, OR run via
-- `scripts/lib/run-migration.ts` (which calls psql and auto-commits per stmt).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- courses — subject page + course detail page
-- ---------------------------------------------------------------------------
-- Subject page:  WHERE state=? AND term=? AND course_prefix=?
-- Course detail: WHERE state=? AND term=? AND course_prefix=? AND course_number=?
--
-- Today these queries use idx_courses_state_term (state, term) and filter
-- ~30k rows per state+term in memory for course_prefix. A composite
-- (state, term, course_prefix, course_number) index lets Postgres do a
-- single index scan for both shapes (Postgres uses a leading prefix of the
-- composite for the subject-page query shape).
-- ---------------------------------------------------------------------------

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_courses_state_term_prefix_number
  ON courses(state, term, course_prefix, course_number);

-- ---------------------------------------------------------------------------
-- saved_schedules, saved_courses, saved_transfers — account dashboard
-- ---------------------------------------------------------------------------
-- Account page queries:  WHERE user_id=? ORDER BY created_at DESC
--
-- Current indexes (user_id) and (user_id, state) can't avoid a sort step
-- for `ORDER BY created_at DESC`. Adding created_at DESC to the index tail
-- turns this into a no-sort index scan.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_saved_schedules_user_created
  ON saved_schedules(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_saved_courses_user_created
  ON saved_courses(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_saved_transfers_user_created
  ON saved_transfers(user_id, created_at DESC);

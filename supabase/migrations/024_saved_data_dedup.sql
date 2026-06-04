-- ============================================================================
-- 024: Saved-data dedup prep — idempotency keys for the anonymous→account drain
-- ============================================================================
-- WHAT: Prepares saved_plans + saved_courses so the upcoming anonymous→account
--       "draft hand-off" drain runs idempotently (a retried drain must not
--       duplicate data).
--         * saved_plans gains `kind` ('semester'|'program', so a drain can
--           reconstruct the right plan_data shape) and `client_dedup_key`
--           (a client-generated stable key) + a PARTIAL UNIQUE index so a
--           retried insert is a no-op.
--         * saved_courses: backfill college_code/crn NULL → '' then make them
--           NOT NULL DEFAULT '', so the existing
--           UNIQUE(user_id,state,course_prefix,course_number,college_code,crn)
--           index actually fires (NULLs were distinct → duplicate favorites).
-- WHY:  Plan doc (docs/auth-accounts-plan-v2.md) false-premise #3 — without
--       these, a retrying drain duplicates plans and double-inserts favorites.
-- CAVEATS: Additive + idempotent. On prod both tables are currently empty, so
--       the backfill/dedup affect 0 rows; written generally for any environment.
--       Reversible (DROP INDEX / DROP COLUMN / DROP NOT NULL).
-- EXECUTION: Supabase Dashboard SQL Editor (or scripts/lib/run-migration.ts).
-- ============================================================================

-- ── saved_plans: kind + client_dedup_key + partial unique idempotency index ──
ALTER TABLE saved_plans ADD COLUMN IF NOT EXISTS kind TEXT;
ALTER TABLE saved_plans ADD COLUMN IF NOT EXISTS client_dedup_key TEXT;

-- Backfill kind for any existing rows from the cached plan_data shape.
UPDATE saved_plans
SET kind = CASE WHEN plan_data ? 'groups' THEN 'program' ELSE 'semester' END
WHERE kind IS NULL;

-- A retried drain insert with the same client_dedup_key is a no-op. Partial so
-- legacy rows (NULL key, saved via the normal UI) are exempt.
CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_plans_user_dedup
  ON saved_plans (user_id, client_dedup_key)
  WHERE client_dedup_key IS NOT NULL;

-- ── saved_courses: make the existing UNIQUE index actually dedup ──
-- 1. Backfill NULLs to '' (NULLs are distinct in a unique index → duplicates).
UPDATE saved_courses SET college_code = '' WHERE college_code IS NULL;
UPDATE saved_courses SET crn = '' WHERE crn IS NULL;

-- 2. Remove any rows that would collide after the backfill, keeping the
--    earliest by created_at (tie-break on id). No-op on an empty table.
DELETE FROM saved_courses a
USING saved_courses b
WHERE a.user_id = b.user_id
  AND a.state = b.state
  AND a.course_prefix = b.course_prefix
  AND a.course_number = b.course_number
  AND COALESCE(a.college_code, '') = COALESCE(b.college_code, '')
  AND COALESCE(a.crn, '') = COALESCE(b.crn, '')
  AND (a.created_at > b.created_at
       OR (a.created_at = b.created_at AND a.id > b.id));

-- 3. Constrain so future NULLs can't reintroduce the gap.
ALTER TABLE saved_courses ALTER COLUMN college_code SET DEFAULT '';
ALTER TABLE saved_courses ALTER COLUMN crn SET DEFAULT '';
ALTER TABLE saved_courses ALTER COLUMN college_code SET NOT NULL;
ALTER TABLE saved_courses ALTER COLUMN crn SET NOT NULL;

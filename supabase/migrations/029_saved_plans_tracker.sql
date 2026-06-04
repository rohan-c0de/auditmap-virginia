-- ============================================================================
-- 029: saved_plans transfer-progress tracker fields
-- ============================================================================
-- WHAT: Adds two nullable/defaulted columns to saved_plans:
--       • target_university TEXT — the university slug the user is aiming to
--         transfer to (matches transfers.university / the getUniversities slug).
--       • completed_courses TEXT[] — the course codes the user has marked done.
-- WHY:  Milestone C transfer-progress tracker, PR 1 (capture). PR 2 reads these
--       to compute % complete + how the completed courses transfer to the
--       target university (from the transfer-equiv data).
-- MODEL: A "transfer goal" = a saved plan + target_university + completed_courses.
--        The plan's STRUCTURE (target_courses, plan_data) stays immutable — the
--        Save flow still INSERTs a new row; only these two TRACKER fields are
--        updated in place on the existing plan.
-- RLS:  No policy change. saved_plans "Users manage own plans" is FOR ALL (017),
--       which already permits the owner to UPDATE these columns.
-- CAVEATS: Additive + idempotent (IF NOT EXISTS). No backfill (existing plans
--          get NULL target_university + empty completed_courses).
-- EXECUTION: Supabase Dashboard SQL Editor (or MCP apply_migration).
-- ============================================================================

ALTER TABLE saved_plans
  ADD COLUMN IF NOT EXISTS target_university TEXT;

ALTER TABLE saved_plans
  ADD COLUMN IF NOT EXISTS completed_courses TEXT[] NOT NULL DEFAULT '{}';

-- ============================================================================
-- 027: saved_schedules.client_dedup_key — idempotency for the schedule drain
-- ============================================================================
-- WHAT: Adds a nullable client_dedup_key to saved_schedules + a PARTIAL unique
--       index on (user_id, client_dedup_key) so the 028 drain RPC can insert a
--       logged-out-built schedule exactly once via ON CONFLICT DO NOTHING.
-- WHY:  1b-iii — a schedule built while logged out should survive sign-in. Like
--       024 did for saved_plans, the dedup key lives in its own additive
--       migration so the structural change is separate from the function change.
-- NOTE: The index is PARTIAL (WHERE client_dedup_key IS NOT NULL) so existing
--       rows + any future direct inserts that omit the key stay unconstrained —
--       only drained rows (which always carry a key) are de-duplicated. The key
--       is a TEXT content hash of (state + sorted section college_code:crn),
--       computed client-side in lib/anon-draft.ts (scheduleDedupKey).
-- CAVEATS: Additive + idempotent (IF NOT EXISTS). No backfill of old rows.
-- EXECUTION: Supabase Dashboard SQL Editor (or scripts/lib/run-migration.ts).
-- ============================================================================

ALTER TABLE saved_schedules
  ADD COLUMN IF NOT EXISTS client_dedup_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_schedules_user_dedup
  ON saved_schedules (user_id, client_dedup_key)
  WHERE client_dedup_key IS NOT NULL;

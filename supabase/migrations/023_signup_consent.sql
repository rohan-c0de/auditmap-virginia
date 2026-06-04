-- ============================================================================
-- 023: Signup consent — Terms of Service / Privacy acceptance + 13+ attestation
-- ============================================================================
-- WHAT: Adds two nullable columns to `profiles` recording WHEN a user accepted
--       the Terms of Service + Privacy Policy (and attested to being 13 or
--       older) and WHICH Terms version they accepted.
-- WHY:  COPPA / eligibility gate. Signup now requires a "13+ and agree to Terms
--       & Privacy" checkbox; this is where that acceptance is stored. NULL =
--       not yet accepted (pre-gate accounts) → the app prompts on next load.
-- HOW:  Consent is written client-side post-auth via the existing
--       "Users update own profile" RLS policy (auth.uid() = id) — no trigger
--       change needed (the checkbox state isn't available to handle_new_user).
-- CAVEATS: Purely additive + idempotent. Both columns nullable, no default, no
--       backfill; negligible lock on a small per-user table; runs in a
--       transaction. Reversible via DROP COLUMN.
-- EXECUTION: Supabase Dashboard SQL Editor (or scripts/lib/run-migration.ts).
-- ============================================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS tos_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tos_version TEXT;

COMMENT ON COLUMN profiles.tos_accepted_at IS
  'When the user accepted the Terms of Service + Privacy Policy and attested to being 13+. NULL = not yet accepted; the app prompts on next authenticated load.';
COMMENT ON COLUMN profiles.tos_version IS
  'Version string of the Terms the user accepted (see lib/consent.ts TOS_VERSION).';

-- ===========================================================================
-- 021_harden_security_definer_functions.sql
--
-- WHAT: Re-defines the two SECURITY DEFINER trigger functions from migration
--       006 (handle_new_user, link_subscriber_on_signup) with two hardening
--       changes each:
--         1. SET search_path = public, pg_temp  — pins name resolution.
--         2. handle_new_user: INSERT ... ON CONFLICT (id) DO NOTHING.
--
-- WHY:
--   * SECURITY DEFINER functions run with the *owner's* privileges. Without a
--     pinned search_path, a caller who can influence the session search_path
--     could shadow an unqualified object (e.g. a malicious `subscribers` or
--     `profiles` in another schema earlier on the path) and have the elevated
--     function operate on it. Pinning search_path to `public, pg_temp` is the
--     standard Postgres defense and is flagged by Supabase's own linter
--     (function_search_path_mutable advisory).
--   * The bare INSERT in handle_new_user has no conflict guard. The trigger is
--     AFTER INSERT on auth.users and fires once per user, so a duplicate id is
--     not expected — but if it ever re-fires (e.g. a future identity-linking
--     flow that re-inserts), the unguarded INSERT throws and fails the whole
--     auth transaction, locking the user out. ON CONFLICT (id) DO NOTHING makes
--     it defensively idempotent.
--
-- BEHAVIOR: No functional change to the happy path. Profiles are still created
--   on signup; subscribers are still linked. Only name-resolution safety and
--   re-entrancy safety improve. No data is migrated or backfilled.
--
-- IDEMPOTENT: Uses CREATE OR REPLACE FUNCTION; safe to re-run. The existing
--   triggers (on_auth_user_created, on_profile_created_link_subscriber) stay
--   bound to these functions and are NOT recreated.
--
-- LOCK IMPACT: Trivial — replaces two function definitions; no table rewrite,
--   no index build. Runs in a single transaction.
--
-- EXECUTION PATH: Supabase Dashboard SQL Editor, or scripts/lib/run-migration.ts.
--   Must be applied to the remote project after this PR merges (no automatic
--   migration runner on merge).
-- ===========================================================================

-- 1. handle_new_user — auto-create a profile row on signup.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url, auth_provider)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    ),
    COALESCE(
      NEW.raw_user_meta_data->>'avatar_url',
      NEW.raw_user_meta_data->>'picture'
    ),
    NEW.raw_app_meta_data->>'provider'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- 2. link_subscriber_on_signup — link a verified email subscriber to the new
--    profile when the addresses match. auth.users is schema-qualified; the
--    other references (subscribers, profiles) resolve via the pinned path.
CREATE OR REPLACE FUNCTION link_subscriber_on_signup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  user_email TEXT;
  sub_id BIGINT;
BEGIN
  -- Get the user's email from auth.users
  SELECT email INTO user_email FROM auth.users WHERE id = NEW.id;

  -- Find a matching verified subscriber
  SELECT id INTO sub_id
  FROM subscribers
  WHERE email = user_email AND verified = true
  LIMIT 1;

  IF sub_id IS NOT NULL THEN
    UPDATE profiles SET subscriber_id = sub_id WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

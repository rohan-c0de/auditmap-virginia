-- ============================================================================
-- 026: drain_anonymous_plans — also drain favorited courses
-- ============================================================================
-- WHAT: Extends the 025 drain function (SAME NAME — the live 1b-i client calls
--       drain_anonymous_plans; renaming/dropping would break the live plan
--       drain) to ALSO insert favorited courses from payload->'favorites' into
--       saved_courses, idempotent via the existing saved_courses UNIQUE index
--       (which actually fires after migration 024's college_code/crn NOT NULL
--       backfill). The old plans-only client sends no 'favorites' key →
--       COALESCE to [] → harmless no-op.
-- WHY:  1b-ii — a course favorited while logged out should also survive sign-in.
-- SECURITY: unchanged from 025 — SECURITY DEFINER + pinned search_path, writes
--       only the caller's rows (auth.uid()), EXECUTE for `authenticated` only
--       (anon revoked; also self-guards on auth.uid() IS NULL).
-- CAVEATS: Idempotent (CREATE OR REPLACE). Additive.
-- EXECUTION: Supabase Dashboard SQL Editor (or scripts/lib/run-migration.ts).
-- ============================================================================

CREATE OR REPLACE FUNCTION drain_anonymous_plans(payload jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
  rec jsonb;
  inserted integer := 0;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'drain_anonymous_plans: not authenticated';
  END IF;

  -- Plans (unchanged from 025).
  FOR rec IN
    SELECT value FROM jsonb_array_elements(COALESCE(payload->'plans', '[]'::jsonb))
  LOOP
    CONTINUE WHEN COALESCE(rec->>'dedupKey', '') = '';

    INSERT INTO saved_plans
      (user_id, state, name, target_courses, plan_data, kind, client_dedup_key)
    VALUES (
      uid,
      rec->>'state',
      COALESCE(NULLIF(rec->>'name', ''), 'My Plan'),
      COALESCE(
        (SELECT array_agg(value) FROM jsonb_array_elements_text(rec->'targetCourses')),
        '{}'::text[]
      ),
      CASE WHEN rec->>'kind' = 'program'
           THEN '{"groups": []}'::jsonb
           ELSE '{"semesters": []}'::jsonb END,
      COALESCE(NULLIF(rec->>'kind', ''), 'semester'),
      rec->>'dedupKey'
    )
    ON CONFLICT (user_id, client_dedup_key) WHERE client_dedup_key IS NOT NULL
    DO NOTHING;

    IF FOUND THEN
      inserted := inserted + 1;
    END IF;
  END LOOP;

  -- Favorites (new in 026). Idempotent via the saved_courses unique index
  -- (user_id, state, course_prefix, course_number, college_code, crn);
  -- college_code/crn default '' (NOT NULL after migration 024).
  FOR rec IN
    SELECT value FROM jsonb_array_elements(COALESCE(payload->'favorites', '[]'::jsonb))
  LOOP
    CONTINUE WHEN COALESCE(rec->>'coursePrefix', '') = ''
               OR COALESCE(rec->>'courseNumber', '') = '';

    INSERT INTO saved_courses
      (user_id, state, course_prefix, course_number, course_title)
    VALUES (
      uid,
      rec->>'state',
      rec->>'coursePrefix',
      rec->>'courseNumber',
      COALESCE(rec->>'courseTitle', '')
    )
    ON CONFLICT (user_id, state, course_prefix, course_number, college_code, crn)
    DO NOTHING;

    IF FOUND THEN
      inserted := inserted + 1;
    END IF;
  END LOOP;

  RETURN inserted;
END;
$$;

REVOKE ALL ON FUNCTION drain_anonymous_plans(jsonb) FROM public;
REVOKE ALL ON FUNCTION drain_anonymous_plans(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION drain_anonymous_plans(jsonb) TO authenticated;

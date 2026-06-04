-- ============================================================================
-- 028: drain_anonymous_plans — also drain saved schedules
-- ============================================================================
-- WHAT: Extends the 026 drain function (SAME NAME/SIGNATURE — the live client
--       calls drain_anonymous_plans; renaming/dropping would break the live
--       plan + favorite drain) to ALSO insert chosen schedules from
--       payload->'schedules' into saved_schedules, idempotent via 027's partial
--       unique index (user_id, client_dedup_key). Old clients (1b-i/1b-ii) send
--       no 'schedules' key → COALESCE to [] → harmless no-op.
-- WHY:  1b-iii — a schedule built while logged out should survive sign-in.
-- KEY DIFFERENCE vs plans/favorites: a saved schedule stores COMPUTED data — it
--       is ONE chosen GeneratedSchedule, not a recomputed-from-input artifact —
--       so the draft carries the full sections array + score + scoreBreakdown +
--       form_data, and we insert them verbatim. form_data & sections are NOT
--       NULL in saved_schedules, so we COALESCE form_data to '{}' and skip any
--       schedule whose sections array is empty.
-- SECURITY: unchanged from 026 — SECURITY DEFINER + pinned search_path, writes
--       only the caller's rows (auth.uid()), EXECUTE for `authenticated` only
--       (anon revoked; also self-guards on auth.uid() IS NULL).
-- CAVEATS: Idempotent (CREATE OR REPLACE). Additive. Requires 027 applied first.
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

  -- Plans (unchanged from 025/026).
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

  -- Favorites (unchanged from 026). Idempotent via the saved_courses unique
  -- index (user_id, state, course_prefix, course_number, college_code, crn);
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

  -- Schedules (new in 028). A saved schedule is one CHOSEN GeneratedSchedule, so
  -- we insert its sections/score/score_breakdown/form_data verbatim. Idempotent
  -- via 027's partial unique index (user_id, client_dedup_key). form_data &
  -- sections are NOT NULL → COALESCE form_data to '{}', skip empty-section rows.
  FOR rec IN
    SELECT value FROM jsonb_array_elements(COALESCE(payload->'schedules', '[]'::jsonb))
  LOOP
    CONTINUE WHEN COALESCE(rec->>'dedupKey', '') = '';
    CONTINUE WHEN jsonb_array_length(COALESCE(rec->'sections', '[]'::jsonb)) = 0;

    INSERT INTO saved_schedules
      (user_id, state, name, form_data, sections, score, score_breakdown, client_dedup_key)
    VALUES (
      uid,
      rec->>'state',
      COALESCE(NULLIF(rec->>'name', ''), 'My Schedule'),
      COALESCE(rec->'formData', '{}'::jsonb),
      rec->'sections',
      -- score column is INTEGER but real GeneratedSchedule scores are decimals
      -- (e.g. 85.3); ::numeric::integer rounds, matching how PostgREST coerces
      -- the JSON float in the authed insert path.
      NULLIF(rec->>'score', '')::numeric::integer,
      rec->'scoreBreakdown',
      rec->>'dedupKey'
    )
    ON CONFLICT (user_id, client_dedup_key) WHERE client_dedup_key IS NOT NULL
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

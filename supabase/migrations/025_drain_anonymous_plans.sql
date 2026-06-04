-- ============================================================================
-- 025: drain_anonymous_plans — idempotent anonymous→account plan drain
-- ============================================================================
-- WHAT: A function the client calls after sign-in to move the degree plans a
--       user built while logged out (stashed in sessionStorage — see
--       lib/anon-draft.ts) into their account. Inserts one saved_plans row per
--       draft plan FOR THE CALLER (auth.uid()), idempotent via the
--       client_dedup_key partial unique index from migration 024 — a retried
--       drain is a no-op. Returns the number of rows actually inserted.
-- WHY:  "Sign in to save" on the planner triggers a full-page OAuth redirect
--       that destroys the in-memory plan; this is how it survives and lands.
-- SECURITY: SECURITY DEFINER + pinned search_path (privilege-escalation guard,
--       same as migration 022). Writes ONLY the caller's rows — user_id is
--       auth.uid(), never trusted from the payload. EXECUTE granted to the
--       `authenticated` role only.
-- CAVEATS: Additive; idempotent (CREATE OR REPLACE). plan_data is a minimal
--       placeholder by kind — /plan/[id] recomputes from target_courses, so the
--       cached snapshot isn't needed for a drained plan.
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

  FOR rec IN
    SELECT value FROM jsonb_array_elements(COALESCE(payload->'plans', '[]'::jsonb))
  LOOP
    -- Skip entries with no dedup key: the partial unique index can't dedup them,
    -- so they'd risk duplicates on retry.
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

  RETURN inserted;
END;
$$;

-- Supabase's default privileges grant EXECUTE to anon + authenticated directly
-- (not via PUBLIC), so revoke from both PUBLIC and anon, then grant only to
-- authenticated. (The function also self-protects via auth.uid() IS NULL.)
REVOKE ALL ON FUNCTION drain_anonymous_plans(jsonb) FROM public;
REVOKE ALL ON FUNCTION drain_anonymous_plans(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION drain_anonymous_plans(jsonb) TO authenticated;

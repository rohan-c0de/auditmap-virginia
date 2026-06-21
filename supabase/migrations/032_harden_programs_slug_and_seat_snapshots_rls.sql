-- 032_harden_programs_slug_and_seat_snapshots_rls.sql
--
-- Applied to prod (Project CC) on 2026-06-21 via the management API; this file
-- records it for traceability (repo migrations are applied by hand here).
--
-- Two independent fixes surfaced by a prod audit:
--
-- 1) programs.college_slug was varchar(50). Six community-college slugs exceed
--    50 chars (e.g. "cossatot-community-college-of-the-university-of-arkansas"
--    = 56), so every programs-import row for those colleges failed with
--    "value too long for type character varying(50)" and was silently dropped —
--    leaving those colleges with no programs (and a dead degree-path planner).
--    courses.college_code is already `text`; widen college_slug to match.
--
-- 2) public.seat_snapshots had RLS disabled while being exposed through
--    PostgREST (Supabase advisor 0013, ERROR). Enable RLS and mirror the
--    public-read / service-role-write policy set used by courses, programs,
--    and transfers.

-- 1) Widen the slug column (non-destructive; varchar -> text needs no rewrite).
ALTER TABLE public.programs ALTER COLUMN college_slug TYPE text;

-- 2) Lock down seat_snapshots with the standard policy set.
ALTER TABLE public.seat_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read seat_snapshots"
  ON public.seat_snapshots FOR SELECT
  USING (true);

CREATE POLICY "Service write seat_snapshots"
  ON public.seat_snapshots FOR INSERT
  WITH CHECK ((SELECT auth.role()) = 'service_role');

CREATE POLICY "Service update seat_snapshots"
  ON public.seat_snapshots FOR UPDATE
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

CREATE POLICY "Service delete seat_snapshots"
  ON public.seat_snapshots FOR DELETE
  USING ((SELECT auth.role()) = 'service_role');

-- ============================================================
-- Widen courses.location column to TEXT
-- Run via Supabase Dashboard → SQL Editor
--
-- Migration 002 widened campus, crn, days, mode, instructor, and
-- start_time/end_time to TEXT for similar overflow reasons. `location`
-- was missed and remained VARCHAR(50), which silently aborted the
-- per-(college,term) import batch on every SCKTC run since PR #324
-- landed on 2026-05-10. Example overflow:
--   "Main Campus Building C Room 17 - 17 - Southcentral KY Comm Tech Coll"
--   (67 chars)
--
-- After applying this migration, re-run
--   gh workflow run import-on-merge.yml --field state=ky --field datatype=courses
-- to backfill SCKTC's 1,908 sections (823 FA + 920 SP + 165 SU).
-- Other states with long location strings will also start importing
-- cleanly going forward.
-- ============================================================

ALTER TABLE courses ALTER COLUMN location TYPE TEXT;

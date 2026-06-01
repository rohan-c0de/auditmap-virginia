-- 018_seat_snapshots.sql
--
-- Snapshot of the most recent seat counts per section, used by the seat-watch
-- cron (PR 3 of the sticky-loop sequence) to detect 0 → >0 transitions
-- without restructuring the existing courses table or its import workflow.
--
-- Design:
--   - One row per unique section, keyed by (state, term, college_code, crn).
--   - course_prefix + course_number are stored alongside so the dedup-aware
--     plan-matching query can join against saved_plans.target_courses
--     (which uses the canonical 'PREFIX NUMBER' shape) without an extra
--     lookup into the courses table.
--   - seats_open and snapshot_at: the values that were live the last time
--     the seat-watch cron observed this section.
--   - prev_seats_open and prev_snapshot_at: the previous observation. The
--     cron rotates current → prev before writing the new current; that
--     way the transition test is a simple WHERE prev = 0 AND seats_open > 0
--     against this table without needing a separate history table.
--
-- Why this lives in its own table (not on courses):
--   The courses table is REPLACED on every scrape import (per import-on-
--   merge.yml). Adding a "previous seats" column there would get clobbered
--   every time data refreshes. seat_snapshots is owned by the cron, not the
--   import, so the cron controls its rotation cadence independently.

CREATE TABLE seat_snapshots (
  state          VARCHAR(2)   NOT NULL,
  term           VARCHAR(16)  NOT NULL,
  college_code   TEXT         NOT NULL,
  crn            TEXT         NOT NULL,
  course_prefix  TEXT         NOT NULL,
  course_number  TEXT         NOT NULL,
  -- Current observation
  seats_open     INTEGER,
  seats_total    INTEGER,
  snapshot_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- Previous observation (NULL on first sighting). Cron rotates these on
  -- each pass before writing the new current.
  prev_seats_open    INTEGER,
  prev_snapshot_at   TIMESTAMPTZ,
  PRIMARY KEY (state, term, college_code, crn)
);

-- The cron's transition query is:
--   SELECT ... FROM seat_snapshots
--   WHERE prev_seats_open = 0 AND seats_open > 0
--     AND (state, course_prefix, course_number) ANY plan target_courses
-- Index on (course_prefix, course_number, state) makes the plan-matching
-- join cheap. We don't need a covering index over seats_open because the
-- transition test is a tiny fraction of rows.
CREATE INDEX idx_seat_snapshots_course
  ON seat_snapshots (course_prefix, course_number, state);

-- No RLS on this table: it's only read/written by the cron's service-role
-- client, never by browser clients. Default Supabase posture is RLS off
-- unless explicitly enabled.

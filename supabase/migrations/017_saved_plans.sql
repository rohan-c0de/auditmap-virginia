-- 017_saved_plans.sql
--
-- User-owned degree-path plans for the SemesterPlanner.
--
-- Mirrors the saved_schedules / saved_courses / saved_transfers pattern
-- from 006_user_accounts.sql: UUID PK, ON DELETE CASCADE to auth.users,
-- state-scoped, RLS "users manage own", three covering indexes.
--
-- A plan stores the user's target courses (the input the planner is built
-- around) plus a cached snapshot of the computed semester sequence. The
-- snapshot lets /plan/[id] render instantly without re-running the planner
-- and survives prereq-data updates that might change the live computation.
--
-- Plans are state-scoped (state NOT NULL) for PR 1. Cross-state plans are
-- a later concern; nothing in the UI supports them today.
--
-- Plans are immutable from this PR's perspective: there is no UPDATE flow
-- in the UI. Users delete and re-save, matching the convention of every
-- other saved_* table. The RLS policy allows UPDATE so a future PR can
-- add edit-in-place without a migration change.

CREATE TABLE saved_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  state VARCHAR(2) NOT NULL,
  name TEXT NOT NULL DEFAULT 'My Plan',
  -- User input: the course codes ("BIOL 1010", "ENGL 1010") the planner was
  -- asked to sequence. Stored as a TEXT[] for direct querying — useful when
  -- the seat-watch cron (PR 3) needs to find "all plans containing this course".
  target_courses TEXT[] NOT NULL DEFAULT '{}',
  -- Cached planner output. JSONB shape mirrors buildPlan()'s return:
  -- [{ semester: 1, courses: [{ code, title, credits, prereqs }] }, ...]
  -- Cached for fast /plan/[id] render and to preserve the user's snapshot
  -- even if prereq data later changes.
  plan_data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes mirror saved_schedules: by-user (account dashboard listing),
-- by-user-by-state (state-scoped views), by-user-by-created (DESC for
-- "most recent first" on the dashboard).
CREATE INDEX idx_saved_plans_user ON saved_plans(user_id);
CREATE INDEX idx_saved_plans_user_state ON saved_plans(user_id, state);
CREATE INDEX idx_saved_plans_user_created ON saved_plans(user_id, created_at DESC);

-- A GIN index on target_courses lets the future seat-watch cron find all
-- plans containing a given course code in O(log n) rather than scanning.
-- Speculative-but-cheap; the cron is the next PR.
CREATE INDEX idx_saved_plans_target_courses ON saved_plans USING GIN (target_courses);

ALTER TABLE saved_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own plans"
  ON saved_plans FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

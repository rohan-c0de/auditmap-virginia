-- Seat-watch: per-course notification opt-in from the plan page.
--
-- A user marks a required course "notify me" → a row is inserted here.
-- The daily seat-watch cron (scripts/seat-watch-cron.ts) queries this table,
-- calls sections-for-courses, and sends an email when:
--   - the course has newly-available seats (total_seats_open > 0 after being 0)
--   - OR the course is almost full (total_seats_open ≤ 5 and dropping)
-- After sending, notified_at is stamped so we don't spam.

CREATE TABLE seat_watches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  state VARCHAR(2) NOT NULL,
  college_slug TEXT NOT NULL,
  course_code TEXT NOT NULL,   -- "PREFIX NUMBER" e.g. "BIOL 1010"
  term TEXT NOT NULL,          -- e.g. "2026FA"
  -- Last time we sent a notification for this watch. NULL = never sent.
  notified_at TIMESTAMPTZ,
  -- Cache of the seat count at last check — lets the cron detect changes.
  last_seats_open INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  -- One watch per user + course + term + college. ON CONFLICT DO NOTHING on insert.
  UNIQUE(user_id, state, college_slug, course_code, term)
);

CREATE INDEX idx_seat_watches_user ON seat_watches(user_id);
-- Cron index: find all watches for a given state+term in O(log n).
CREATE INDEX idx_seat_watches_state_term ON seat_watches(state, term);
-- Cron index: find watches not yet notified (or notified long ago).
CREATE INDEX idx_seat_watches_pending ON seat_watches(state, notified_at NULLS FIRST);

ALTER TABLE seat_watches ENABLE ROW LEVEL SECURITY;

-- Users can read and delete their own watches.
CREATE POLICY "seat_watches_select_own"
  ON seat_watches FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "seat_watches_insert_own"
  ON seat_watches FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "seat_watches_delete_own"
  ON seat_watches FOR DELETE
  USING (auth.uid() = user_id);

-- Cron (service role) can read and update all rows.
CREATE POLICY "seat_watches_service_read"
  ON seat_watches FOR SELECT
  USING (auth.role() = 'service_role');

CREATE POLICY "seat_watches_service_update"
  ON seat_watches FOR UPDATE
  USING (auth.role() = 'service_role');

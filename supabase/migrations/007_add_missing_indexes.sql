-- Add compound index on saved_transfers(user_id, state) to match
-- saved_schedules and saved_courses which already have this index.
-- Speeds up the account dashboard queries that filter by user + state.

CREATE INDEX IF NOT EXISTS idx_saved_transfers_user_state
  ON saved_transfers(user_id, state);

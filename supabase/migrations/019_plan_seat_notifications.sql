-- 019_plan_seat_notifications.sql
--
-- Dedup ledger for the seat-watch cron's email sends. Each row records that
-- (user_id, plan_id, course_code, course transition_at) → an email was
-- queued / sent. The cron consults this before sending so the same user
-- doesn't get re-notified about the same transition event.
--
-- Why both plan_id and user_id: a single user can have the same course in
-- multiple plans (a transfer student exploring options). Dedup by plan to
-- avoid silently dropping a notification just because we sent for the
-- OTHER plan; let the per-user-per-day rate limit (applied at send-time,
-- not in this schema) handle the cross-plan spam case.
--
-- Why course_code as a single TEXT: matches the canonical 'PREFIX NUMBER'
-- shape stored in saved_plans.target_courses. Avoids the (prefix, number)
-- tuple-IN PostgREST limitation in the cron's main query.

CREATE TABLE plan_seat_notifications (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id          UUID         NOT NULL REFERENCES saved_plans(id) ON DELETE CASCADE,
  course_code      TEXT         NOT NULL,
  state            VARCHAR(2)   NOT NULL,
  -- Anchor of the transition event we notified about. The cron uses the
  -- new snapshot_at value as the anchor; resending only happens if a NEW
  -- transition occurs (a new 0 → >0 cycle with snapshot_at > stored value).
  transition_at    TIMESTAMPTZ  NOT NULL,
  sent_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- Resend message ID for debugging deliverability issues. NULL when
  -- SEAT_WATCH_DRY_RUN=true (logged-not-sent), so this column also doubles
  -- as a dry-run/real distinction.
  resend_message_id TEXT
);

-- Hot path: "have we already sent for this user × plan × course since
-- transition_at?" — equality lookup, fast on a single composite index.
CREATE INDEX idx_plan_seat_notifications_dedup
  ON plan_seat_notifications (user_id, plan_id, course_code, transition_at DESC);

-- Per-user rate-limit query: "how many notifications has this user
-- received in the last 24h?" — date-range scan on user_id.
CREATE INDEX idx_plan_seat_notifications_user_sent
  ON plan_seat_notifications (user_id, sent_at DESC);

-- RLS: a signed-in user can read their own notification history (for
-- transparency / "why am I getting this email?" support), but cannot
-- INSERT/UPDATE/DELETE — only the service-role cron can write.
ALTER TABLE plan_seat_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own seat-watch notifications"
  ON plan_seat_notifications FOR SELECT
  USING (auth.uid() = user_id);

-- ──────────────────────────────────────────────────────────────────────
-- profiles.seat_notifications_enabled
--
-- Per-user opt-out. Defaults to true so signed-in users with saved plans
-- start receiving notifications without an extra setup step (the value
-- prop is "save your plan and we'll watch it for you"). One-click
-- unsubscribe links in every email flip this to false; the cron's
-- target-user query filters on it.
-- ──────────────────────────────────────────────────────────────────────

ALTER TABLE profiles
  ADD COLUMN seat_notifications_enabled BOOLEAN NOT NULL DEFAULT true;

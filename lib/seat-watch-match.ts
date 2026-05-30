/**
 * Plan-matching + dedup for the seat-watch cron.
 *
 * Given the Transition rows from lib/seat-watch.ts, find every saved_plan
 * that contains the transitioning course AND whose owner:
 *   - has seat_notifications_enabled = true on their profile
 *   - has NOT already been notified for this exact transition_at value
 *   - has not exceeded the per-user-per-day rate limit (1 email / 24h)
 *
 * Emits one Notification row per (user, plan, transition) that should be
 * sent. The cron passes these to lib/seat-watch-email.ts (chunk 4) which
 * renders the HTML and hands off to Resend.
 *
 * Why a separate file: lib/seat-watch.ts is the pure data-pipeline; this
 * file is policy (rate limits, opt-out checks, RLS bypass for the joins).
 * Keeping them separate makes the policy easy to reason about — the cron
 * only needs to read this file to answer "would I send an email here?".
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Transition } from "./seat-watch";

export interface Notification {
  user_id: string;
  user_email: string;
  user_display_name: string | null;
  plan_id: string;
  plan_name: string;
  course_code: string;
  /** State slug for the link back to /plan/{id} and for the email "context" line. */
  state: string;
  /** Transition data passed straight through to the email template. */
  seats_open: number;
  seats_total: number | null;
  college_code: string;
  /** snapshot_at — used as the dedup anchor in plan_seat_notifications. */
  transition_at: string;
}

/** Max emails per user per rolling 24h window. The user may have a dozen
 *  courses in plans that all open the same morning (popular state-level
 *  enrollment batch). Without this cap the experience would be 'inbox
 *  flood', not 'helpful nudge'. */
const PER_USER_DAILY_CAP = 1;

interface SavedPlanRow {
  id: string;
  name: string;
  state: string;
  user_id: string;
  target_courses: string[];
}

interface PriorNotification {
  user_id: string;
  plan_id: string;
  course_code: string;
  transition_at: string;
  sent_at: string;
}

interface ProfileRow {
  id: string;
  seat_notifications_enabled: boolean;
}

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
}

/** Main entry. Given a batch of transitions, returns the notifications
 *  that should actually be sent (after RLS/opt-out/dedup/rate-limit
 *  filters). The cron writes the plan_seat_notifications rows AFTER the
 *  Resend send, not here, so a Resend failure doesn't poison the dedup
 *  table. */
export async function matchTransitionsToNotifications(
  service: SupabaseClient,
  transitions: Transition[],
): Promise<Notification[]> {
  if (transitions.length === 0) return [];

  // Group transitions by course_code so the plan-matching query can use
  // the GIN index on saved_plans.target_courses (created in PR #827's
  // 017_saved_plans.sql) via the @> array-contains operator.
  const byCourse = new Map<string, Transition>();
  for (const t of transitions) {
    // Take the freshest transition_at if a course had multiple sections
    // open at once — one notification covers all of them anyway.
    const prev = byCourse.get(t.course_code);
    if (!prev || t.snapshot_at > prev.snapshot_at) byCourse.set(t.course_code, t);
  }
  const courses = Array.from(byCourse.keys());

  // ── Find plans containing any transitioning course ────────────────────
  // Supabase JS client: .contains('target_courses', [code]) → @> operator
  // → uses idx_saved_plans_target_courses GIN. One query per state-and-
  // course is overkill; one query per course gets us correct results with
  // minimal index pressure. saved_plans is small (per-user) so a single
  // OR-style overlaps query also works — using overlaps for one round-trip.
  const { data: planRows, error: planErr } = await service
    .from("saved_plans")
    .select("id, name, state, user_id, target_courses")
    .overlaps("target_courses", courses);
  if (planErr) {
    throw new Error(`matchTransitions plans: ${planErr.message}`);
  }
  const plans = (planRows ?? []) as SavedPlanRow[];
  if (plans.length === 0) return [];

  const userIds = [...new Set(plans.map((p) => p.user_id))];

  // ── Filter by opt-out flag ────────────────────────────────────────────
  const { data: profileRows, error: profErr } = await service
    .from("profiles")
    .select("id, seat_notifications_enabled")
    .in("id", userIds);
  if (profErr) throw new Error(`matchTransitions profiles: ${profErr.message}`);
  const enabled = new Set(
    ((profileRows ?? []) as ProfileRow[])
      .filter((p) => p.seat_notifications_enabled)
      .map((p) => p.id),
  );

  const eligibleUserIds = userIds.filter((id) => enabled.has(id));
  if (eligibleUserIds.length === 0) return [];

  // ── Resolve emails / display names ────────────────────────────────────
  // auth.users isn't directly readable via the JS client even with the
  // service role; use the admin API. Fall back to profile.display_name
  // when no email is on file (shouldn't happen for password+OAuth users
  // but the dedup ledger doesn't care if name is null).
  const userMap = new Map<string, UserRow>();
  // Page through admin listUsers in chunks of 100.
  const adminApi = service.auth.admin;
  let page = 1;
  const PAGE_SIZE = 100;
  while (true) {
    const { data, error } = await adminApi.listUsers({
      page,
      perPage: PAGE_SIZE,
    });
    if (error) {
      throw new Error(`matchTransitions listUsers: ${error.message}`);
    }
    const users = data?.users ?? [];
    if (users.length === 0) break;
    for (const u of users) {
      if (!eligibleUserIds.includes(u.id)) continue;
      const displayName =
        ((u.user_metadata as Record<string, unknown> | null)?.full_name as
          | string
          | undefined) ?? null;
      userMap.set(u.id, {
        id: u.id,
        email: u.email ?? "",
        display_name: displayName,
      });
    }
    if (users.length < PAGE_SIZE) break;
    page++;
  }

  // ── Dedup — already-sent ──────────────────────────────────────────────
  // For each (user, plan, course) we may have a prior notification with the
  // same transition_at. Skip those.
  const { data: priorRows, error: priorErr } = await service
    .from("plan_seat_notifications")
    .select("user_id, plan_id, course_code, transition_at")
    .in("user_id", eligibleUserIds);
  if (priorErr) {
    throw new Error(`matchTransitions prior: ${priorErr.message}`);
  }
  const dedupKeys = new Set<string>();
  const dailyCountByUser = new Map<string, number>();
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  for (const row of (priorRows ?? []) as PriorNotification[]) {
    const k = `${row.user_id}|${row.plan_id}|${row.course_code}|${row.transition_at}`;
    dedupKeys.add(k);
    if (new Date(row.sent_at).getTime() > dayAgo) {
      dailyCountByUser.set(
        row.user_id,
        (dailyCountByUser.get(row.user_id) ?? 0) + 1,
      );
    }
  }

  // ── Compose ───────────────────────────────────────────────────────────
  // For each (plan, course) pair where the plan contains a transitioned
  // course, emit one Notification — passing rate-limit + dedup checks.
  const out: Notification[] = [];
  for (const plan of plans) {
    const user = userMap.get(plan.user_id);
    if (!user || !user.email) continue;
    for (const code of plan.target_courses ?? []) {
      const t = byCourse.get(code);
      if (!t) continue;
      const dedupKey = `${plan.user_id}|${plan.id}|${code}|${t.snapshot_at}`;
      if (dedupKeys.has(dedupKey)) continue;
      const used = dailyCountByUser.get(plan.user_id) ?? 0;
      if (used >= PER_USER_DAILY_CAP) continue;
      out.push({
        user_id: plan.user_id,
        user_email: user.email,
        user_display_name: user.display_name,
        plan_id: plan.id,
        plan_name: plan.name,
        course_code: code,
        state: t.state,
        seats_open: t.seats_open,
        seats_total: t.seats_total,
        college_code: t.college_code,
        transition_at: t.snapshot_at,
      });
      // Provisionally charge against the daily cap so the same user
      // doesn't get 5 emails from a single cron pass.
      dailyCountByUser.set(plan.user_id, used + 1);
    }
  }
  return out;
}

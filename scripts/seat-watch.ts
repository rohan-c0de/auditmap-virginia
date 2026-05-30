/**
 * Seat-watch cron entry point — wires together the three lib/seat-watch* modules.
 *
 * Pipeline:
 *   1. collectWatchedCourses     → set of course codes anyone has saved
 *   2. fetchCurrentSeats         → live seats_open per (state, term, college, crn)
 *   3. rotateAndDiff             → upserts seat_snapshots, returns Transitions
 *   4. matchTransitionsToNotifications  → applies opt-out, dedup, rate-limit
 *   5. for each Notification: sign token → send email → log to plan_seat_notifications
 *
 * Gating:
 *   SEAT_WATCH_DRY_RUN=true (default)   — logs everything; does NOT call Resend;
 *                                          does NOT write plan_seat_notifications.
 *   SEAT_WATCH_DRY_RUN=false             — real sends + ledger writes.
 *
 * The dry-run default is intentional: this is the first cron pass after
 * shipping; a misconfig or a stale snapshot could mass-email real users.
 * Vercel / GitHub Actions secrets explicitly flip it off when the operator
 * is confident.
 *
 * Exit codes:
 *   0  — clean run (even with no transitions; that's not an error)
 *   1  — fatal config error (missing env, schema mismatch, etc.)
 *
 * Per-recipient send errors are caught and logged but don't fail the job;
 * one bounce shouldn't kill the batch. The plan_seat_notifications row is
 * only written when the send succeeds, so a transient Resend error means
 * the user gets re-attempted on the next cron pass.
 */
import { getServiceClient } from "../lib/supabase";
import {
  collectWatchedCourses,
  fetchCurrentSeats,
  rotateAndDiff,
} from "../lib/seat-watch";
import { matchTransitionsToNotifications } from "../lib/seat-watch-match";
import { sendSeatOpenedNotification } from "../lib/email";
import { signUnsubscribeToken } from "../lib/seat-watch-token";

const DRY_RUN = (process.env.SEAT_WATCH_DRY_RUN ?? "true").toLowerCase() !== "false";

function log(msg: string, extra?: Record<string, unknown>) {
  const ts = new Date().toISOString();
  if (extra) {
    console.log(`[${ts}] [seat-watch] ${msg}`, JSON.stringify(extra));
  } else {
    console.log(`[${ts}] [seat-watch] ${msg}`);
  }
}

async function main() {
  log(`Starting seat-watch run (DRY_RUN=${DRY_RUN})`);
  const service = getServiceClient();

  // 1. Watched courses
  const { codes, byState } = await collectWatchedCourses(service);
  if (codes.size === 0) {
    log("No saved plans contain any courses; nothing to watch. Exit clean.");
    return;
  }
  log(`Watching ${codes.size} unique courses across ${byState.size} states`);

  // 2. Current seats
  const current = await fetchCurrentSeats(service, byState);
  log(`Loaded ${current.length} current section rows from courses`);

  // 3. Rotate snapshots + emit transitions
  const transitions = await rotateAndDiff(service, current);
  log(`Detected ${transitions.length} 0 → >0 transitions`);
  if (transitions.length === 0) return;

  // 4. Match → notification list
  const notifications = await matchTransitionsToNotifications(
    service,
    transitions,
  );
  log(
    `Composed ${notifications.length} notifications (after opt-out / dedup / rate-limit filters)`,
  );
  if (notifications.length === 0) return;

  if (DRY_RUN) {
    for (const n of notifications) {
      log("DRY_RUN would send:", {
        to: n.user_email,
        course: n.course_code,
        plan: n.plan_name,
        seats: `${n.seats_open}/${n.seats_total ?? "?"}`,
        observed: n.transition_at,
      });
    }
    log("DRY_RUN finished. No emails sent, no ledger rows written.");
    return;
  }

  // 5. Real send path
  let sent = 0;
  let failed = 0;
  for (const n of notifications) {
    try {
      const token = signUnsubscribeToken(n.user_id);
      const messageId = await sendSeatOpenedNotification({
        to: n.user_email,
        displayName: n.user_display_name,
        state: n.state,
        courseCode: n.course_code,
        collegeCode: n.college_code,
        planId: n.plan_id,
        planName: n.plan_name,
        seatsOpen: n.seats_open,
        seatsTotal: n.seats_total,
        snapshotAt: n.transition_at,
        unsubscribeToken: token,
      });
      const { error } = await service.from("plan_seat_notifications").insert({
        user_id: n.user_id,
        plan_id: n.plan_id,
        course_code: n.course_code,
        state: n.state,
        transition_at: n.transition_at,
        resend_message_id: messageId,
      });
      if (error) {
        // Email already sent; ledger insert failed. Log loudly so an
        // operator can investigate, but don't crash the batch.
        console.error(
          `[seat-watch] WARN: sent email but ledger insert failed for ${n.user_email} ${n.course_code}: ${error.message}`,
        );
      }
      sent++;
    } catch (e) {
      failed++;
      console.error(
        `[seat-watch] ERROR sending to ${n.user_email} for ${n.course_code}:`,
        e instanceof Error ? e.message : e,
      );
    }
  }
  log(`Run complete. sent=${sent} failed=${failed}`);
}

main().catch((err) => {
  console.error("[seat-watch] FATAL:", err);
  process.exit(1);
});

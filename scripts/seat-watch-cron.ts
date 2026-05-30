/**
 * Seat-watch cron — runs daily via GitHub Actions.
 *
 * For every active seat_watches row, calls the sections-for-courses API to
 * get current seat counts. Sends a notification email when:
 *   - seats_open > 0 and previously was 0 or NULL (course just opened)
 *   - seats_open is 1-5 and dropped from last check (filling up fast — not
 *     yet implemented; start with "just opened" as the higher-value signal)
 * After sending, stamps notified_at and updates last_seats_open.
 *
 * Requires:
 *   SUPABASE_SERVICE_ROLE_KEY  — for reading seat_watches + user emails
 *   NEXT_PUBLIC_SUPABASE_URL   — Supabase project URL
 *   RESEND_API_KEY             — for sending emails
 *   NEXT_PUBLIC_SITE_URL       — to build plan page links
 */
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { sendSeatOpenedNotification } from "@/lib/email";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com";
const API_URL = SITE_URL; // sections-for-courses lives on the same origin

const supabase = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

interface Watch {
  id: string;
  user_id: string;
  state: string;
  college_slug: string;
  course_code: string;
  term: string;
  last_seats_open: number | null;
  notified_at: string | null;
}

interface SectionSummary {
  course_code: string;
  section_count: number;
  total_seats_open: number | null;
}

/** Fetch live seat counts for a batch of course codes in one state+term. */
async function fetchSeats(
  state: string,
  term: string,
  codes: string[],
): Promise<Map<string, SectionSummary>> {
  const url = `${API_URL}/api/${state}/sections-for-courses?codes=${codes.map(encodeURIComponent).join(",")}&term=${term}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`  sections-for-courses ${state}/${term} HTTP ${res.status}`);
    return new Map();
  }
  const data = await res.json() as SectionSummary[];
  return new Map(data.map((s) => [s.course_code, s]));
}

async function main() {
  console.log("Seat-watch cron starting…");

  // Load all active watches (service role bypasses RLS).
  const { data: watches, error } = await supabase
    .from("seat_watches")
    .select("id,user_id,state,college_slug,course_code,term,last_seats_open,notified_at")
    .order("state")
    .order("term");

  if (error || !watches) {
    console.error("Failed to load seat_watches:", error);
    process.exit(1);
  }
  console.log(`Loaded ${watches.length} active watches`);

  // Group by state+term for efficient batch API calls.
  const byStateTerm = new Map<string, Watch[]>();
  for (const w of watches as Watch[]) {
    const key = `${w.state}:${w.term}`;
    if (!byStateTerm.has(key)) byStateTerm.set(key, []);
    byStateTerm.get(key)!.push(w);
  }

  let notified = 0;
  let errors = 0;

  for (const [key, group] of byStateTerm) {
    const [state, term] = key.split(":");
    console.log(`\n${state}/${term}: ${group.length} watches`);

    const codes = [...new Set(group.map((w) => w.course_code))];
    const seats = await fetchSeats(state, term, codes);

    for (const watch of group) {
      const summary = seats.get(watch.course_code);
      const seatsNow = summary?.total_seats_open ?? 0;
      const hadSeats = watch.last_seats_open ?? 0;

      // Update last_seats_open regardless of notification.
      await supabase
        .from("seat_watches")
        .update({ last_seats_open: seatsNow })
        .eq("id", watch.id);

      // Skip if seats haven't newly opened.
      if (seatsNow <= 0 || hadSeats > 0) continue;
      // Skip if notified in the last 7 days (avoid spam if seats oscillate).
      if (watch.notified_at) {
        const daysSince = (Date.now() - new Date(watch.notified_at).getTime()) / 86_400_000;
        if (daysSince < 7) continue;
      }

      // Get user's email via auth admin API.
      const { data: userData } = await supabase.auth.admin.getUserById(watch.user_id);
      const email = userData?.user?.email;
      if (!email) continue;

      try {
        await sendSeatOpenedNotification(
          email,
          state,
          watch.course_code,
          "", // course title not stored; the code is sufficient
          watch.college_slug,
          seatsNow,
          term,
          `${SITE_URL}/${state}/college/${watch.college_slug}`,
        );
        await supabase
          .from("seat_watches")
          .update({ notified_at: new Date().toISOString() })
          .eq("id", watch.id);
        console.log(`  ✓ notified ${email} about ${watch.course_code}`);
        notified++;
      } catch (e) {
        console.error(`  ✗ failed to notify ${email}:`, e);
        errors++;
      }
    }
  }

  console.log(`\nDone: ${notified} notifications sent, ${errors} errors`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("Cron crashed:", e);
  process.exit(1);
});

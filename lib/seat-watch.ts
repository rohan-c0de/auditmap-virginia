/**
 * Seat-watch library — the diff engine behind PR 3's notification cron.
 *
 * Pipeline:
 *   1. collectWatchedCourses()       — read every distinct course code
 *                                      that appears in at least one
 *                                      saved_plans.target_courses array.
 *   2. fetchCurrentSeats()           — load the live (state, term, college,
 *                                      crn, course_prefix, course_number,
 *                                      seats_open) rows for those courses
 *                                      from the courses table.
 *   3. rotateAndDiff()               — for each section, look up its row in
 *                                      seat_snapshots, rotate the prev →
 *                                      current values, write the new
 *                                      observation, and emit a Transition
 *                                      row whenever prev_seats_open === 0
 *                                      AND seats_open > 0.
 *
 * Output: an array of Transition rows the cron passes to the plan-matching
 * step (chunk 3) and then the email send (chunk 4).
 *
 * Concurrency posture: this runs from a single GitHub Actions job, so we
 * use the service-role client (RLS bypass) and a simple sequential loop.
 * No build-time fan-out concerns like the lib/transfer.ts case from PR 855.
 *
 * Idempotency: rotation is upsert-by-PK. Running the cron twice with no
 * intervening data change is a no-op (prev_seats_open gets overwritten
 * with what's already in current; the transition test fails because
 * prev = current now).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface Transition {
  state: string;
  term: string;
  college_code: string;
  crn: string;
  course_prefix: string;
  course_number: string;
  /** Canonical 'PREFIX NUMBER' form — matches saved_plans.target_courses[]. */
  course_code: string;
  /** New observation — non-zero by definition. */
  seats_open: number;
  seats_total: number | null;
  /** When the new observation was recorded (seat_snapshots.snapshot_at). */
  snapshot_at: string;
}

interface SnapshotRow {
  state: string;
  term: string;
  college_code: string;
  crn: string;
  course_prefix: string;
  course_number: string;
  seats_open: number | null;
  seats_total: number | null;
  snapshot_at: string;
  prev_seats_open: number | null;
  prev_snapshot_at: string | null;
}

interface CurrentSeatsRow {
  state: string;
  term: string;
  college_code: string;
  crn: string;
  course_prefix: string;
  course_number: string;
  seats_open: number | null;
  seats_total: number | null;
}

/** Read every distinct course code present in any saved_plans row.
 *  Returns the set in 'PREFIX NUMBER' canonical form. Empty when nobody
 *  has saved any plans yet — the cron treats that as a clean exit. */
export async function collectWatchedCourses(
  service: SupabaseClient,
): Promise<{ codes: Set<string>; byState: Map<string, Set<string>> }> {
  // We could push this into an RPC (SELECT DISTINCT unnest(target_courses))
  // but a paginated select is fine — the table is small (per-user rows,
  // not per-course) and pagination keeps memory bounded.
  const codes = new Set<string>();
  const byState = new Map<string, Set<string>>();
  const PAGE_SIZE = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await service
      .from("saved_plans")
      .select("state, target_courses")
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`collectWatchedCourses: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data as { state: string; target_courses: string[] }[]) {
      for (const c of row.target_courses ?? []) {
        codes.add(c);
        let set = byState.get(row.state);
        if (!set) {
          set = new Set<string>();
          byState.set(row.state, set);
        }
        set.add(c);
      }
    }
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return { codes, byState };
}

/** For each (state, course_code) in the watched set, load the live
 *  per-section seat counts from the courses table. Returns one row per
 *  unique (state, term, college_code, crn). */
export async function fetchCurrentSeats(
  service: SupabaseClient,
  byState: Map<string, Set<string>>,
): Promise<CurrentSeatsRow[]> {
  const all: CurrentSeatsRow[] = [];
  for (const [state, codeSet] of byState) {
    // Group by prefix → one query per prefix per state. PostgREST can't
    // do tuple-IN, so we filter to the prefix and then check (number) in
    // memory against the per-state code list. The course_prefix index from
    // 015_state_term_college_covering_index keeps this cheap.
    const prefixes = new Set<string>();
    const codesByPrefix = new Map<string, Set<string>>();
    for (const code of codeSet) {
      const m = code.match(/^([A-Z]{2,5})\s+(\d{3,4}[A-Z]*)$/);
      if (!m) continue;
      prefixes.add(m[1]);
      let bucket = codesByPrefix.get(m[1]);
      if (!bucket) {
        bucket = new Set<string>();
        codesByPrefix.set(m[1], bucket);
      }
      bucket.add(m[2]);
    }

    for (const prefix of prefixes) {
      const numbers = codesByPrefix.get(prefix);
      if (!numbers) continue;
      const PAGE_SIZE = 1000;
      let offset = 0;
      while (true) {
        const { data, error } = await service
          .from("courses")
          .select(
            "state, term, college_code, crn, course_prefix, course_number, seats_open, seats_total",
          )
          .eq("state", state)
          .eq("course_prefix", prefix)
          .in("course_number", Array.from(numbers))
          .order("id", { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);
        if (error) {
          throw new Error(
            `fetchCurrentSeats (${state}/${prefix}): ${error.message}`,
          );
        }
        if (!data || data.length === 0) break;
        all.push(...(data as CurrentSeatsRow[]));
        if (data.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }
    }
  }
  return all;
}

/** For each (state, term, college, crn), read the prior snapshot, write the
 *  new observation with prev = old current, and emit a Transition when
 *  prev_seats_open === 0 AND new seats_open > 0. Sequential to keep the
 *  service client's connection pool happy; this is the cron, not the
 *  request path. */
export async function rotateAndDiff(
  service: SupabaseClient,
  current: CurrentSeatsRow[],
): Promise<Transition[]> {
  const now = new Date().toISOString();
  const transitions: Transition[] = [];

  // Load all existing snapshots for the sections we're about to write, in
  // bulk per state. Saves us one round-trip per row.
  const byKey = new Map<string, SnapshotRow>();
  const byState = new Map<string, Array<{ term: string; college_code: string; crn: string }>>();
  for (const row of current) {
    const key = `${row.state}|${row.term}|${row.college_code}|${row.crn}`;
    if (byKey.has(key)) continue; // dedup current itself if duplicate
    byKey.set(key, {} as SnapshotRow); // placeholder
    let list = byState.get(row.state);
    if (!list) {
      list = [];
      byState.set(row.state, list);
    }
    list.push({ term: row.term, college_code: row.college_code, crn: row.crn });
  }

  for (const [state, sections] of byState) {
    const PAGE_SIZE = 500;
    for (let i = 0; i < sections.length; i += PAGE_SIZE) {
      const chunk = sections.slice(i, i + PAGE_SIZE);
      const crns = [...new Set(chunk.map((s) => s.crn))];
      const { data, error } = await service
        .from("seat_snapshots")
        .select("*")
        .eq("state", state)
        .in("crn", crns);
      if (error) {
        throw new Error(`rotateAndDiff load (${state}): ${error.message}`);
      }
      for (const snap of (data ?? []) as SnapshotRow[]) {
        const key = `${snap.state}|${snap.term}|${snap.college_code}|${snap.crn}`;
        byKey.set(key, snap);
      }
    }
  }

  // Build upsert payloads + emit transitions
  const upserts: SnapshotRow[] = [];
  for (const row of current) {
    const key = `${row.state}|${row.term}|${row.college_code}|${row.crn}`;
    const prior = byKey.get(key);
    const hasPrior = !!(prior && prior.snapshot_at);
    const newRow: SnapshotRow = {
      state: row.state,
      term: row.term,
      college_code: row.college_code,
      crn: row.crn,
      course_prefix: row.course_prefix,
      course_number: row.course_number,
      seats_open: row.seats_open,
      seats_total: row.seats_total,
      snapshot_at: now,
      prev_seats_open: hasPrior ? prior!.seats_open : null,
      prev_snapshot_at: hasPrior ? prior!.snapshot_at : null,
    };
    upserts.push(newRow);

    // Transition test — fires only when we've seen this section before
    // and the previous reading was zero-open while the current is positive.
    // A row we've never seen is not a "transition" — it's a baseline.
    if (
      hasPrior &&
      prior!.seats_open === 0 &&
      (row.seats_open ?? 0) > 0
    ) {
      transitions.push({
        state: row.state,
        term: row.term,
        college_code: row.college_code,
        crn: row.crn,
        course_prefix: row.course_prefix,
        course_number: row.course_number,
        course_code: `${row.course_prefix} ${row.course_number}`,
        seats_open: row.seats_open!,
        seats_total: row.seats_total,
        snapshot_at: now,
      });
    }
  }

  // Bulk upsert all observations. seat_snapshots PK = (state, term,
  // college_code, crn) so onConflict matches.
  const UPSERT_PAGE = 500;
  for (let i = 0; i < upserts.length; i += UPSERT_PAGE) {
    const batch = upserts.slice(i, i + UPSERT_PAGE);
    const { error } = await service
      .from("seat_snapshots")
      .upsert(batch, { onConflict: "state,term,college_code,crn" });
    if (error) {
      throw new Error(`rotateAndDiff upsert: ${error.message}`);
    }
  }

  return transitions;
}

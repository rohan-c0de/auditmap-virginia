// Best-outcome collapse for one-to-many transfer mappings.
//
// Transfer data is one-to-many: a single community-college course can map to
// the SAME university with several rows of different status — one direct, one
// elective, one no-credit. Any per-(course, university) display must surface
// the BEST outcome a student can actually get (direct > elective > no-credit),
// never whichever row happens to be first or last in the array.
//
// Picking the first match (`arr.find(...)`) or the last (`map.set(key, m)`)
// silently downgrades the signal — e.g. telling a student a course is only
// "elective credit" (or "does not transfer") when a direct equivalent exists.
// That is exactly the kind of wrong transfer signal that can cost a semester.
// The comparison matrix had the last-wins variant of this bug (PR #1076,
// `buildBestMappingLookup` in app/[state]/transfer/compare/types.ts); these
// helpers fix the first-wins variant on the other transfer surfaces.
//
// This module is intentionally dependency-free (no fs/path/supabase imports)
// so it is safe to import from client components as well as server code.

import type { TransferStatus } from "./types";

/**
 * Rank a transfer status so the best outcome wins. Higher is better:
 * direct (3) > elective (2) > no-credit (1) > anything else / "unknown" (0).
 */
export function rankTransferStatus(status: string): number {
  return status === "direct"
    ? 3
    : status === "elective"
      ? 2
      : status === "no-credit"
        ? 1
        : 0;
}

/** Rank a raw transfer mapping (no_credit / is_elective booleans). */
export function rankMapping(m: {
  no_credit?: boolean | null;
  is_elective?: boolean | null;
}): number {
  return m.no_credit ? 1 : m.is_elective ? 2 : 3;
}

/**
 * From a course's transfer-lookup array, return the BEST entry for `university`
 * (direct > elective > no-credit), or undefined if the course doesn't map to it.
 * Ties keep the first matching row, so the result is deterministic.
 */
export function bestTransferEntry<
  T extends { university: string; type: TransferStatus | string },
>(entries: readonly T[], university: string): T | undefined {
  let best: T | undefined;
  for (const e of entries) {
    if (e.university !== university) continue;
    if (!best || rankTransferStatus(e.type) > rankTransferStatus(best.type)) {
      best = e;
    }
  }
  return best;
}

/**
 * From a list of raw transfer mappings, return the BEST mapping for `university`
 * (direct > elective > no-credit), or undefined if none map to it. Ties keep the
 * first matching row, so the result is deterministic.
 */
export function bestMappingForUniversity<
  T extends {
    university: string;
    no_credit?: boolean | null;
    is_elective?: boolean | null;
  },
>(mappings: readonly T[], university: string): T | undefined {
  let best: T | undefined;
  for (const m of mappings) {
    if (m.university !== university) continue;
    if (!best || rankMapping(m) > rankMapping(best)) {
      best = m;
    }
  }
  return best;
}

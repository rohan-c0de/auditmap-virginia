// Honest interpretation of section seat data.
//
// `courses.seats_open` / `seats_total` mean DIFFERENT things across scrapers —
// audited across all 51 states (2026-06, ~1.28M rows):
//   • Real counts (~38 states): true open / total numbers.
//   • Flag states (mn, nd, nv, va): seats_open is a 0/1 open-or-closed flag and
//     seats_total is null — NOT a seat count.
//   • Negative seats_open (35 states, ~14k rows, −1..−363): section is FULL with
//     |open| students waitlisted.
//   • Sentinels (ca, in, ga, ms, tx): seats_open / seats_total ≥ 1000 (mostly
//     9999) mark "unlimited / online", not a real number.
//   • Missing (nh, sd, + partial elsewhere): null.
//
// Rendering any of these raw lies to students — "1 seat left!" (really an open
// flag), "−5" (really a waitlist), "9999 seats" (a sentinel). Every UI that
// shows seats MUST go through describeSeats() / aggregateSeats().

export type SeatStatus =
  | "count" // real seats remaining (open, optional total)
  | "open" // available, but no trustworthy count (flag=1, sentinel, lone 1)
  | "full" // 0 seats, or negative (waitlist)
  | "unknown"; // no data

export interface SeatInfo {
  status: SeatStatus;
  open?: number; // "count" only
  total?: number; // "count" only, when a sane total exists
  waitlist?: number; // "full" only, when derived from a negative
}

// No real class SECTION seats this many; values at/above are sentinels
// ("unlimited"/online placeholders, overwhelmingly 9999).
export const SEAT_SENTINEL = 1000;

/** Normalize one section's raw seats into an honest, displayable status. */
export function describeSeats(
  open: number | null | undefined,
  total: number | null | undefined,
): SeatInfo {
  if (open == null) return { status: "unknown" };
  if (open >= SEAT_SENTINEL) return { status: "open" }; // sentinel → unlimited/online
  if (open < 0) return { status: "full", waitlist: -open }; // negative → full + waitlist
  if (open === 0) return { status: "full" };
  // open ≥ 1
  const saneTotal =
    total != null && total > 0 && total < SEAT_SENTINEL && total >= open
      ? total
      : null;
  if (saneTotal != null) return { status: "count", open, total: saneTotal };
  // No usable total: a lone "1" is ambiguous (flag vs. one real seat) — show
  // "Open" rather than the false-scarcity "1 seat left!".
  if (open === 1) return { status: "open" };
  return { status: "count", open }; // 2..999 with no total: a real open count
}

export interface SeatAggregate {
  /** Sum of real open seat counts across sections; null when no section has a
   *  trustworthy count (e.g. flag-only states) — callers fall back to sections. */
  openSeats: number | null;
  /** Sections that are open/available (real availability or open flag). */
  openSections: number;
  totalSections: number;
  /** Any section reported a non-null seats_open at all. */
  anyData: boolean;
}

/** Aggregate a college's (or course's) sections without trusting raw sums —
 *  negatives, sentinels, and flags never inflate the count. */
export function aggregateSeats(
  sections: { seats_open: number | null; seats_total: number | null }[],
): SeatAggregate {
  let openSeats = 0;
  let hasCount = false;
  let openSections = 0;
  let anyData = false;
  for (const s of sections) {
    if (s.seats_open != null) anyData = true;
    const info = describeSeats(s.seats_open, s.seats_total);
    if (info.status === "count" && info.open != null) {
      hasCount = true;
      openSeats += info.open;
      if (info.open > 0) openSections++;
    } else if (info.status === "open") {
      openSections++;
    }
    // "full" / "unknown" contribute nothing to availability
  }
  return {
    openSeats: hasCount ? openSeats : null,
    openSections,
    totalSections: sections.length,
    anyData,
  };
}

/** Short human label for one section's seats. */
export function seatLabel(info: SeatInfo): string {
  switch (info.status) {
    case "count":
      return info.total != null
        ? `${info.open} of ${info.total} seats`
        : `${info.open} ${info.open === 1 ? "seat" : "seats"} open`;
    case "open":
      return "Open";
    case "full":
      return "Full";
    case "unknown":
      return "—";
  }
}

export type SeatTone = "good" | "low" | "full" | "muted";

/** Color intent for one section's seats. */
export function seatTone(info: SeatInfo): SeatTone {
  switch (info.status) {
    case "unknown":
      return "muted";
    case "full":
      return "full";
    case "open":
      return "good";
    case "count":
      return info.open != null && info.open <= 5 ? "low" : "good";
  }
}

/** Aggregate label for a header / matrix cell. Null = nothing trustworthy to show. */
export function aggregateLabel(a: SeatAggregate): string | null {
  if (a.openSeats != null) {
    return `${a.openSeats} ${a.openSeats === 1 ? "seat" : "seats"} open`;
  }
  if (a.anyData) {
    return `${a.openSections} of ${a.totalSections} ${a.totalSections === 1 ? "section" : "sections"} open`;
  }
  return null;
}

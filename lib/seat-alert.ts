import { describeSeats } from "@/lib/seats";

/**
 * True iff at least one of a course's sections is full — 0 seats, or a negative
 * (waitlist) value (see lib/seats describeSeats). Gates the SeatAlertCTA so the
 * "get notified when a seat opens" nudge only appears when an alert is actually
 * useful — never for a wide-open course, an unknown-seats state, or a sentinel
 * ("unlimited"/online) value.
 */
export function courseHasFullSection(
  sections: { seats_open: number | null; seats_total: number | null }[],
): boolean {
  return sections.some(
    (s) => describeSeats(s.seats_open, s.seats_total).status === "full",
  );
}

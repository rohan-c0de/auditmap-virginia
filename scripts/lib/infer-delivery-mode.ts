/**
 * Infer a section's delivery mode from its schedule/location signals.
 *
 * Several CA scrapers (scrape-4cd, scrape-sdccd, scrape-wvm) fall back to the
 * literal "unknown" when their platform doesn't expose an instruction-mode
 * field. "unknown" isn't in the CourseSectionSchema enum, so >5% of such rows
 * tripped the import abort and the whole college imported 0 sections.
 *
 * The row itself carries enough signal to classify confidently without a
 * platform mode field:
 *   - a location naming an online/remote delivery  -> online
 *   - a physical room (any other non-empty location) -> in-person
 *   - no location but a scheduled meeting (days/time) -> in-person (room TBA)
 *   - nothing scheduled and no location              -> online (async)
 *
 * Conservative by design: the only lossy case is a no-location, no-schedule
 * section that's secretly in-person-by-arrangement — rare, and "online" is a
 * far better answer than dropping the entire college. Never returns "unknown".
 */
export function inferDeliveryMode(signals: {
  location?: string | null;
  days?: string | null;
  start_time?: string | null;
}): "in-person" | "online" | "hybrid" | "zoom" {
  const loc = (signals.location ?? "").toLowerCase();
  const hasSchedule =
    !!(signals.days ?? "").trim() || !!(signals.start_time ?? "").trim();

  if (/online|remote|part-?onl|async/.test(loc)) return "online";
  if (loc.trim()) return "in-person"; // a named physical room
  if (hasSchedule) return "in-person"; // scheduled meeting, room not listed
  return "online"; // nothing scheduled, nowhere to be -> async online
}

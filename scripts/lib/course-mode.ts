/**
 * Infer a CourseSection delivery mode from a section's location / campus /
 * meeting-days strings, for scrapers whose source doesn't publish a clean
 * instruction-mode field.
 *
 * The Supabase import validates `mode` against the enum
 * "in-person" | "online" | "hybrid" | "zoom" and ABORTS a (college, term) whose
 * invalid-row ratio exceeds 5% — so a scraper that emits "" (Cisco, NTCC) or a
 * session-length label like "Regular" (Lone Star) silently fails to import.
 *
 * Conservative: only classifies online/hybrid when the location or campus
 * carries an unambiguous marker (ONLINE / WEB / INTERNET / REMOTE / HYBRID),
 * or when there is no meeting room and no meeting days (an async section).
 * Everything else is "in-person", which is the safe default for a section
 * with a real room and meeting days.
 */
export type CourseMode = "in-person" | "online" | "hybrid" | "zoom";

export function inferCourseMode(opts: {
  location?: string | null;
  campus?: string | null;
  days?: string | null;
}): CourseMode {
  const loc = String(opts.location ?? "").toUpperCase();
  const campus = String(opts.campus ?? "").toUpperCase();
  const hasDays = Boolean(String(opts.days ?? "").trim());

  if (/HYBRID|HYBRD|HYBR\b/.test(campus) || /HYBRID|HYBRD/.test(loc)) return "hybrid";
  if (/ONLINE|WEB|INTERNET|REMOTE/.test(campus)) return "online";
  if (/ONLINE|WEB|INTERNET|REMOTE|DCONL|\bONL\b|^ONL/.test(loc)) return "online";
  // Async section: no room, no scheduled days → treat as online.
  if (!hasDays && (loc === "" || /TBA|ARR|^$/.test(loc))) return "online";
  return "in-person";
}

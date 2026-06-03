// Builds the "compare colleges" matrix rows for a single course — one row per
// college that offers it, with honest, comparable, sortable fields. Pure (no
// DOM / React) so it's unit-tested in isolation. Seats go through lib/seats so
// negatives/sentinels/flag states never become fabricated counts.

import type { CourseSection } from "@/lib/types";
import { aggregateSeats } from "@/lib/seats";
import { parseTimeToMinutes } from "@/lib/time-utils";

// Day expansion matching the course page's detail table ("MW" → "Mon Wed"), so
// the matrix and the per-college section list below it read the same.
const DAY_MAP: Record<string, string> = {
  M: "Mon", Tu: "Tue", W: "Wed", Th: "Thu", F: "Fri", Sa: "Sat", Su: "Sun",
  TH: "Thu", SU: "Sun", TU: "Tue", SA: "Sat",
};
function expandDays(days: string): string {
  if (!days || !days.trim()) return "";
  const cleaned = days.replace(/[,\s]+/g, "").trim();
  const out: string[] = [];
  let i = 0;
  while (i < cleaned.length) {
    const two = cleaned.substring(i, i + 2);
    if (i + 1 < cleaned.length && DAY_MAP[two]) { out.push(DAY_MAP[two]); i += 2; continue; }
    const one = cleaned[i];
    if (DAY_MAP[one]) out.push(DAY_MAP[one]);
    i++;
  }
  return out.join(" ");
}

export interface CollegeOfferingInput {
  slug: string;
  name: string;
  auditAllowed: boolean | null;
  sections: CourseSection[];
  modeBreakdown: Record<string, number>;
}

export interface CollegeCompareRow {
  slug: string;
  name: string;
  auditAllowed: boolean | null;
  sectionCount: number;
  /** Honest seat label: "12 seats open" (real counts) | "3 of 5 sections open"
   *  (flag states) | "—" (no data). */
  seatLabel: string;
  /** Sort key for availability: real open seats if known, else open sections. */
  availability: number;
  hasOpen: boolean;
  modes: Record<string, number>;
  /** Schedule of the earliest-starting section, e.g. "Mon Wed 9:00 AM–10:15 AM". */
  soonest: string;
  /** Sort key for "soonest" (ms epoch of earliest start date; Infinity if none). */
  soonestKey: number;
  hasOnline: boolean;
  hasEvening: boolean;
}

const EVENING_MIN = 17 * 60; // 5:00 PM

function isValidTime(t: string | null | undefined): boolean {
  return !!t && t !== "TBA" && t !== "0:00 AM" && t !== "0:00 PM";
}

function formatSchedule(s: CourseSection): string {
  const hasTime = isValidTime(s.start_time) && isValidTime(s.end_time);
  if (!s.days && !hasTime) return "Online / async";
  const days = s.days ? expandDays(s.days) : "";
  const time = hasTime ? `${s.start_time}–${s.end_time}` : "";
  return (days && time ? `${days} ${time}` : days || time) || "Online / async";
}

function startEpoch(date: string | null | undefined): number {
  if (!date) return Infinity;
  const t = Date.parse(date);
  return Number.isNaN(t) ? Infinity : t;
}

function isEvening(s: CourseSection): boolean {
  if (!isValidTime(s.start_time)) return false;
  const m = parseTimeToMinutes(s.start_time);
  return m >= EVENING_MIN;
}

export function buildCollegeCompareRows(
  colleges: CollegeOfferingInput[],
): CollegeCompareRow[] {
  return colleges.map((c) => {
    const agg = aggregateSeats(c.sections);
    const seatLabel =
      agg.openSeats != null
        ? `${agg.openSeats} ${agg.openSeats === 1 ? "seat" : "seats"} open`
        : agg.anyData
          ? `${agg.openSections} of ${agg.totalSections} ${agg.totalSections === 1 ? "section" : "sections"} open`
          : "—";

    // Earliest-starting section — prefer one with meeting days/times to show.
    const byDate = [...c.sections].sort(
      (a, b) => startEpoch(a.start_date) - startEpoch(b.start_date),
    );
    const earliest = byDate.find((s) => s.days) ?? byDate[0];

    return {
      slug: c.slug,
      name: c.name,
      auditAllowed: c.auditAllowed,
      sectionCount: c.sections.length,
      seatLabel,
      availability: agg.openSeats ?? agg.openSections,
      hasOpen: agg.openSections > 0,
      modes: c.modeBreakdown,
      soonest: earliest ? formatSchedule(earliest) : "—",
      soonestKey: earliest ? startEpoch(earliest.start_date) : Infinity,
      hasOnline: c.sections.some((s) => s.mode === "online" || s.mode === "zoom"),
      hasEvening: c.sections.some(isEvening),
    };
  });
}

export type CompareSort = "availability" | "soonest" | "sections" | "name";

/** Sort + filter rows for the matrix (pure; client applies on user input). */
export function applyCompare(
  rows: CollegeCompareRow[],
  opts: { sort: CompareSort; openOnly?: boolean; onlineOnly?: boolean; eveningOnly?: boolean },
): CollegeCompareRow[] {
  let out = rows;
  if (opts.openOnly) out = out.filter((r) => r.hasOpen);
  if (opts.onlineOnly) out = out.filter((r) => r.hasOnline);
  if (opts.eveningOnly) out = out.filter((r) => r.hasEvening);
  const sorted = [...out];
  switch (opts.sort) {
    case "availability":
      sorted.sort((a, b) => b.availability - a.availability || a.name.localeCompare(b.name));
      break;
    case "soonest":
      sorted.sort((a, b) => a.soonestKey - b.soonestKey || a.name.localeCompare(b.name));
      break;
    case "sections":
      sorted.sort((a, b) => b.sectionCount - a.sectionCount || a.name.localeCompare(b.name));
      break;
    case "name":
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
  }
  return sorted;
}

/**
 * Compute summary statistics for a college's course offerings in a single
 * term — mode breakdown, start-date diversity, top subject prefixes. Used
 * by the per-college landing page to render a "Course Offering Profile"
 * section that gives the page substantive unique content beyond the
 * standard course catalog.
 *
 * The input is a CourseSection[] already loaded by the page (the `union`
 * across terms or a single term), so this is a pure transform — no I/O.
 */
import type { CourseSection } from "@/lib/types";

export type ModeBreakdown = {
  total: number;
  modes: Record<string, number>;
  modePcts: Record<string, number>;
};

export type CollegeOfferingProfile = {
  total: number;
  modes: ModeBreakdown;
  distinctStartDates: number;
  earliestStartDate: string | null;
  latestStartDate: string | null;
  /**
   * Sections starting more than 14 days after the term's earliest start
   * date — a heuristic for "late-start" availability without needing the
   * canonical fall/spring start-date table. If the earliest date is
   * 2026-08-31 and a section starts on 2026-10-15, it counts as
   * late-start (45 days after).
   */
  lateStartCount: number;
  topSubjects: Array<{ prefix: string; sections: number }>;
};

export function computeOfferingProfile(
  sections: CourseSection[]
): CollegeOfferingProfile | null {
  if (sections.length === 0) return null;

  // Mode breakdown — only count sections with a known mode field. The
  // schema constrains this to in-person | online | hybrid | zoom, but
  // be defensive about empty/unknown values.
  const modes: Record<string, number> = {};
  for (const s of sections) {
    const m = s.mode || "unknown";
    modes[m] = (modes[m] || 0) + 1;
  }
  const modePcts: Record<string, number> = {};
  for (const k of Object.keys(modes)) {
    modePcts[k] = (modes[k] / sections.length) * 100;
  }

  // Start-date diversity. Filter out null/empty start_date values; some
  // scrapers emit empty strings for TBA sections.
  const startDates = sections
    .map((s) => s.start_date)
    .filter((d): d is string => Boolean(d) && d.length === 10);
  const distinctDates = new Set(startDates);

  let earliestStartDate: string | null = null;
  let latestStartDate: string | null = null;
  let lateStartCount = 0;

  if (distinctDates.size > 0) {
    const sorted = [...distinctDates].sort();
    earliestStartDate = sorted[0];
    latestStartDate = sorted[sorted.length - 1];

    // Late-start: section starts > 14 days after the earliest.
    const earliestMs = new Date(earliestStartDate).getTime();
    const cutoffMs = earliestMs + 14 * 86400_000;
    for (const d of startDates) {
      const ms = new Date(d).getTime();
      if (ms > cutoffMs) lateStartCount++;
    }
  }

  // Top subject prefixes by section count.
  const subjects: Record<string, number> = {};
  for (const s of sections) {
    if (!s.course_prefix) continue;
    subjects[s.course_prefix] = (subjects[s.course_prefix] || 0) + 1;
  }
  const topSubjects = Object.entries(subjects)
    .map(([prefix, count]) => ({ prefix, sections: count }))
    .sort((a, b) => b.sections - a.sections)
    .slice(0, 5);

  return {
    total: sections.length,
    modes: { total: sections.length, modes, modePcts },
    distinctStartDates: distinctDates.size,
    earliestStartDate,
    latestStartDate,
    lateStartCount,
    topSubjects,
  };
}

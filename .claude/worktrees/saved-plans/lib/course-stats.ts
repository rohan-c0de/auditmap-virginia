/**
 * Compute summary statistics for a single course's sections in a single
 * term — mode breakdown, start-date diversity, time-of-day distribution,
 * instructor count. Used by /[state]/course/[code] to render a server-
 * rendered "Course Availability Profile" section that gives every course
 * landing page substantive unique content per term.
 *
 * Pure transform — no I/O. Mirrors the structure of lib/college-stats.ts
 * but optimized for the per-course rather than per-college view.
 */
import type { CourseSection } from "@/lib/types";

export type CourseAvailabilityProfile = {
  totalSections: number;
  collegeCount: number;
  modes: {
    counts: Record<string, number>;
    pcts: Record<string, number>;
  };
  startDates: {
    distinct: number;
    earliest: string | null;
    latest: string | null;
    lateStartCount: number;
  };
  timeOfDay: {
    morning: number; // before 12:00
    afternoon: number; // 12:00-16:59
    evening: number; // 17:00+
    asynchronous: number; // no start_time / TBA
  };
  instructorCount: number;
};

function normalizeTimeBucket(
  startTime: string | null | undefined
): "morning" | "afternoon" | "evening" | "asynchronous" {
  if (!startTime) return "asynchronous";
  const trimmed = startTime.trim().toUpperCase();
  if (!trimmed || trimmed === "TBA" || trimmed === "ARR") return "asynchronous";

  // Accept either "09:30 AM" / "9:30 AM" / "09:30" / "0930" / "9:30PM"
  const ampmMatch = trimmed.match(/^(\d{1,2}):?(\d{2})\s*(AM|PM)?$/);
  if (!ampmMatch) return "asynchronous";

  let hour = parseInt(ampmMatch[1], 10);
  const ampm = ampmMatch[3];
  if (ampm === "PM" && hour < 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  if (Number.isNaN(hour) || hour < 0 || hour > 23) return "asynchronous";

  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

export function computeCourseAvailabilityProfile(
  sections: CourseSection[]
): CourseAvailabilityProfile | null {
  if (sections.length === 0) return null;

  const collegeSlugs = new Set<string>();
  for (const s of sections) collegeSlugs.add(s.college_code);

  // Mode breakdown.
  const counts: Record<string, number> = {};
  for (const s of sections) {
    const m = s.mode || "unknown";
    counts[m] = (counts[m] || 0) + 1;
  }
  const pcts: Record<string, number> = {};
  for (const k of Object.keys(counts)) {
    pcts[k] = (counts[k] / sections.length) * 100;
  }

  // Start-date diversity.
  const startDates = sections
    .map((s) => s.start_date)
    .filter((d): d is string => Boolean(d) && d.length === 10);
  const distinctDates = new Set(startDates);
  let earliest: string | null = null;
  let latest: string | null = null;
  let lateStartCount = 0;
  if (distinctDates.size > 0) {
    const sorted = [...distinctDates].sort();
    earliest = sorted[0];
    latest = sorted[sorted.length - 1];
    const cutoffMs = new Date(earliest).getTime() + 14 * 86400_000;
    for (const d of startDates) {
      if (new Date(d).getTime() > cutoffMs) lateStartCount++;
    }
  }

  // Time-of-day buckets.
  const timeOfDay = {
    morning: 0,
    afternoon: 0,
    evening: 0,
    asynchronous: 0,
  };
  for (const s of sections) {
    const bucket = normalizeTimeBucket(s.start_time);
    timeOfDay[bucket]++;
  }

  // Instructor diversity. Treat null/empty/"To be Announced" as no
  // distinct instructor (don't inflate the count with a placeholder).
  const instructors = new Set<string>();
  for (const s of sections) {
    const i = (s.instructor || "").trim();
    if (!i) continue;
    if (/^to be announced$/i.test(i)) continue;
    if (/^tba$/i.test(i)) continue;
    if (/^staff$/i.test(i)) continue;
    instructors.add(i.toLowerCase());
  }

  return {
    totalSections: sections.length,
    collegeCount: collegeSlugs.size,
    modes: { counts, pcts },
    startDates: {
      distinct: distinctDates.size,
      earliest,
      latest,
      lateStartCount,
    },
    timeOfDay,
    instructorCount: instructors.size,
  };
}

/**
 * Course status utilities — classifies sections as in-progress, starting-soon,
 * or upcoming based on their start_date relative to today.
 */

export type CourseStatus = "in-progress" | "starting-soon" | "upcoming";

const SOON_THRESHOLD_DAYS = 14;

/** Get today's date as YYYY-MM-DD string in US Eastern Time. */
function todayStr(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** Days from today until startDate. Negative = already started. */
export function daysUntilStart(startDate: string): number {
  const today = new Date(todayStr() + "T00:00:00Z");
  const start = new Date(startDate + "T00:00:00Z");
  return Math.round((start.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

/** Classify a section based on its start_date. */
export function getCourseStatus(startDate: string): CourseStatus {
  if (!startDate) return "in-progress"; // No date → assume already running
  const days = daysUntilStart(startDate);
  if (days < 0) return "in-progress";
  if (days <= SOON_THRESHOLD_DAYS) return "starting-soon";
  return "upcoming";
}

/** Human-readable label for the start date. */
export function formatStartInfo(startDate: string): string {
  if (!startDate) return "Date TBA";

  const days = daysUntilStart(startDate);
  const date = new Date(startDate + "T00:00:00Z");
  const monthDay = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  if (days < -1) return `Started ${monthDay}`;
  if (days === -1) return "Started yesterday";
  if (days === 0) return "Starts today";
  if (days === 1) return "Starts tomorrow";
  if (days <= SOON_THRESHOLD_DAYS) return `Starts ${monthDay} (in ${days} days)`;
  return `Starts ${monthDay}`;
}

/** Check whether a section has already started. */
export function isInProgress(startDate: string): boolean {
  return getCourseStatus(startDate) === "in-progress";
}

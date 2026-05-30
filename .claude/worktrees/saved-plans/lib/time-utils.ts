/**
 * Shared time parsing and formatting utilities.
 * Used by ScheduleBuilder, WeeklyCalendar, and the schedule algorithm.
 */

// Time grid constants
export const START_HOUR = 8;
export const END_HOUR = 21;
export const SLOT_COUNT = (END_HOUR - START_HOUR) * 2; // 26 half-hour slots

export const DAY_COLS = [
  { key: "M", label: "Mon" },
  { key: "Tu", label: "Tue" },
  { key: "W", label: "Wed" },
  { key: "Th", label: "Thu" },
  { key: "F", label: "Fri" },
  { key: "Sa", label: "Sat" },
] as const;

// Day bitmask encoding for fast conflict detection
export const DAY_BITS: Record<string, number> = {
  M: 1,
  Tu: 2,
  W: 4,
  Th: 8,
  F: 16,
  Sa: 32,
};

/**
 * Parse a time string like "9:30 AM" into a decimal hour (9.5).
 * Returns null for TBA or invalid times.
 */
export function parseTime(timeStr: string): number | null {
  if (!timeStr || timeStr === "TBA") return null;
  const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3].toUpperCase();
  if (hours === 0 && minutes === 0) return null; // "0:00 AM" / "0:00 PM"
  if (period === "PM" && hours !== 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;
  return hours + minutes / 60;
}

/**
 * Parse a time string into total minutes since midnight.
 * Returns -1 for TBA or invalid times.
 */
export function parseTimeToMinutes(timeStr: string): number {
  const decimal = parseTime(timeStr);
  if (decimal === null) return -1;
  return Math.round(decimal * 60);
}

/**
 * Convert a decimal hour to a half-hour slot index in the grid.
 */
export function timeToSlot(time: number): number {
  return Math.round((time - START_HOUR) * 2);
}

/**
 * Format an hour number for display (e.g. 13 → "1", 8 → "8").
 */
export function formatHour(hour: number): string {
  if (hour === 0 || hour === 12) return "12";
  return String(hour > 12 ? hour - 12 : hour);
}

/**
 * Convert compact day codes like "MTuWThF" to spaced "M Tu W Th F".
 * Splits concatenated short codes into readable spaced form.
 */
export function expandDays(compact: string): string {
  // Already spaced (e.g. "M W F") — return as-is
  if (compact.includes(" ")) return compact;
  // Extract 2-char codes first (Th, Tu, Sa, Su), then single-char (M, W, F)
  const tokens: string[] = [];
  let i = 0;
  while (i < compact.length) {
    if (i + 1 < compact.length) {
      const two = compact.substring(i, i + 2);
      if (two === "Th" || two === "Tu" || two === "Sa" || two === "Su") {
        tokens.push(two);
        i += 2;
        continue;
      }
    }
    tokens.push(compact[i]);
    i++;
  }
  return tokens.join(" ");
}

/**
 * Check if a time string is valid (not TBA, not "0:00 AM").
 */
export function isValidTime(t: string): boolean {
  return !!t && t !== "TBA" && t !== "0:00 AM" && t !== "0:00 PM";
}

/**
 * Compute the day bitmask for a day string like "M W F" or compact "MWF" / "TuTh".
 */
export function daysToBitmask(days: string): number {
  if (!days) return 0;
  let mask = 0;
  for (const d of expandDays(days).split(" ")) {
    mask |= DAY_BITS[d] || 0;
  }
  return mask;
}

/**
 * Color palette for course blocks in the calendar.
 */
export const COURSE_COLORS = [
  { bg: "bg-teal-100", border: "border-teal-300", text: "text-teal-900" },
  { bg: "bg-blue-100", border: "border-blue-300", text: "text-blue-900" },
  { bg: "bg-amber-100", border: "border-amber-300", text: "text-amber-900" },
  { bg: "bg-purple-100", border: "border-purple-300", text: "text-purple-900" },
  { bg: "bg-rose-100", border: "border-rose-300", text: "text-rose-900" },
  { bg: "bg-emerald-100", border: "border-emerald-300", text: "text-emerald-900" },
  { bg: "bg-orange-100", border: "border-orange-300", text: "text-orange-900" },
  { bg: "bg-indigo-100", border: "border-indigo-300", text: "text-indigo-900" },
] as const;

/**
 * term-freeze.ts — issue #173.
 *
 * Once a term has been running for 3+ weeks, drop-add has closed at every
 * system in scope and the on-disk section data is the final record.
 * Re-scraping it produces nothing new, burns runner minutes, and adds
 * load to college SIS servers. This helper detects that state by reading
 * the on-disk JSON for `(state, slug, termCode)` and checking the earliest
 * `start_date` across its sections.
 *
 * Returns false (don't freeze) on any of:
 *   - file doesn't exist (first-time scrape — we have nothing yet)
 *   - file is empty / unparseable
 *   - no section has a non-empty `start_date` (bad data shouldn't pin a
 *     term forever; default to scrape)
 *
 * Returns true only when we have data and `min(start_date) + 21 days`
 * is strictly before today (UTC).
 */

import * as fs from "fs";
import * as path from "path";

const FREEZE_DAYS = 21;

interface SectionLike {
  start_date?: string;
}

/**
 * Look up the on-disk file for this (state, slug, termCode) and decide
 * whether the term is "frozen" (started 3+ weeks ago). Sanitizes path
 * separators in `termCode` the same way scrapers do at write time, so
 * a Passaic-style "26/FA" code maps to "data/nj/courses/passaic/26-FA.json".
 */
export function isFrozen(state: string, slug: string, termCode: string): boolean {
  const fileTermCode = termCode.replace(/[\\/]/g, "-");
  const filePath = path.join(
    process.cwd(), "data", state, "courses", slug, `${fileTermCode}.json`
  );
  if (!fs.existsSync(filePath)) return false;

  let sections: SectionLike[];
  try {
    sections = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return false;
  }
  if (!Array.isArray(sections) || sections.length === 0) return false;

  const startDates = sections
    .map((s) => s.start_date)
    .filter((d): d is string => typeof d === "string" && d.length > 0)
    .sort();
  if (startDates.length === 0) return false;

  const earliest = new Date(startDates[0]);
  if (Number.isNaN(earliest.getTime())) return false;

  const freezeAfter = new Date(earliest);
  freezeAfter.setUTCDate(freezeAfter.getUTCDate() + FREEZE_DAYS);
  return freezeAfter.getTime() < Date.now();
}

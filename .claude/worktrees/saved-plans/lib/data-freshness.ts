/**
 * Resolve the most-recent modification date for data files backing a page.
 *
 * Used by programmatic pages to:
 *  1. Show a visible "Last updated" line (user trust / freshness signal)
 *  2. Populate `dateModified` in JSON-LD
 *  3. Supply accurate `lastModified` to sitemap partitions
 *
 * All functions return `Date | null`; callers should gracefully degrade
 * when null (data files missing or unreadable).
 */

import fs from "node:fs";
import path from "node:path";

const DATA_ROOT = path.join(process.cwd(), "data");

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

/** Return the mtime of a single file, or null if it doesn't exist. */
function fileMtime(filePath: string): Date | null {
  try {
    return fs.statSync(filePath).mtime;
  } catch {
    return null;
  }
}

/** Return the most recent mtime across an array of files. */
function latestMtime(filePaths: string[]): Date | null {
  let latest: Date | null = null;
  for (const fp of filePaths) {
    const mt = fileMtime(fp);
    if (mt && (!latest || mt > latest)) latest = mt;
  }
  return latest;
}

// -------------------------------------------------------------------------
// Per-page helpers
// -------------------------------------------------------------------------

/**
 * Per-college page: latest mtime across all term JSON files for this college.
 */
export function getCollegeLastUpdated(
  state: string,
  collegeSlug: string
): Date | null {
  const dir = path.join(DATA_ROOT, state, "courses", collegeSlug);
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    return latestMtime(files.map((f) => path.join(dir, f)));
  } catch {
    return null;
  }
}

/**
 * Per-course page: latest mtime across all term files that could contain this
 * course for any college in the state.
 *
 * Scanning every college directory would be expensive, so we use the state-
 * level courses directory mtime as a proxy — still accurate because the
 * scraper rewrites term files atomically.
 */
export function getCourseLastUpdated(state: string): Date | null {
  const dir = path.join(DATA_ROOT, state, "courses");
  try {
    // Walk one level (college dirs) and take the latest mtime of any term file
    const collegeDirs = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory());
    const allTermFiles: string[] = [];
    for (const cd of collegeDirs) {
      const collegePath = path.join(dir, cd.name);
      const files = fs
        .readdirSync(collegePath)
        .filter((f) => f.endsWith(".json"));
      allTermFiles.push(...files.map((f) => path.join(collegePath, f)));
    }
    return latestMtime(allTermFiles);
  } catch {
    return null;
  }
}

/**
 * Per-program page: mtime of the programs directory for this state.
 */
export function getProgramLastUpdated(
  state: string,
  collegeSlug?: string
): Date | null {
  const dir = path.join(DATA_ROOT, state, "programs");
  try {
    if (collegeSlug) {
      const file = path.join(dir, `${collegeSlug}.json`);
      return fileMtime(file);
    }
    // All programs across state — latest file
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    return latestMtime(files.map((f) => path.join(dir, f)));
  } catch {
    return null;
  }
}

/**
 * Per-subject page: same as course data (subjects are derived from courses).
 */
export const getSubjectLastUpdated = getCourseLastUpdated;

/**
 * Transfer data: mtime of the transfer-equiv.json for this state.
 */
export function getTransferLastUpdated(state: string): Date | null {
  return fileMtime(path.join(DATA_ROOT, state, "transfer-equiv.json"));
}

// -------------------------------------------------------------------------
// Formatting
// -------------------------------------------------------------------------

/**
 * Format a Date for user-visible display.
 * - Within 7 days: "Updated 2 days ago"
 * - Older: "Last updated: May 10, 2026"
 */
export function formatLastUpdated(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Updated today";
  if (diffDays === 1) return "Updated yesterday";
  if (diffDays < 7) return `Updated ${diffDays} days ago`;

  return `Last updated: ${date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })}`;
}

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
 *
 * Implementation note: this module used to call `fs.readdirSync` /
 * `fs.statSync` with dynamic `path.join("data", state, "courses", slug)`
 * arguments. Next's bundler tracer could not narrow those dynamic paths
 * and conservatively pulled the entire `data/` tree (~1.5 GB) into every
 * function that transitively imported the module, blowing past Vercel's
 * 250 MB serverless function cap (the previous `outputFileTracingExcludes`
 * workaround stopped holding in Next 16, which warns the pattern is
 * "overly broad"). All freshness lookups now read from a small
 * `data/last-updated.json` manifest built by
 * `scripts/build-last-updated-snapshot.ts` at build time — a 57 KB file
 * with per-college/per-dataset ISO mtimes — so no runtime fs access is
 * needed.
 */

// Static JSON import — inlined at bundle time. Falls back to {} if the
// snapshot is missing (fresh checkout / test environment).
import snapshotJson from "../data/last-updated.json";

interface LastUpdatedSnapshot {
  courses: Record<string, Record<string, string>>;
  courses_state: Record<string, string>;
  programs: Record<string, Record<string, string>>;
  programs_state: Record<string, string>;
  transfers: Record<string, string>;
}

const SNAPSHOT: LastUpdatedSnapshot = (snapshotJson as unknown as LastUpdatedSnapshot) ?? {
  courses: {},
  courses_state: {},
  programs: {},
  programs_state: {},
  transfers: {},
};

function parseIso(s: string | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Per-college page: latest mtime across all term JSON files for this college.
 */
export function getCollegeLastUpdated(
  state: string,
  collegeSlug: string,
): Date | null {
  return parseIso(SNAPSHOT.courses?.[state]?.[collegeSlug]);
}

/**
 * Per-course page: state-level max mtime across every college's term files.
 */
export function getCourseLastUpdated(state: string): Date | null {
  return parseIso(SNAPSHOT.courses_state?.[state]);
}

/**
 * Per-program page: mtime for one college's programs file, or the state-level
 * max across all colleges when no slug is given.
 */
export function getProgramLastUpdated(
  state: string,
  collegeSlug?: string,
): Date | null {
  if (collegeSlug) return parseIso(SNAPSHOT.programs?.[state]?.[collegeSlug]);
  return parseIso(SNAPSHOT.programs_state?.[state]);
}

/**
 * Per-subject page: same as course data (subjects are derived from courses).
 */
export const getSubjectLastUpdated = getCourseLastUpdated;

/**
 * Transfer data: mtime of the transfer-equiv.json for this state.
 */
export function getTransferLastUpdated(state: string): Date | null {
  return parseIso(SNAPSHOT.transfers?.[state]);
}

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

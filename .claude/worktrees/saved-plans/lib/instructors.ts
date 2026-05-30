/**
 * Instructor entity resolution and indexing.
 *
 * Derives instructor profiles from the free-text `instructor` column in the
 * courses table. No DB schema changes needed — everything is computed from
 * the existing course section data via loadCoursesForCollege (already cached).
 */

import type { CourseSection } from "./types";
import { loadCoursesForCollege } from "./courses";
import { loadInstitutions } from "./institutions";
import { getCurrentTerm } from "./terms";

// ---------------------------------------------------------------------------
// In-memory cache (matches lib/courses.ts pattern)
// ---------------------------------------------------------------------------

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface CacheEntry<T> {
  data: T;
  expires: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (entry && entry.expires > Date.now()) return entry.data;

  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const promise = fn()
    .then((data) => {
      cache.set(key, { data, expires: Date.now() + CACHE_TTL });
      inflight.delete(key);
      return data;
    })
    .catch((err) => {
      inflight.delete(key);
      throw err;
    });

  inflight.set(key, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InstructorProfile {
  slug: string;
  displayName: string;
  rawNames: Set<string>;
  sections: CourseSection[];
}

/** Serializable version for sitemap/index use */
export interface InstructorEntry {
  slug: string;
  displayName: string;
  sectionCount: number;
}

// ---------------------------------------------------------------------------
// Name normalization
// ---------------------------------------------------------------------------

/** Names to skip — not real instructor identities */
const SKIP_NAMES = new Set([
  "staff",
  "tba",
  "tbd",
  "instructor",
  "adjunct",
  "unknown",
  "none",
  "",
]);

/** Suffixes to preserve but move to end of slug */
const SUFFIXES = new Set([
  "jr",
  "sr",
  "ii",
  "iii",
  "iv",
  "v",
  "phd",
  "md",
  "esq",
]);

/**
 * Normalize a raw instructor name string into a URL-safe slug.
 *
 * "Smith, Jane A" → "jane-smith"
 * "JOHNSON III, ROBERT" → "robert-johnson-iii"
 * "De La Cruz, Maria" → "maria-de-la-cruz"
 */
export function normalizeInstructorSlug(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  let first = "";
  let last = "";
  let suffix = "";

  if (trimmed.includes(",")) {
    // "Last, First Middle" or "Last Suffix, First"
    const [lastPart, ...rest] = trimmed.split(",").map((s) => s.trim());
    const firstPart = rest.join(" ").trim();

    // Extract suffix from last part: "Johnson III" → last="Johnson", suffix="III"
    const lastTokens = lastPart.split(/\s+/);
    const lastFiltered: string[] = [];
    for (const token of lastTokens) {
      if (SUFFIXES.has(token.toLowerCase())) {
        suffix = token.toLowerCase();
      } else {
        lastFiltered.push(token);
      }
    }
    last = lastFiltered.join(" ");

    // Extract suffix from first part too, and strip middle initials
    const firstTokens = firstPart.split(/\s+/);
    const firstFiltered: string[] = [];
    for (const token of firstTokens) {
      if (SUFFIXES.has(token.toLowerCase())) {
        suffix = token.toLowerCase();
      } else if (token.length <= 1 || (token.length === 2 && token.endsWith("."))) {
        // Skip single-letter middle initials like "A" or "A."
        continue;
      } else {
        firstFiltered.push(token);
      }
    }
    first = firstFiltered.join(" ");
  } else {
    // "Jane Smith" or "Jane A Smith"
    const tokens = trimmed.split(/\s+/);
    const filtered: string[] = [];
    for (const token of tokens) {
      if (SUFFIXES.has(token.toLowerCase())) {
        suffix = token.toLowerCase();
      } else if (token.length <= 1 || (token.length === 2 && token.endsWith("."))) {
        continue;
      } else {
        filtered.push(token);
      }
    }
    if (filtered.length >= 2) {
      first = filtered.slice(0, -1).join(" ");
      last = filtered[filtered.length - 1];
    } else if (filtered.length === 1) {
      first = filtered[0];
    }
  }

  // Build slug: first-last-suffix
  const parts = [first, last, suffix].filter(Boolean);
  return parts
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Produce a display name from a raw instructor string.
 *
 * "Smith, Jane A" → "Jane Smith"
 * "JOHNSON III, ROBERT" → "Robert Johnson III"
 * If not comma-separated, return as-is with title case.
 */
export function displayName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  function titleCase(s: string): string {
    return s
      .toLowerCase()
      .split(/\s+/)
      .map((w) => {
        // Preserve common short words in names, but capitalize first letter
        if (w.length === 0) return w;
        return w[0].toUpperCase() + w.slice(1);
      })
      .join(" ");
  }

  if (trimmed.includes(",")) {
    const [lastPart, ...rest] = trimmed.split(",").map((s) => s.trim());
    const firstPart = rest.join(" ").trim();

    // Extract suffix from last
    const lastTokens = lastPart.split(/\s+/);
    const lastFiltered: string[] = [];
    let suffix = "";
    for (const token of lastTokens) {
      if (SUFFIXES.has(token.toLowerCase())) {
        suffix = token.toUpperCase();
        // Keep roman numerals uppercase, lowercase others
        if (!["II", "III", "IV", "V"].includes(suffix)) {
          suffix = titleCase(token);
        }
      } else {
        lastFiltered.push(token);
      }
    }

    // Strip middle initials from first
    const firstTokens = firstPart.split(/\s+/);
    const firstFiltered: string[] = [];
    for (const token of firstTokens) {
      if (SUFFIXES.has(token.toLowerCase())) {
        suffix = token.toUpperCase();
        if (!["II", "III", "IV", "V"].includes(suffix)) {
          suffix = titleCase(token);
        }
      } else if (token.length <= 1 || (token.length === 2 && token.endsWith("."))) {
        continue;
      } else {
        firstFiltered.push(token);
      }
    }

    const first = titleCase(firstFiltered.join(" "));
    const last = titleCase(lastFiltered.join(" "));
    return [first, last, suffix].filter(Boolean).join(" ");
  }

  return titleCase(trimmed);
}

/**
 * Split multi-instructor strings into individual names.
 *
 * "Smith, J / Johnson, R" → ["Smith, J", "Johnson, R"]
 * "Staff" → []
 * null → []
 */
export function splitMultiInstructor(raw: string | null): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];

  // Split on common delimiters for team-teaching
  const parts = trimmed.split(/\s*[\/|;]\s*/);

  return parts.filter((name) => {
    const lower = name.trim().toLowerCase();
    return !SKIP_NAMES.has(lower) && name.trim().length > 0;
  });
}

/**
 * Check if a name is valid for an instructor page.
 * Must have at least a first name with length ≥ 2.
 */
function isValidInstructorName(raw: string): boolean {
  const trimmed = raw.trim();
  if (SKIP_NAMES.has(trimmed.toLowerCase())) return false;

  // Must have more than one word (or comma-separated with 2+ char first name)
  if (trimmed.includes(",")) {
    const [, ...rest] = trimmed.split(",").map((s) => s.trim());
    const firstPart = rest.join(" ").trim();
    // First name tokens (excluding initials)
    const firstTokens = firstPart.split(/\s+/).filter(
      (t) => t.length > 1 && !t.endsWith(".") && !SUFFIXES.has(t.toLowerCase())
    );
    return firstTokens.length >= 1 && firstTokens[0].length >= 2;
  }

  // Space-separated: need at least 2 non-initial tokens
  const tokens = trimmed.split(/\s+/).filter(
    (t) => t.length > 1 && !SUFFIXES.has(t.toLowerCase())
  );
  return tokens.length >= 2;
}

// ---------------------------------------------------------------------------
// Index building
// ---------------------------------------------------------------------------

/**
 * Given a college's course sections, build an instructor index.
 * Returns Map<slug, InstructorProfile>.
 *
 * - Splits multi-instructor fields
 * - Skips Staff/TBA/null/single-word names
 * - Merges different raw strings that produce the same slug
 * - Only includes instructors with ≥2 sections
 */
export function buildInstructorIndex(
  sections: CourseSection[]
): Map<string, InstructorProfile> {
  const map = new Map<
    string,
    { rawNames: Set<string>; sections: CourseSection[] }
  >();

  for (const section of sections) {
    const names = splitMultiInstructor(section.instructor);
    for (const name of names) {
      if (!isValidInstructorName(name)) continue;

      const slug = normalizeInstructorSlug(name);
      if (!slug) continue;

      if (!map.has(slug)) {
        map.set(slug, { rawNames: new Set(), sections: [] });
      }
      const entry = map.get(slug)!;
      entry.rawNames.add(name);
      entry.sections.push(section);
    }
  }

  // Build final profiles, filtering to ≥2 sections
  const result = new Map<string, InstructorProfile>();
  for (const [slug, data] of map) {
    if (data.sections.length < 2) continue;

    // Pick the best display name (longest raw name = most complete)
    const bestRaw = Array.from(data.rawNames).sort(
      (a, b) => b.length - a.length
    )[0];

    result.set(slug, {
      slug,
      displayName: displayName(bestRaw),
      rawNames: data.rawNames,
      sections: data.sections,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Data access (wraps loadCoursesForCollege — no extra Supabase calls)
// ---------------------------------------------------------------------------

/**
 * Get the instructor index for a college, reusing the loadCoursesForCollege cache.
 */
export async function getInstructorIndex(
  collegeSlug: string,
  term: string,
  state: string
): Promise<Map<string, InstructorProfile>> {
  return cached(
    `instructorIndex:${state}:${collegeSlug}:${term}`,
    async () => {
      const courses = await loadCoursesForCollege(collegeSlug, term, state);
      return buildInstructorIndex(courses);
    }
  );
}

/**
 * Get a single instructor's profile by slug.
 * Returns null if not found or doesn't meet inclusion thresholds.
 */
export async function getInstructorBySlug(
  collegeSlug: string,
  term: string,
  state: string,
  slug: string
): Promise<InstructorProfile | null> {
  const index = await getInstructorIndex(collegeSlug, term, state);
  return index.get(slug) || null;
}

/**
 * Get top instructors for a college (by section count), for the college detail
 * page's "Browse Instructors" section.
 */
export async function getTopInstructors(
  collegeSlug: string,
  term: string,
  state: string,
  limit = 10
): Promise<InstructorEntry[]> {
  const index = await getInstructorIndex(collegeSlug, term, state);
  return Array.from(index.values())
    .sort((a, b) => b.sections.length - a.sections.length)
    .slice(0, limit)
    .map((p) => ({
      slug: p.slug,
      displayName: p.displayName,
      sectionCount: p.sections.length,
    }));
}

/**
 * Get sitemap data: returns array of { collegeId, slug } for all instructors
 * with ≥2 sections across all colleges in a state.
 */
export async function getInstructorSitemapEntries(
  term: string,
  state: string
): Promise<{ collegeId: string; slug: string }[]> {
  const institutions = loadInstitutions(state);
  const entries: { collegeId: string; slug: string }[] = [];

  for (const inst of institutions) {
    try {
      const index = await getInstructorIndex(inst.college_slug, term, state);
      for (const [slug] of index) {
        entries.push({ collegeId: inst.id, slug });
      }
    } catch {
      // Skip if loading fails for this college
    }
  }

  return entries;
}

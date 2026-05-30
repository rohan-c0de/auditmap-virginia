// Entity validators — the hallucination boundary.
//
// The LLM classifier may produce a course code or university slug that
// doesn't exist. These validators catch invented entities BEFORE the
// answer-lookup layer queries on them, so the failure mode is
// "did you mean...?" rather than "we couldn't find your course."

import { supabase } from "../../supabase";
import { getUniversities } from "../../transfer";

export interface CourseValidation {
  exists: boolean;
  // Best-known display title (when we found the course). Useful for the
  // UI to show "ENG 111: Composition I" instead of just "ENG 111".
  title?: string;
}

/**
 * Cheap existence check: does any row in the courses table for this state
 * have this prefix + number? Uses HEAD count to avoid pulling row data.
 *
 * Note: a course can exist in some terms and not others. This returns true
 * if it exists in ANY term — that's what the user means when they ask
 * about a course.
 */
export async function courseExists(
  state: string,
  prefix: string,
  number: string,
): Promise<CourseValidation> {
  const { data, error } = await supabase
    .from("courses")
    .select("course_title")
    .eq("state", state)
    .eq("course_prefix", prefix.toUpperCase())
    .eq("course_number", number)
    .limit(1);
  if (error || !data || data.length === 0) return { exists: false };
  return { exists: true, title: (data[0] as { course_title?: string }).course_title };
}

export interface UniversityResolution {
  resolved: { slug: string; name: string } | null;
  // Closest 3 alternatives by string similarity, sorted best-first.
  // Surfaced in the answer when resolution fails.
  suggestions: Array<{ slug: string; name: string }>;
}

/**
 * Resolve a user-provided university slug or name against the state's
 * transfer-equiv data. Strategy, in order:
 *   1. Exact slug match (case-insensitive)
 *   2. Normalized match (lowercase, alphanumeric only)
 *   3. Substring of display name (also normalized)
 *   4. None — return suggestions ranked by Jaccard similarity on tokens
 */
export async function resolveUniversity(
  state: string,
  slugOrName: string,
): Promise<UniversityResolution> {
  const universities = await getUniversities(state);
  if (universities.length === 0) {
    return { resolved: null, suggestions: [] };
  }
  const target = normalize(slugOrName);
  if (!target) {
    return { resolved: null, suggestions: universities.slice(0, 3) };
  }

  // Tier 1: exact slug match
  const exact = universities.find((u) => u.slug.toLowerCase() === slugOrName.toLowerCase());
  if (exact) return { resolved: exact, suggestions: [] };

  // Tier 2: normalized slug match
  const normalizedSlug = universities.find((u) => normalize(u.slug) === target);
  if (normalizedSlug) return { resolved: normalizedSlug, suggestions: [] };

  // Tier 3: substring of display name
  const byName = universities.find((u) => normalize(u.name).includes(target));
  if (byName) return { resolved: byName, suggestions: [] };

  // Tier 4: none — rank suggestions by token-Jaccard similarity.
  const ranked = [...universities]
    .map((u) => ({ u, score: jaccard(target, normalize(u.name)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((r) => r.u);

  return { resolved: null, suggestions: ranked };
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function jaccard(a: string, b: string): number {
  if (!a || !b) return 0;
  const setA = new Set(tokens(a));
  const setB = new Set(tokens(b));
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersect = 0;
  for (const t of setA) if (setB.has(t)) intersect++;
  return intersect / (setA.size + setB.size - intersect);
}

function tokens(s: string): string[] {
  // Treat each 3+ char run as a token. "umassamherst" → ["umassamherst"]
  // "umass amherst" → ["umass", "amherst"]
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
}

import fs from "fs";
import path from "path";
import type { TransferMapping } from "./types";
import { supabase } from "./supabase";

function dataPath(state = "va"): string {
  return path.join(process.cwd(), "data", state, "transfer-equiv.json");
}

// Module-level cache (keyed by state)
const transferCache: Record<string, TransferMapping[]> = {};

// Supabase default max rows per request is 1,000 — PAGE_SIZE must not
// exceed that or the pagination loop will exit early, loading only a
// partial dataset.
const PAGE_SIZE = 1000;

/**
 * Load all transfer mappings from Supabase (with local JSON fallback).
 * Cached after first load.
 */
export async function loadTransferMappings(
  state = "va"
): Promise<TransferMapping[]> {
  if (transferCache[state]) return transferCache[state];

  // Try Supabase first
  try {
    const allData: TransferMapping[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from("transfers")
        .select(
          "cc_prefix, cc_number, cc_course, cc_title, cc_credits, university, university_name, univ_course, univ_title, univ_credits, notes, no_credit, is_elective"
        )
        .eq("state", state)
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;

      allData.push(...(data as TransferMapping[]));
      hasMore = data.length === PAGE_SIZE;
      offset += PAGE_SIZE;
    }

    if (allData.length > 0) {
      transferCache[state] = allData;
      return allData;
    }
  } catch {
    // Supabase unavailable or table doesn't exist yet — fall through
  }

  // Fallback to local JSON file
  try {
    const raw = fs.readFileSync(dataPath(state), "utf-8");
    const data = JSON.parse(raw) as TransferMapping[];
    transferCache[state] = data;
    return data;
  } catch {
    return [];
  }
}

/** Get all transfer mappings for a specific community college course. */
export async function getTransferInfo(
  prefix: string,
  number: string,
  state = "va"
): Promise<TransferMapping[]> {
  const mappings = await loadTransferMappings(state);
  return mappings.filter(
    (m) => m.cc_prefix === prefix && m.cc_number === number
  );
}

/**
 * Get a short summary string for display, e.g.:
 *   "→ UNI: ENGL 1105"
 *   "→ UNI: BUS 1XXX (elective)"
 *   "✗ No UNI credit"
 *   null if no data
 */
export async function transferSummaryLine(
  prefix: string,
  number: string,
  state = "va"
): Promise<{ text: string; type: "direct" | "elective" | "no-credit" } | null> {
  const info = await getTransferInfo(prefix, number, state);
  if (info.length === 0) return null;

  // Use first mapping (usually one per course per university)
  const m = info[0];
  const uni = (m.university || "").toUpperCase();
  if (m.no_credit) {
    return { text: `No ${uni} credit`, type: "no-credit" };
  }
  if (m.is_elective) {
    return {
      text: `${uni}: ${m.univ_course} (elective)`,
      type: "elective",
    };
  }
  return {
    text: `${uni}: ${m.univ_course}`,
    type: "direct",
  };
}

/** Get all universities that accept a given course (excludes no-credit). */
export async function getAcceptingUniversities(
  prefix: string,
  number: string,
  state = "va"
): Promise<string[]> {
  const info = await getTransferInfo(prefix, number, state);
  return info.filter((m) => !m.no_credit).map((m) => m.university_name);
}

/** Get all mappings for a specific university. */
export async function getCoursesForUniversity(
  university: string,
  state = "va"
): Promise<TransferMapping[]> {
  const mappings = await loadTransferMappings(state);
  return mappings.filter((m) => m.university === university);
}

/** Get the list of all universities in the dataset. */
export async function getUniversities(
  state = "va"
): Promise<{ slug: string; name: string }[]> {
  const mappings = await loadTransferMappings(state);
  const seen = new Map<string, string>();
  for (const m of mappings) {
    if (!seen.has(m.university)) {
      seen.set(m.university, m.university_name);
    }
  }
  return Array.from(seen.entries()).map(([slug, name]) => ({ slug, name }));
}

/**
 * Get all universities with per-university mapping counts, excluding
 * combo-credit rows (univ_course containing "*") and counting direct,
 * elective, and no-credit separately.
 *
 * Used by the /[state]/transfer "Browse by university" list and by the
 * transfer-hub page's thin-content guard in generateStaticParams.
 */
export async function getUniversitiesWithCounts(state = "va"): Promise<
  {
    slug: string;
    name: string;
    directCount: number;
    electiveCount: number;
    totalCount: number; // direct + elective (i.e. "transferable" count)
  }[]
> {
  const mappings = await loadTransferMappings(state);
  const map = new Map<
    string,
    { name: string; directCount: number; electiveCount: number }
  >();

  for (const m of mappings) {
    if (m.univ_course && m.univ_course.includes("*")) continue;
    if (m.no_credit) continue; // hub page lists only transferable courses
    if (!map.has(m.university)) {
      map.set(m.university, {
        name: m.university_name,
        directCount: 0,
        electiveCount: 0,
      });
    }
    const entry = map.get(m.university)!;
    if (m.is_elective) entry.electiveCount++;
    else entry.directCount++;
  }

  return Array.from(map.entries())
    .map(([slug, v]) => ({
      slug,
      name: v.name,
      directCount: v.directCount,
      electiveCount: v.electiveCount,
      totalCount: v.directCount + v.electiveCount,
    }))
    .sort((a, b) => b.totalCount - a.totalCount);
}

/**
 * Build a lookup map for client-side filtering:
 * { "ENG-111": [{ university: "vt", type: "direct" }], ... }
 */
export async function buildTransferLookup(state = "va"): Promise<
  Record<
    string,
    {
      university: string;
      type: "direct" | "elective" | "no-credit";
      course: string;
    }[]
  >
> {
  const mappings = await loadTransferMappings(state);
  const lookup: Record<
    string,
    {
      university: string;
      type: "direct" | "elective" | "no-credit";
      course: string;
    }[]
  > = {};

  for (const m of mappings) {
    // Skip combo-credit entries (e.g. ODU's "**** ****") — they only
    // transfer when paired with other courses, not standalone.
    if (m.univ_course && m.univ_course.includes("*")) continue;

    const key = `${m.cc_prefix}-${m.cc_number}`;
    if (!lookup[key]) lookup[key] = [];
    lookup[key].push({
      university: m.university,
      type: m.no_credit ? "no-credit" : m.is_elective ? "elective" : "direct",
      course: m.univ_course || "",
    });
  }

  return lookup;
}

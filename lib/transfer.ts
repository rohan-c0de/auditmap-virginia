import fs from "fs";
import path from "path";
import type { TransferMapping } from "./types";

function dataPath(state = "va"): string {
  return path.join(process.cwd(), "data", state, "transfer-equiv.json");
}

// Module-level cache (keyed by state)
let cache: { state: string; data: TransferMapping[] } | null = null;

/** Load all transfer mappings from the JSON file. Cached after first load. */
export function loadTransferMappings(state = "va"): TransferMapping[] {
  if (cache && cache.state === state) return cache.data;
  try {
    const raw = fs.readFileSync(dataPath(state), "utf-8");
    const data = JSON.parse(raw) as TransferMapping[];
    cache = { state, data };
    return data;
  } catch {
    return [];
  }
}

/** Get all transfer mappings for a specific VCCS course. */
export function getTransferInfo(
  prefix: string,
  number: string,
  state = "va"
): TransferMapping[] {
  const mappings = loadTransferMappings(state);
  return mappings.filter(
    (m) => m.cc_prefix === prefix && m.cc_number === number
  );
}

/**
 * Get a short summary string for display, e.g.:
 *   "→ VT: ENGL 1105"
 *   "→ VT: BUS 1XXX (elective)"
 *   "✗ No VT credit"
 *   null if no data
 */
export function transferSummaryLine(
  prefix: string,
  number: string,
  state = "va"
): { text: string; type: "direct" | "elective" | "no-credit" } | null {
  const info = getTransferInfo(prefix, number, state);
  if (info.length === 0) return null;

  // Use first mapping (usually one per course per university)
  const m = info[0];
  if (m.no_credit) {
    return { text: `No VT credit`, type: "no-credit" };
  }
  if (m.is_elective) {
    return {
      text: `VT: ${m.univ_course} (elective)`,
      type: "elective",
    };
  }
  return {
    text: `VT: ${m.univ_course}`,
    type: "direct",
  };
}

/** Get all universities that accept a given VCCS course (excludes no-credit). */
export function getAcceptingUniversities(
  prefix: string,
  number: string,
  state = "va"
): string[] {
  const info = getTransferInfo(prefix, number, state);
  return info
    .filter((m) => !m.no_credit)
    .map((m) => m.university_name);
}

/** Get all mappings for a specific university. */
export function getCoursesForUniversity(
  university: string,
  state = "va"
): TransferMapping[] {
  const mappings = loadTransferMappings(state);
  return mappings.filter((m) => m.university === university);
}

/** Get the list of all universities in the dataset. */
export function getUniversities(state = "va"): { slug: string; name: string }[] {
  const mappings = loadTransferMappings(state);
  const seen = new Map<string, string>();
  for (const m of mappings) {
    if (!seen.has(m.university)) {
      seen.set(m.university, m.university_name);
    }
  }
  return Array.from(seen.entries()).map(([slug, name]) => ({ slug, name }));
}

/**
 * Build a lookup map for client-side filtering:
 * { "ENG-111": [{ university: "vt", type: "direct" }], ... }
 */
export function buildTransferLookup(state = "va"): Record<
  string,
  { university: string; type: "direct" | "elective" | "no-credit"; course: string }[]
> {
  const mappings = loadTransferMappings(state);
  const lookup: Record<
    string,
    { university: string; type: "direct" | "elective" | "no-credit"; course: string }[]
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

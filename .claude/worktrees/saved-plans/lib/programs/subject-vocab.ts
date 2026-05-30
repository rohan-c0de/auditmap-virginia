/**
 * subject-vocab.ts — runtime loader and helpers for
 * data/{state}/subject-vocab.json (built by scripts/build-subject-vocab.ts).
 *
 * The vocab files are produced offline; this module is the read-side that
 * powers the course-level pivot in the pathway answer ("no degree, but
 * here are N Geography courses across M colleges"). See the relatedSubjects
 * field on PathwayAnswer.
 */

import * as fs from "fs";
import * as path from "path";
import type { SubjectMatchSummary } from "../search-intent/answer/types";

interface SubjectEntry {
  prefix: string;
  name: string;
  course_count: number;
  section_count: number;
  colleges: string[];
  sample_titles: string[];
}

interface SubjectVocab {
  state: string;
  generated_at: string;
  subjects: SubjectEntry[];
  program_titles: string[];
}

const cache = new Map<string, SubjectVocab | null>();

/**
 * Load (and memoize) the subject-vocab JSON for a state. Returns null
 * when the file is missing — callers should treat that as "no signal"
 * rather than an error.
 */
export function loadSubjectVocab(state: string): SubjectVocab | null {
  if (cache.has(state)) return cache.get(state) ?? null;
  const file = path.join(
    process.cwd(),
    "data",
    state,
    "subject-vocab.json",
  );
  if (!fs.existsSync(file)) {
    cache.set(state, null);
    return null;
  }
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf-8")) as SubjectVocab;
    cache.set(state, data);
    return data;
  } catch {
    cache.set(state, null);
    return null;
  }
}

/**
 * Hydrate a list of subject prefixes (as returned by the Phase 3 LLM
 * resolver) into structured summaries that include the prefix's
 * human-readable name, course/section counts, and a deep link into
 * the state's course-search page filtered to that prefix.
 *
 * Filters out prefixes the vocab doesn't know about (defense against
 * an LLM that hallucinates a prefix). Preserves input order.
 */
export function summariseSubjectsByPrefix(
  state: string,
  prefixes: string[],
): SubjectMatchSummary[] {
  if (prefixes.length === 0) return [];
  const vocab = loadSubjectVocab(state);
  if (!vocab) return [];
  const byPrefix = new Map(vocab.subjects.map((s) => [s.prefix, s]));
  const out: SubjectMatchSummary[] = [];
  for (const raw of prefixes) {
    const prefix = raw.toUpperCase().trim();
    const entry = byPrefix.get(prefix);
    if (!entry) continue;
    out.push({
      prefix: entry.prefix,
      name: entry.name,
      course_count: entry.course_count,
      section_count: entry.section_count,
      college_count: entry.colleges.length,
      search_url: `/${state}/courses?q=${encodeURIComponent(entry.prefix)}`,
    });
  }
  return out;
}

/**
 * For tests — clears the in-process cache.
 */
export function _resetSubjectVocabCache(): void {
  cache.clear();
}

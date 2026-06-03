// Title → code resolution for the /ask answer card.
//
// A student types a course by NAME ("what's the prereq for Intermediate
// Arabic II?"). The classifier identifies the intent and the subject, but
// can't emit a course NUMBER. This module resolves the title to a code
// (ARA 202) so the answer layer can run its normal lookup.
//
// THE ONE INVARIANT: resolve only on a confident, unambiguous match;
// otherwise DEFER (return suggestions). A confidently-wrong prereq/transfer
// answer is worse than a "did you mean…?" clarification. Empirically this
// holds at 0 false-resolves across VA/NC/TX/CA real catalogs (~49k codes) —
// see __tests__/resolve-course.test.ts, which re-runs that battery in CI.
//
// Why the guards below exist (each maps to a real failure found on real data):
//   - numeral guard:  "Arabic II" must never resolve to "Arabic I" (ARA 201).
//   - honors guard:   "World Literature I Honors" ≠ the non-honors section.
//   - min-2-tokens:   a lone word ("calculus", "biology") never fuzzy-resolves.
//   - exact-unique:   an exact normalized-title match resolves ONLY if it maps
//                     to a single code; in multi-college states the same title
//                     ("Financial Accounting" → ACCT 101/201/301…) maps to many
//                     numbers, which must DEFER, not guess.
//
// This module is PURE — no Supabase, no fs, no env. The Supabase-backed
// wrapper that fetches a subject-scoped catalog lives in validate.ts
// (resolveCourse). Keeping the matcher pure is what lets the cross-state
// regression test exercise it directly against filesystem catalogs.

import type { CourseRef } from "../types";

/** One catalog row. Multiple rows may share a (prefix, number) when the title
 *  drifts across colleges/terms — the matcher aggregates all variants per code,
 *  which only helps recall (any real title for a code resolves to it). */
export interface CatalogCourse {
  prefix: string;
  number: string;
  title: string;
}

export interface CourseSuggestion {
  code: string; // "ARA 202"
  title: string; // best display title
}

export interface ResolveResult {
  resolved: CourseRef | null;
  suggestions: CourseSuggestion[];
  reason: "exact" | "exact-ambiguous" | "fuzzy" | "defer" | "empty";
}

// Fuzzy-tier thresholds. Tuned against the cross-state battery; loosening any
// of these re-introduces false-resolves, so the regression test pins them.
const J_MIN = 0.6; //      token-Jaccard between query and title
const COV_MIN = 0.85; //   fraction of query tokens present in the title
const MARGIN_MIN = 0.15; // Jaccard lead the winner needs over the next code

// Roman numerals → arabic, so "II" and "2" compare equal. Capped at 6 (course
// level sequences rarely exceed VI; higher roman-ish tokens are almost always
// real words).
const ROMAN: Record<string, string> = {
  i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6",
};

// Light synonym/abbreviation folding for the most common catalog shorthands.
// Conservative on purpose — every entry risks a collision, so only add ones
// that are unambiguous in a course-title context.
const SYN: Record<string, string> = {
  intro: "introduction",
  info: "information",
  lang: "language",
  amer: "american",
  prin: "principles",
  gen: "general",
  mgmt: "management",
  admin: "administration",
};

/**
 * Normalize a course title to a canonical token string:
 *   lowercase → "&"→"and" → collapse acronym dots (D.C.→dc) → strip remaining
 *   punctuation → split → roman→arabic → synonym fold.
 */
export function normalizeTitle(s: string): string {
  return titleTokens(s).join(" ");
}

export function titleTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    // Collapse dotted acronyms BEFORE stripping punctuation: "d.c." → "dc",
    // "u.s." → "us". A single letter followed by a dot, repeated.
    .replace(/\b(?:[a-z]\.){2,}/g, (m) => m.replace(/\./g, ""))
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => ROMAN[t] ?? SYN[t] ?? t);
}

/** The trailing standalone level numeral (1–6) in a token list, if any.
 *  "anatomy and physiology 2" → "2"; "english 101" → null (101 isn't 1–6). */
function numeralOf(toks: string[]): string | null {
  const nums = toks.filter((t) => /^[1-6]$/.test(t));
  return nums.length ? nums[nums.length - 1] : null;
}

function jaccard(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

interface CodeGroup {
  code: string;
  prefix: string;
  number: string;
  display: string; // longest title variant, for suggestion chips
  normTitles: Set<string>;
}

function groupByCode(catalog: CatalogCourse[]): CodeGroup[] {
  const byCode = new Map<string, CodeGroup>();
  for (const c of catalog) {
    if (!c.prefix || !c.number || !c.title) continue;
    const prefix = c.prefix.toUpperCase();
    const code = `${prefix} ${c.number}`;
    let rec = byCode.get(code);
    if (!rec) {
      rec = { code, prefix, number: c.number, display: c.title, normTitles: new Set() };
      byCode.set(code, rec);
    }
    rec.normTitles.add(normalizeTitle(c.title));
    if (c.title.length > rec.display.length) rec.display = c.title;
  }
  return [...byCode.values()];
}

function ref(g: CodeGroup): CourseRef {
  return { prefix: g.prefix, number: g.number };
}

function sugg(g: CodeGroup): CourseSuggestion {
  return { code: g.code, title: g.display };
}

/**
 * Match a free-text title against a catalog (already scoped to the relevant
 * subject by the caller). Pure and synchronous.
 *
 * Tiers:
 *   1. exact normalized-title match — resolve iff unique code, else suggest.
 *   2. numeral+honors-guarded fuzzy — resolve iff a clear single winner.
 *   3. otherwise — top-3 suggestions (safe deferral).
 */
export function matchTitle(catalog: CatalogCourse[], rawTitle: string): ResolveResult {
  const qToks = titleTokens(rawTitle);
  if (qToks.length === 0) return { resolved: null, suggestions: [], reason: "empty" };
  const qNorm = qToks.join(" ");
  const qNum = numeralOf(qToks);
  const qHonors = qToks.includes("honors");

  const codes = groupByCode(catalog);
  if (codes.length === 0) return { resolved: null, suggestions: [], reason: "empty" };

  // Tier 1 — exact normalized match.
  const exact = codes.filter((c) => c.normTitles.has(qNorm));
  if (exact.length === 1) return { resolved: ref(exact[0]), suggestions: [], reason: "exact" };
  if (exact.length > 1) {
    return { resolved: null, suggestions: exact.slice(0, 3).map(sugg), reason: "exact-ambiguous" };
  }

  // Tier 2 — fuzzy. A lone query word never fuzzy-resolves (too ambiguous).
  if (qToks.length < 2) {
    return { resolved: null, suggestions: rankSuggestions(codes, qToks), reason: "defer" };
  }

  // Numeral + honors guards: a candidate must be able to match the query's
  // level numeral and honors flag in at least one of its title variants.
  const cand = codes.filter((c) => {
    const variants = [...c.normTitles].map((t) => t.split(" ").filter(Boolean));
    const numOk = qNum === null ? true : variants.some((v) => numeralOf(v) === qNum);
    const honorsOk = variants.some((v) => v.includes("honors") === qHonors);
    return numOk && honorsOk;
  });

  const scored = cand
    .map((c) => {
      let bestJ = 0;
      let bestCov = 0;
      for (const t of c.normTitles) {
        const tt = t.split(" ").filter(Boolean);
        const inter = qToks.filter((x) => tt.includes(x)).length;
        const j = jaccard(qToks, tt);
        const cov = qToks.length ? inter / qToks.length : 0;
        if (j > bestJ || (j === bestJ && cov > bestCov)) {
          bestJ = j;
          bestCov = cov;
        }
      }
      return { c, j: bestJ, cov: bestCov };
    })
    .sort((a, b) => b.j - a.j || b.cov - a.cov);

  const top = scored[0];
  const second = scored[1];
  if (
    top &&
    top.j >= J_MIN &&
    top.cov >= COV_MIN &&
    (!second || top.j - second.j >= MARGIN_MIN)
  ) {
    return { resolved: ref(top.c), suggestions: [], reason: "fuzzy" };
  }

  return {
    resolved: null,
    suggestions: scored.filter((s) => s.cov > 0.3).slice(0, 3).map((s) => sugg(s.c)),
    reason: "defer",
  };
}

/** Rank suggestions for the deferral case when there's no fuzzy winner. */
function rankSuggestions(codes: CodeGroup[], qToks: string[]): CourseSuggestion[] {
  return codes
    .map((c) => {
      let best = 0;
      for (const t of c.normTitles) {
        const tt = t.split(" ").filter(Boolean);
        const inter = qToks.filter((x) => tt.includes(x)).length;
        const cov = qToks.length ? inter / qToks.length : 0;
        if (cov > best) best = cov;
      }
      return { c, cov: best };
    })
    .filter((s) => s.cov > 0.3)
    .sort((a, b) => b.cov - a.cov)
    .slice(0, 3)
    .map((s) => sugg(s.c));
}

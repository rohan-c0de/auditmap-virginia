/**
 * match-cc-slug.ts — map a receiving university's name for a sending community
 * college back to our internal college_slug (data/{state}/institutions.json).
 *
 * Per-receiver transfer tools identify sending colleges by their own codes/names
 * (FICE, IPEDS, internal ids). We need our slug to tag rows `[<slug>]` for
 * transfer-merge ownership. This normalizes both sides to a sorted token set
 * (dropping generic words like "community"/"college"/"technical") so e.g.
 * "Butler CC" ↔ "Butler Community College" and "Western Iowa Tech" ↔ "Iowa
 * Western"-vs-"Western Iowa" disambiguate correctly. A per-call alias map covers
 * the few abbreviations the token match can't reach (e.g. "WVU-Parkersburg").
 */

import fs from "fs";
import path from "path";

const STOP = new Set([
  "community",
  "college",
  "colleges",
  "coll", // abbrev
  "col", // abbrev ("Allen Co Com Col")
  "com", // abbrev (community)
  "comm", // abbrev (community)
  "technical",
  "tech",
  "the",
  "of",
  "at",
  "and",
  "a",
  "ctc", // "C&TC"
  "cmty",
  "cmmty",
  "commty", // abbrev (community)
  "cc",
  "ctc",
  "cllg",
  "univ",
  "district",
  "campus",
  "county", // CCs are named "X County CC" or "X CC" interchangeably across sources
  "area",
]);

// US state postal codes — sources append them to disambiguate ("Butler CC KS").
const STATE_CODES = new Set([
  "al","ak","az","ar","ca","co","ct","de","fl","ga","hi","id","il","in","ia","ks",
  "ky","la","me","md","ma","mi","mn","ms","mo","mt","ne","nv","nh","nj","nm","ny",
  "nc","nd","oh","ok","or","pa","ri","sc","sd","tn","tx","ut","vt","va","wa","wv","wi","wy",
]);

/** lowercase → strip punctuation → expand abbrevs → drop stopwords/state-codes → sort tokens → join. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "") // "C&TC" → "CTC" (a stopword), not "C TC"
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .map((t) => (t === "ft" ? "fort" : t === "st" ? "saint" : t))
    .filter((t) => t && !STOP.has(t) && !STATE_CODES.has(t))
    .sort()
    .join(" ");
}

export interface CcMatcher {
  /** Returns our college_slug for a sending-school name, or null if no match. */
  match: (name: string) => string | null;
  /** Slugs that were never matched by any call (for coverage logging). */
  unmatchedSlugs: () => string[];
  hit: (slug: string) => void;
}

/**
 * Build a matcher for a state. `aliases` maps an already-normalized name (or a
 * raw lowercase substring) to a slug for cases the token match misses.
 */
export function buildCcMatcher(
  state: string,
  aliases: Record<string, string> = {},
): CcMatcher {
  const instPath = path.join(process.cwd(), "data", state, "institutions.json");
  const insts: Array<{ college_slug: string; name: string }> = JSON.parse(
    fs.readFileSync(instPath, "utf-8"),
  );
  const byNorm = new Map<string, string>();
  const slugs = new Set<string>();
  for (const i of insts) {
    byNorm.set(normalizeName(i.name), i.college_slug);
    slugs.add(i.college_slug);
  }
  const aliasNorm = new Map<string, string>();
  for (const [k, v] of Object.entries(aliases)) aliasNorm.set(normalizeName(k), v);

  const used = new Set<string>();
  return {
    match(name: string): string | null {
      const key = normalizeName(name);
      if (byNorm.has(key)) return byNorm.get(key)!;
      if (aliasNorm.has(key)) return aliasNorm.get(key)!;
      // last resort: alias whose raw key is a substring of the lowercased name
      const lc = name.toLowerCase();
      for (const [raw, slug] of Object.entries(aliases)) {
        if (lc.includes(raw.toLowerCase())) return slug;
      }
      return null;
    },
    hit(slug: string) {
      used.add(slug);
    },
    unmatchedSlugs(): string[] {
      return [...slugs].filter((s) => !used.has(s));
    },
  };
}

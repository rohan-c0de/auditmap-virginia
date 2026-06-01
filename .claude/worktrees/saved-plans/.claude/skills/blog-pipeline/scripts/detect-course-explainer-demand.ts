#!/usr/bin/env tsx
/**
 * Trigger H — course-explainer demand (GSC-driven).
 *
 * Mines `~/gsc_audit_output.json` for course-code-shaped queries
 * (e.g. "sdv 100", "exsc 240", "bio 101") with high impressions and
 * low CTR — the search-demand pattern that says "users search for
 * this code, see our page in the SERP, and don't click." The fix is
 * a course-explainer spoke article that answers "what is this course?"
 * for that specific code.
 *
 * Unlike the other detectors, this one reads search demand, not data
 * presence. The slice file combines (a) the GSC query group backing
 * the candidate, and (b) the actual repo data about that course
 * (sections, prereqs, transfer mappings) so the drafter can cite real
 * numbers.
 *
 * Threshold logic: a course code becomes a candidate when
 *   - aggregate impressions across all query variants >= 30
 *   - aggregate CTR <= 5% (underperforming at the SERP position)
 *   - best position <= 20 (we're actually showing in the top 2 pages)
 *
 * State + college are extracted from quoted phrases in the queries when
 * present (e.g. `"danville community college"`). When absent, the
 * candidate is multi-state — the drafter will write a generic explainer
 * citing all systems that use the code.
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { articles } from "../../../../content/blog/index";
import { getAllStates } from "../../../../lib/states/registry";
import { loadInstitutions } from "../../../../lib/institutions";

const REPO_ROOT = resolve(__dirname, "../../../..");
const DISABLED = resolve(REPO_ROOT, ".blog-pipeline/DISABLED");
const CLUSTER = "course-explainer-guide";
const SLICE_OUT_DIR = resolve(REPO_ROOT, ".blog-pipeline/slices/course-explainer");
const GSC_PATH = resolve(homedir(), "gsc_audit_output.json");

// A query must match this to be considered course-code-shaped. The
// regex tolerates "SDV 100", "sdv 100", "SDV-100", "sdv100", and
// 4-digit codes like "1111" with a 3-4 letter prefix.
const COURSE_CODE_RE = /\b([a-z]{2,4})[\s-]*(\d{2,4})\b/i;

// Minimum thresholds to emit a candidate
const MIN_AGG_IMPRESSIONS = 30;
const MAX_AGG_CTR = 5; // percent
const MAX_BEST_POSITION = 20;

type GscQuery = {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number; // percent in GSC output
  position: number;
};

type GscOutput = {
  top_queries?: GscQuery[];
  blog_queries?: GscQuery[];
  quick_wins?: GscQuery[];
  zero_click_pages?: unknown[];
  summary?: unknown;
};

type Candidate = {
  triggerSource: "course-explainer-demand";
  topic: string;
  targetReader: string;
  searchIntentHypothesis: string;
  articleType: "general" | "state-spoke" | "college-spoke";
  state: string | null;
  college?: string;
  cluster: string;
  nonDuplicateRationale: string;
  dataSlicePaths: string[];
  rankScore: number;
};

type CourseCodeStats = {
  code: string; // e.g. "SDV 100"
  prefix: string; // e.g. "SDV"
  number: string; // e.g. "100"
  aggImpressions: number;
  aggClicks: number;
  aggCtr: number; // percent
  bestPosition: number; // lowest is best
  queryVariants: GscQuery[];
  extractedCollegeNames: string[]; // quoted-phrase extractions
  extractedStateNames: string[];
  matchedState: string | null; // resolved state slug if confidently identifiable
  matchedCollege: string | null; // resolved college slug if confidently identifiable
};

function readGsc(): GscOutput | null {
  if (!existsSync(GSC_PATH)) return null;
  try {
    return JSON.parse(readFileSync(GSC_PATH, "utf-8"));
  } catch {
    return null;
  }
}

function normalizeCode(prefix: string, number: string): string {
  return `${prefix.toUpperCase()} ${number}`;
}

/**
 * Extract quoted phrases from a GSC query string. Used to identify
 * college and state mentions that scope the user's intent.
 */
function extractQuotedPhrases(query: string): string[] {
  const phrases: string[] = [];
  const re = /"([^"]+)"/g;
  let m;
  while ((m = re.exec(query)) !== null) {
    phrases.push(m[1].toLowerCase().trim());
  }
  return phrases;
}

/**
 * Heuristic mapping from college-or-state name mentions to a state
 * slug + optional college slug. Returns (null, null) on no match.
 */
function resolveStateAndCollege(
  mentions: string[]
): { state: string | null; college: string | null } {
  if (mentions.length === 0) return { state: null, college: null };

  const allStates = getAllStates();
  // Direct state-name match first
  for (const phrase of mentions) {
    for (const s of allStates) {
      const nameLower = s.name.toLowerCase();
      if (phrase === nameLower || phrase.includes(nameLower)) {
        return { state: s.slug, college: null };
      }
    }
  }

  // Then college-name match across all states
  for (const phrase of mentions) {
    for (const s of allStates) {
      const insts = loadInstitutions(s.slug);
      for (const inst of insts) {
        const instNameLower = inst.name.toLowerCase();
        // Either exact match or phrase contains the institution name
        if (phrase === instNameLower || phrase.includes(instNameLower)) {
          return { state: s.slug, college: inst.id };
        }
      }
    }
  }

  return { state: null, college: null };
}

function aggregateByCode(queries: GscQuery[]): Map<string, CourseCodeStats> {
  const grouped = new Map<string, CourseCodeStats>();

  for (const q of queries) {
    const m = q.query.match(COURSE_CODE_RE);
    if (!m) continue;
    const prefix = m[1].toUpperCase();
    const number = m[2];
    const code = normalizeCode(prefix, number);

    // Skip very long prefixes that are probably school-name acronyms
    // (e.g. "UCLA" wouldn't be a course code; "UCLAANTH" wouldn't match anyway)
    if (prefix.length > 4) continue;
    // Skip very common english words that look like prefixes
    if (
      prefix === "THE" ||
      prefix === "FOR" ||
      prefix === "AND" ||
      prefix === "WITH"
    ) {
      continue;
    }

    let entry = grouped.get(code);
    if (!entry) {
      entry = {
        code,
        prefix,
        number,
        aggImpressions: 0,
        aggClicks: 0,
        aggCtr: 0,
        bestPosition: Number.POSITIVE_INFINITY,
        queryVariants: [],
        extractedCollegeNames: [],
        extractedStateNames: [],
        matchedState: null,
        matchedCollege: null,
      };
      grouped.set(code, entry);
    }
    entry.aggImpressions += q.impressions;
    entry.aggClicks += q.clicks;
    entry.bestPosition = Math.min(entry.bestPosition, q.position);
    entry.queryVariants.push(q);

    const phrases = extractQuotedPhrases(q.query);
    for (const p of phrases) {
      if (p === code.toLowerCase() || p === `${prefix.toLowerCase()}-${number}`)
        continue;
      // crude classification: contains "college" or "university" → college name
      if (p.includes("college") || p.includes("university")) {
        if (!entry.extractedCollegeNames.includes(p)) {
          entry.extractedCollegeNames.push(p);
        }
      }
    }
  }

  // Compute aggregate CTR and resolve state/college
  for (const entry of grouped.values()) {
    entry.aggCtr =
      entry.aggImpressions > 0
        ? (entry.aggClicks / entry.aggImpressions) * 100
        : 0;
    const resolved = resolveStateAndCollege(entry.extractedCollegeNames);
    entry.matchedState = resolved.state;
    entry.matchedCollege = resolved.college;
  }

  return grouped;
}

function slugifyCode(code: string): string {
  return code.toLowerCase().replace(/\s+/g, "-");
}

function articleSlugFor(stats: CourseCodeStats): string {
  const codeSlug = slugifyCode(stats.code);
  if (stats.matchedCollege) {
    return `what-is-${codeSlug}-at-${stats.matchedCollege}`;
  }
  if (stats.matchedState) {
    return `what-is-${codeSlug}-${stats.matchedState}-community-college`;
  }
  return `what-is-${codeSlug}-community-college`;
}

function detect(): Candidate[] {
  const gsc = readGsc();
  if (!gsc) {
    process.stderr.write(
      `[detect-course-explainer-demand] no GSC data at ${GSC_PATH} — skipping\n`
    );
    return [];
  }

  // Combine all query sources GSC dumps; deduplicate by exact query string
  const allQueries: GscQuery[] = [];
  const seen = new Set<string>();
  for (const arr of [gsc.top_queries, gsc.blog_queries, gsc.quick_wins]) {
    if (!Array.isArray(arr)) continue;
    for (const q of arr) {
      if (seen.has(q.query)) continue;
      seen.add(q.query);
      allQueries.push(q);
    }
  }

  const grouped = aggregateByCode(allQueries);

  // Existing spokes — skip already-drafted course codes. Match by the
  // (state, college, prefix-number) signature rather than exact slug,
  // because the slug form chosen by the drafter may differ from what
  // articleSlugFor() predicts (e.g. "danville-community-college" instead
  // of "dcc"). Parse the code out of each existing slug via regex. We
  // also track codes that already have ANY spoke so a "general"
  // (no-state-context) candidate doesn't emit when a more-specific
  // college-spoke already exists.
  const SLUG_CODE_RE = /what-is-([a-z]{2,4})-(\d{2,4})/i;
  const existingSignatures = new Set<string>();
  const existingCodesAnyContext = new Set<string>();
  for (const a of articles) {
    if (a.cluster !== CLUSTER || a.clusterRole !== "spoke") continue;
    const m = a.slug.match(SLUG_CODE_RE);
    if (!m) continue;
    const prefix = m[1].toUpperCase();
    const number = m[2];
    const code = `${prefix} ${number}`;
    const state = a.state ?? "_";
    const college = a.college ?? "_";
    existingSignatures.add(`${state}|${college}|${code}`);
    existingCodesAnyContext.add(code);
  }
  function candidateSignature(stats: CourseCodeStats): string {
    const state = stats.matchedState ?? "_";
    const college = stats.matchedCollege ?? "_";
    return `${state}|${college}|${stats.code}`;
  }

  mkdirSync(SLICE_OUT_DIR, { recursive: true });

  const candidates: Candidate[] = [];

  for (const stats of grouped.values()) {
    if (stats.aggImpressions < MIN_AGG_IMPRESSIONS) continue;
    if (stats.aggCtr > MAX_AGG_CTR) continue;
    if (stats.bestPosition > MAX_BEST_POSITION) continue;

    const targetSlug = articleSlugFor(stats);
    if (existingSignatures.has(candidateSignature(stats))) continue;
    // If a no-context candidate (general article) tries to emit but the
    // code already has a college-specific spoke, skip — the existing
    // spoke covers the same search demand. The reverse (existing
    // general spoke, new college-specific candidate) is allowed because
    // a college-specific article serves a tighter intent.
    if (
      !stats.matchedState &&
      !stats.matchedCollege &&
      existingCodesAnyContext.has(stats.code)
    ) {
      continue;
    }

    const slicePath = resolve(
      SLICE_OUT_DIR,
      `${slugifyCode(stats.code)}.json`
    );
    writeFileSync(slicePath, JSON.stringify(stats, null, 2));

    const articleType: Candidate["articleType"] = stats.matchedCollege
      ? "college-spoke"
      : stats.matchedState
        ? "state-spoke"
        : "general";

    const collegeContext = stats.matchedCollege
      ? ` at ${stats.matchedCollege}`
      : stats.matchedState
        ? ` (${stats.matchedState.toUpperCase()})`
        : "";

    const dataSlicePaths: string[] = [
      `.blog-pipeline/slices/course-explainer/${slugifyCode(stats.code)}.json`,
    ];

    // Hint the drafter at the actual course data if state/college identified
    if (stats.matchedState && stats.matchedCollege) {
      dataSlicePaths.push(
        `data/${stats.matchedState}/courses/${stats.matchedCollege}/`,
        `data/${stats.matchedState}/prereqs.json`,
        `data/${stats.matchedState}/transfer-equiv.json`
      );
    } else if (stats.matchedState) {
      dataSlicePaths.push(
        `data/${stats.matchedState}/courses/`,
        `data/${stats.matchedState}/prereqs.json`
      );
    }

    candidates.push({
      triggerSource: "course-explainer-demand",
      topic: `What is ${stats.code}${collegeContext}? Course-explainer spoke for the course-explainer-guide cluster`,
      targetReader: `Student or AI assistant searching for "${stats.code}" who landed on the SERP but didn't click any result — wants a quick, authoritative explainer of what the course covers, credits, prereqs, and whether it transfers`,
      searchIntentHypothesis: `User searching "${stats.code.toLowerCase()}"${collegeContext ? ` or variants like "${stats.queryVariants[0]?.query.substring(0, 60)}"` : ""} wants to verify what the course teaches, credits, prereq chain, and transfer status without reading the full college catalog`,
      articleType,
      state: stats.matchedState,
      ...(stats.matchedCollege ? { college: stats.matchedCollege } : {}),
      cluster: CLUSTER,
      nonDuplicateRationale: `GSC shows ${stats.aggImpressions} impressions across ${stats.queryVariants.length} query variant(s) for ${stats.code} with ${stats.aggCtr.toFixed(1)}% CTR at best position ${stats.bestPosition.toFixed(1)}. No existing spoke for ${targetSlug}.`,
      dataSlicePaths,
      // Rank score: impressions matter most, position is a tiebreaker
      // (lower position = higher rank), CTR-gap is a multiplier
      rankScore:
        stats.aggImpressions * (1 + (MAX_AGG_CTR - stats.aggCtr) / 10) +
        (20 - Math.min(stats.bestPosition, 20)) * 5,
    });
  }

  candidates.sort((a, b) => b.rankScore - a.rankScore);
  return candidates;
}

function main() {
  if (existsSync(DISABLED)) {
    process.stdout.write(JSON.stringify({ candidates: [], disabled: true }));
    process.exit(0);
  }
  try {
    const candidates = detect();
    process.stderr.write(
      `[detect-course-explainer-demand] found ${candidates.length} candidate(s)\n`
    );
    process.stdout.write(JSON.stringify({ candidates }, null, 2));
    process.exit(0);
  } catch (err) {
    process.stderr.write(
      `[detect-course-explainer-demand] error: ${String(err)}\n`
    );
    process.stdout.write(
      JSON.stringify({ candidates: [], error: String(err) })
    );
    process.exit(1);
  }
}

main();

#!/usr/bin/env tsx
/**
 * Trigger F — late-start-density detection (data-driven).
 *
 * Mines `data/{state}/courses/<college>/2026FA*.json` for each
 * covered state and emits a candidate when the state's fall section
 * catalog has >= 5% late-start sections AND the
 * late-start-by-state-guide cluster has no spoke yet for that state.
 *
 * "Late-start" defined as a section with start_date > LATE_CUTOFF
 * (default 2026-09-14, roughly 2 weeks after the standard fall start
 * date for most US community colleges). The threshold is configurable
 * but the LATE_CUTOFF date is hardcoded for the current term —
 * update annually before each fall registration window.
 *
 * Each candidate carries a precomputed slice file at
 * .blog-pipeline/slices/late-start/{state}.json with: total fall
 * sections, late-start count and percentage, count of distinct
 * late-start dates, per-college breakdown, and the top 5 colleges
 * by late-start share. The drafter consumes the slice verbatim.
 *
 * The 5% threshold filters out states whose late-start menu is too
 * thin to write a useful state-spoke about (e.g., Maine at 1.3%
 * where the data is dominated by one college; Connecticut at 4%).
 * Until those scrapers improve coverage or those systems expand
 * late-start offerings, those states aren't worth a data-grounded
 * spoke.
 */
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { articles } from "../../../../content/blog/index";
import { getAllStates } from "../../../../lib/states/registry";

const REPO_ROOT = resolve(__dirname, "../../../..");
const DISABLED = resolve(REPO_ROOT, ".blog-pipeline/DISABLED");
const CLUSTER = "late-start-by-state-guide";
const SLICE_OUT_DIR = resolve(REPO_ROOT, ".blog-pipeline/slices/late-start");
const LATE_THRESHOLD_PCT = 5.0;
const LATE_CUTOFF = "2026-09-14"; // ~2 weeks after typical fall start
const TERM_PATTERN = /2026FA/i;

type Candidate = {
  triggerSource: "late-start-density";
  topic: string;
  targetReader: string;
  searchIntentHypothesis: string;
  articleType: "state-spoke";
  state: string;
  cluster: string;
  nonDuplicateRationale: string;
  dataSlicePaths: string[];
  rankScore: number;
};

type StateStats = {
  state: string;
  termPattern: string;
  lateCutoff: string;
  totalFallSections: number;
  lateStartSections: number;
  lateStartPct: number;
  distinctLateStartDates: string[];
  perCollege: Array<{
    college: string;
    sections: number;
    lateSections: number;
    latePct: number;
  }>;
  topLateColleges: Array<{ college: string; latePct: number; lateSections: number; totalSections: number }>;
};

function computeStats(stateSlug: string): StateStats | null {
  const coursesDir = resolve(REPO_ROOT, `data/${stateSlug}/courses`);
  if (!existsSync(coursesDir)) return null;

  let totalFallSections = 0;
  let lateStartSections = 0;
  const distinctDates = new Set<string>();
  const perCollege: StateStats["perCollege"] = [];

  for (const college of readdirSync(coursesDir)) {
    const collegeDir = resolve(coursesDir, college);
    let collegeTotal = 0;
    let collegeLate = 0;

    let termFiles: string[] = [];
    try {
      termFiles = readdirSync(collegeDir).filter((f) => TERM_PATTERN.test(f) && f.endsWith(".json"));
    } catch {
      continue;
    }

    for (const f of termFiles) {
      try {
        const data = JSON.parse(readFileSync(resolve(collegeDir, f), "utf-8"));
        if (!Array.isArray(data)) continue;
        for (const r of data) {
          collegeTotal++;
          if (r.start_date && r.start_date > LATE_CUTOFF) {
            collegeLate++;
            distinctDates.add(r.start_date);
          }
        }
      } catch {
        continue;
      }
    }

    if (collegeTotal > 0) {
      totalFallSections += collegeTotal;
      lateStartSections += collegeLate;
      perCollege.push({
        college,
        sections: collegeTotal,
        lateSections: collegeLate,
        latePct: (collegeLate / collegeTotal) * 100,
      });
    }
  }

  if (totalFallSections === 0) return null;

  const lateStartPct = (lateStartSections / totalFallSections) * 100;

  const topLateColleges = [...perCollege]
    .filter((c) => c.lateSections > 0)
    .sort((a, b) => b.latePct - a.latePct)
    .slice(0, 5)
    .map((c) => ({
      college: c.college,
      latePct: c.latePct,
      lateSections: c.lateSections,
      totalSections: c.sections,
    }));

  return {
    state: stateSlug,
    termPattern: "2026FA",
    lateCutoff: LATE_CUTOFF,
    totalFallSections,
    lateStartSections,
    lateStartPct,
    distinctLateStartDates: [...distinctDates].sort(),
    perCollege: perCollege.sort((a, b) => b.sections - a.sections),
    topLateColleges,
  };
}

function detect(): Candidate[] {
  const states = getAllStates();
  const candidates: Candidate[] = [];

  const existingSpokes = articles.filter(
    (a) => a.cluster === CLUSTER && a.clusterRole === "spoke"
  );
  const coveredStates = new Set(
    existingSpokes.map((s) => s.state).filter((s): s is string => s !== null)
  );

  mkdirSync(SLICE_OUT_DIR, { recursive: true });

  for (const s of states) {
    if (coveredStates.has(s.slug)) continue;
    const stats = computeStats(s.slug);
    if (!stats) continue;
    if (stats.lateStartPct < LATE_THRESHOLD_PCT) continue;

    const slicePath = resolve(SLICE_OUT_DIR, `${s.slug}.json`);
    writeFileSync(slicePath, JSON.stringify(stats, null, 2));

    candidates.push({
      triggerSource: "late-start-density",
      topic: `${s.name} community college late-start sections: state-specific spoke for the late-start-by-state hub`,
      targetReader: `${s.name} community college student who missed the main fall registration window or dropped a class and needs to find a still-open late-start section`,
      searchIntentHypothesis: `User searching "${s.name.toLowerCase()} late-start community college classes" or "${s.name.toLowerCase()} community college mini-session" wants to know which colleges in the state actually offer late-start sections, when they begin, and how to register before the windows close`,
      articleType: "state-spoke",
      state: s.slug,
      cluster: CLUSTER,
      nonDuplicateRationale: `Cluster "${CLUSTER}" has ${existingSpokes.length} spoke(s), none for ${s.name}. Detector confirmed ${stats.lateStartPct.toFixed(1)}% late-start share across ${stats.totalFallSections} fall sections at ${stats.perCollege.length} colleges, with ${stats.distinctLateStartDates.length} distinct late-start dates.`,
      dataSlicePaths: [
        `data/${s.slug}/courses`,
        `lib/states/${s.slug}/config.ts`,
        `.blog-pipeline/slices/late-start/${s.slug}.json`,
      ],
      rankScore: Math.round(stats.lateStartPct * 100 + stats.totalFallSections / 100 + stats.distinctLateStartDates.length * 10),
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
      `[detect-late-start-density] found ${candidates.length} candidate(s)\n`
    );
    process.stdout.write(JSON.stringify({ candidates }, null, 2));
    process.exit(0);
  } catch (err) {
    process.stderr.write(`[detect-late-start-density] error: ${String(err)}\n`);
    process.stdout.write(JSON.stringify({ candidates: [], error: String(err) }));
    process.exit(1);
  }
}

main();

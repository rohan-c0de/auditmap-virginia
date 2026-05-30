#!/usr/bin/env tsx
/**
 * Trigger E — hybrid-density detection (data-driven).
 *
 * Mines `data/{state}/courses/<college>/<term>.json` for each covered
 * state and emits a candidate when the state's section catalog has a
 * meaningful share of hybrid offerings (>= 3% by section count) AND
 * the hybrid-course-density-guide cluster has no spoke yet for that
 * state.
 *
 * Each candidate carries a precomputed slice file at
 * .blog-pipeline/slices/hybrid/{state}.json with: total section count,
 * mode breakdown (in-person / hybrid / online / unknown), per-college
 * hybrid percentages, and the top 5 colleges by hybrid share. The
 * drafter consumes the slice verbatim — every numeric claim must come
 * from this file, not LLM speculation.
 *
 * The 3% threshold filters out states where hybrid is essentially
 * unmarked (FL, TN, GA, CT, DE, DC report < 1% hybrid in their
 * section data, almost certainly because their colleges categorize
 * blended sections as in-person rather than hybrid). Until those
 * scrapers improve mode detection, those states aren't worth a
 * data-grounded hybrid spoke.
 */
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { articles } from "../../../../content/blog/index";
import { getAllStates } from "../../../../lib/states/registry";

const REPO_ROOT = resolve(__dirname, "../../../..");
const DISABLED = resolve(REPO_ROOT, ".blog-pipeline/DISABLED");
const CLUSTER = "hybrid-course-density-guide";
const SLICE_OUT_DIR = resolve(REPO_ROOT, ".blog-pipeline/slices/hybrid");
const HYBRID_THRESHOLD_PCT = 3.0;

type Mode = "in-person" | "hybrid" | "online" | "unknown";

type Candidate = {
  triggerSource: "hybrid-density";
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
  totalSections: number;
  modes: Record<Mode, number>;
  modePcts: Record<Mode, number>;
  perCollege: Array<{
    college: string;
    sections: number;
    hybridPct: number;
    onlinePct: number;
    inPersonPct: number;
  }>;
  topHybridColleges: Array<{ college: string; hybridPct: number; sections: number }>;
};

function classifyMode(raw: string): Mode {
  const m = (raw || "").toLowerCase();
  if (m.includes("hybrid") || m.includes("blended") || m.includes("hyflex")) return "hybrid";
  if (m.includes("online") || m.includes("async") || m.includes("virtual") || m.includes("web")) return "online";
  if (m.includes("person") || m.includes("campus") || m.includes("classroom") || m === "") return "in-person";
  return "unknown";
}

function computeStats(stateSlug: string): StateStats | null {
  const coursesDir = resolve(REPO_ROOT, `data/${stateSlug}/courses`);
  if (!existsSync(coursesDir)) return null;

  const modes: Record<Mode, number> = { "in-person": 0, hybrid: 0, online: 0, unknown: 0 };
  const perCollege: StateStats["perCollege"] = [];
  let totalSections = 0;

  for (const college of readdirSync(coursesDir)) {
    const collegeDir = resolve(coursesDir, college);
    let collegeSections = 0;
    const collegeModes: Record<Mode, number> = { "in-person": 0, hybrid: 0, online: 0, unknown: 0 };

    let termFiles: string[] = [];
    try {
      termFiles = readdirSync(collegeDir).filter((f) => /20\d\d/.test(f) && f.endsWith(".json"));
    } catch {
      continue;
    }

    for (const f of termFiles) {
      try {
        const data = JSON.parse(readFileSync(resolve(collegeDir, f), "utf-8"));
        if (!Array.isArray(data)) continue;
        for (const r of data) {
          collegeSections++;
          const m = classifyMode(r.mode);
          collegeModes[m]++;
        }
      } catch {
        continue;
      }
    }

    if (collegeSections > 0) {
      totalSections += collegeSections;
      for (const k of Object.keys(modes) as Mode[]) modes[k] += collegeModes[k];
      perCollege.push({
        college,
        sections: collegeSections,
        hybridPct: (collegeModes.hybrid / collegeSections) * 100,
        onlinePct: (collegeModes.online / collegeSections) * 100,
        inPersonPct: (collegeModes["in-person"] / collegeSections) * 100,
      });
    }
  }

  if (totalSections === 0) return null;

  const modePcts: Record<Mode, number> = {
    "in-person": (modes["in-person"] / totalSections) * 100,
    hybrid: (modes.hybrid / totalSections) * 100,
    online: (modes.online / totalSections) * 100,
    unknown: (modes.unknown / totalSections) * 100,
  };

  const topHybridColleges = [...perCollege]
    .sort((a, b) => b.hybridPct - a.hybridPct)
    .slice(0, 5)
    .map((c) => ({ college: c.college, hybridPct: c.hybridPct, sections: c.sections }));

  return {
    state: stateSlug,
    totalSections,
    modes,
    modePcts,
    perCollege: perCollege.sort((a, b) => b.sections - a.sections),
    topHybridColleges,
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
    if (stats.modePcts.hybrid < HYBRID_THRESHOLD_PCT) continue;

    const slicePath = resolve(SLICE_OUT_DIR, `${s.slug}.json`);
    writeFileSync(slicePath, JSON.stringify(stats, null, 2));

    candidates.push({
      triggerSource: "hybrid-density",
      topic: `${s.name} community college hybrid course density: state-specific spoke for the hybrid-course-density hub`,
      targetReader: `${s.name} community college student weighing hybrid vs online vs in-person sections, who wants to know what's actually available across the state`,
      searchIntentHypothesis: `User searching "${s.name.toLowerCase()} community college hybrid classes" or "blended ${s.name.toLowerCase()} community college" wants to know which colleges in the state actually offer hybrid sections and at what density`,
      articleType: "state-spoke",
      state: s.slug,
      cluster: CLUSTER,
      nonDuplicateRationale: `Cluster "${CLUSTER}" has ${existingSpokes.length} spoke(s), none for ${s.name}. Detector confirmed ${stats.modePcts.hybrid.toFixed(1)}% hybrid share across ${stats.totalSections} sections at ${stats.perCollege.length} colleges.`,
      dataSlicePaths: [
        `data/${s.slug}/courses`,
        `lib/states/${s.slug}/config.ts`,
        `.blog-pipeline/slices/hybrid/${s.slug}.json`,
      ],
      rankScore: Math.round(stats.modePcts.hybrid * 100 + stats.totalSections / 100),
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
      `[detect-hybrid-density] found ${candidates.length} candidate(s)\n`
    );
    process.stdout.write(JSON.stringify({ candidates }, null, 2));
    process.exit(0);
  } catch (err) {
    process.stderr.write(`[detect-hybrid-density] error: ${String(err)}\n`);
    process.stdout.write(JSON.stringify({ candidates: [], error: String(err) }));
    process.exit(1);
  }
}

main();

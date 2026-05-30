#!/usr/bin/env tsx
/**
 * Trigger D — prereq-bottleneck detection (data-driven).
 *
 * Mines `data/{state}/prereqs.json` for each covered state and emits a
 * candidate when the state has enough deep prereq chains to support a
 * useful "[state] community college prereq chains" article that doesn't
 * already exist as a spoke of the prereq-chains-guide cluster.
 *
 * The detector emits not just a candidate, but a precomputed
 * statistics slice — number of courses with prereqs, number of deep
 * (depth >= 3) chains, and the top "blocker" courses (those that gate
 * the most downstream courses transitively). The drafter consumes that
 * slice via dataSlicePaths and writes prose around real numbers, not
 * speculation.
 *
 * The threshold logic: a state needs (a) >= 50 prereq entries to have
 * meaningful coverage, and (b) >= 5 chains of depth >= 3 to have a real
 * bottleneck story. States without prereqs.json are skipped entirely.
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { articles } from "../../../../content/blog/index";
import { getAllStates } from "../../../../lib/states/registry";

const REPO_ROOT = resolve(__dirname, "../../../..");
const DISABLED = resolve(REPO_ROOT, ".blog-pipeline/DISABLED");
const CLUSTER = "prereq-chains-guide";
const SLICE_OUT_DIR = resolve(REPO_ROOT, ".blog-pipeline/slices/prereq");

type PrereqEntry = [string, { text: string; courses: string[] }];

type Candidate = {
  triggerSource: "prereq-bottleneck";
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
  totalEntries: number;
  coursesWithPrereqs: number;
  deepChainCount: number;
  maxChainDepth: number;
  topBlockers: Array<{ course: string; transitiveDownstream: number }>;
  deepestChains: Array<{ leaf: string; depth: number; path: string[] }>;
};

function readPrereqs(stateSlug: string): PrereqEntry[] | null {
  const path = resolve(REPO_ROOT, `data/${stateSlug}/prereqs.json`);
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    if (Array.isArray(data)) return data as PrereqEntry[];
    return Object.entries(data).map(([k, v]) => [k, v]) as PrereqEntry[];
  } catch {
    return null;
  }
}

function buildGraph(entries: PrereqEntry[]): Map<string, Set<string>> {
  const requires = new Map<string, Set<string>>();
  for (const [course, spec] of entries) {
    if (!spec || !Array.isArray(spec.courses)) continue;
    if (!requires.has(course)) requires.set(course, new Set());
    for (const p of spec.courses) {
      requires.get(course)!.add(p);
    }
  }
  return requires;
}

function chainDepth(
  course: string,
  requires: Map<string, Set<string>>,
  memo: Map<string, number>,
  visiting: Set<string>,
): number {
  if (memo.has(course)) return memo.get(course)!;
  if (visiting.has(course)) return 0;
  const prereqs = requires.get(course);
  if (!prereqs || prereqs.size === 0) {
    memo.set(course, 0);
    return 0;
  }
  visiting.add(course);
  let best = 0;
  for (const p of prereqs) {
    best = Math.max(best, 1 + chainDepth(p, requires, memo, visiting));
  }
  visiting.delete(course);
  memo.set(course, best);
  return best;
}

function deepestPath(
  course: string,
  requires: Map<string, Set<string>>,
  memo: Map<string, string[]>,
  visiting: Set<string>,
): string[] {
  if (memo.has(course)) return memo.get(course)!;
  if (visiting.has(course)) return [course];
  const prereqs = requires.get(course);
  if (!prereqs || prereqs.size === 0) {
    const leaf = [course];
    memo.set(course, leaf);
    return leaf;
  }
  visiting.add(course);
  let best: string[] = [];
  for (const p of prereqs) {
    const path = deepestPath(p, requires, memo, visiting);
    if (path.length > best.length) best = path;
  }
  visiting.delete(course);
  const result = [course, ...best];
  memo.set(course, result);
  return result;
}

function transitiveDownstream(requires: Map<string, Set<string>>): Map<string, number> {
  const downstream = new Map<string, Set<string>>();
  const reverse = new Map<string, Set<string>>();
  for (const [course, prereqs] of requires) {
    for (const p of prereqs) {
      if (!reverse.has(p)) reverse.set(p, new Set());
      reverse.get(p)!.add(course);
    }
  }
  function collect(course: string, seen: Set<string>): Set<string> {
    if (downstream.has(course)) {
      for (const c of downstream.get(course)!) seen.add(c);
      return seen;
    }
    const direct = reverse.get(course);
    if (!direct) return seen;
    for (const c of direct) {
      if (!seen.has(c)) {
        seen.add(c);
        collect(c, seen);
      }
    }
    return seen;
  }
  const result = new Map<string, number>();
  for (const course of reverse.keys()) {
    const set = collect(course, new Set());
    downstream.set(course, set);
    result.set(course, set.size);
  }
  return result;
}

function computeStats(stateSlug: string): StateStats | null {
  const entries = readPrereqs(stateSlug);
  if (!entries || entries.length < 50) return null;
  const requires = buildGraph(entries);
  const memo = new Map<string, number>();
  let deepChainCount = 0;
  let maxChainDepth = 0;
  const allDepths: Array<{ course: string; depth: number }> = [];
  for (const course of requires.keys()) {
    const d = chainDepth(course, requires, memo, new Set());
    allDepths.push({ course, depth: d });
    if (d >= 3) deepChainCount++;
    if (d > maxChainDepth) maxChainDepth = d;
  }
  const downstream = transitiveDownstream(requires);
  const blockers = Array.from(downstream.entries())
    .map(([course, n]) => ({ course, transitiveDownstream: n }))
    .sort((a, b) => b.transitiveDownstream - a.transitiveDownstream)
    .slice(0, 10);
  const pathMemo = new Map<string, string[]>();
  const deepest = allDepths
    .filter((d) => d.depth >= 3)
    .sort((a, b) => b.depth - a.depth)
    .slice(0, 10)
    .map(({ course, depth }) => ({
      leaf: course,
      depth,
      path: deepestPath(course, requires, pathMemo, new Set()),
    }));
  return {
    state: stateSlug,
    totalEntries: entries.length,
    coursesWithPrereqs: requires.size,
    deepChainCount,
    maxChainDepth,
    topBlockers: blockers,
    deepestChains: deepest,
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
    if (stats.deepChainCount < 5) continue;

    const slicePath = resolve(SLICE_OUT_DIR, `${s.slug}.json`);
    writeFileSync(slicePath, JSON.stringify(stats, null, 2));

    candidates.push({
      triggerSource: "prereq-bottleneck",
      topic: `${s.name} community college prereq bottlenecks: state-specific spoke for the prereq-chains hub`,
      targetReader: `${s.name} community college student trying to plan a 2- or 3-year graduation path who has not yet realized which prereq chains will gate their schedule`,
      searchIntentHypothesis: `User searching "${s.name.toLowerCase()} community college prerequisites" or "${s.name.toLowerCase()} cc course sequence" wants to know which courses gate downstream classes and how to sequence early-semester registration`,
      articleType: "state-spoke",
      state: s.slug,
      cluster: CLUSTER,
      nonDuplicateRationale: `Cluster "${CLUSTER}" has ${existingSpokes.length} spoke(s), none for ${s.name}. Detector confirmed ${stats.deepChainCount} chains of depth >= 3 across ${stats.coursesWithPrereqs} courses with prereqs (max depth ${stats.maxChainDepth}).`,
      dataSlicePaths: [
        `data/${s.slug}/prereqs.json`,
        `lib/states/${s.slug}/config.ts`,
        `.blog-pipeline/slices/prereq/${s.slug}.json`,
      ],
      rankScore: stats.deepChainCount * 3 + stats.maxChainDepth * 10 + stats.coursesWithPrereqs,
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
      `[detect-prereq-bottlenecks] found ${candidates.length} candidate(s)\n`
    );
    process.stdout.write(JSON.stringify({ candidates }, null, 2));
    process.exit(0);
  } catch (err) {
    process.stderr.write(`[detect-prereq-bottlenecks] error: ${String(err)}\n`);
    process.stdout.write(JSON.stringify({ candidates: [], error: String(err) }));
    process.exit(1);
  }
}

main();

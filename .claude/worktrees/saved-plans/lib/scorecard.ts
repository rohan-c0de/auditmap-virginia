/**
 * Reader helpers for the per-college Scorecard data ingested under
 * `data/{state}/scorecard/{college_id}.json`.
 *
 * Issue #392. The ingest script (`scripts/ingest-scorecard.ts`) writes the
 * canonical `ScorecardRecord` shape (defined alongside the API client at
 * `scripts/lib/college-scorecard.ts`). This module is the read path used by
 * pages, sitemaps, and any consumer that needs cost/aid/completion data.
 *
 * Conventions:
 *   - Every function returns `null` when data is missing instead of throwing,
 *     so callers can render fallback UI without try/catch.
 *   - Records are read from disk synchronously and cached in-process. Cache
 *     is keyed by `(state, collegeId)`. Invalidated only on process restart;
 *     fine for build-time use (ISR rebuilds get fresh data).
 */

import fs from "fs";
import path from "path";

// Re-export the canonical record type for consumers. Kept in scripts/ so the
// ingest script can use it without importing from the app tree.
export type { ScorecardRecord } from "@/scripts/lib/college-scorecard";

import type { ScorecardRecord } from "@/scripts/lib/college-scorecard";

const cache = new Map<string, ScorecardRecord | null>();

function cacheKey(state: string, collegeId: string): string {
  return `${state}:${collegeId}`;
}

function recordPath(state: string, collegeId: string): string {
  return path.join(process.cwd(), "data", state, "scorecard", `${collegeId}.json`);
}

/**
 * Return the Scorecard record for one college, or null if not ingested.
 * Cached in-process.
 */
export function getScorecard(
  state: string,
  collegeId: string
): ScorecardRecord | null {
  const key = cacheKey(state, collegeId);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const p = recordPath(state, collegeId);
  if (!fs.existsSync(p)) {
    cache.set(key, null);
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf-8")) as ScorecardRecord;
    cache.set(key, parsed);
    return parsed;
  } catch {
    cache.set(key, null);
    return null;
  }
}

/**
 * Return every Scorecard record present for a state, keyed by college id.
 * Skips colleges without an ingested record. Useful for state-level
 * aggregates and the colleges-directory page.
 */
export function getStateScorecardMap(
  state: string
): Map<string, ScorecardRecord> {
  const out = new Map<string, ScorecardRecord>();
  const dir = path.join(process.cwd(), "data", state, "scorecard");
  if (!fs.existsSync(dir)) return out;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const collegeId = file.slice(0, -".json".length);
    const r = getScorecard(state, collegeId);
    if (r) out.set(collegeId, r);
  }
  return out;
}

/** Type for state-level aggregate stats returned by `getStateAggregates`. */
export interface StateScorecardAggregates {
  /** Number of colleges in the state with a Scorecard record. */
  count: number;
  /** Median in-state tuition across colleges with non-null tuition. */
  medianTuitionInState: number | null;
  /** Median net price (after aid) across colleges. */
  medianNetPrice: number | null;
  /** Average Pell-grant participation rate (0-1) across colleges. */
  avgPellRate: number | null;
  /**
   * Median completion rate (less-than-4-year 150% time) across colleges
   * reporting a value.
   */
  medianCompletionRate: number | null;
  /** Median 10-year-after-entry earnings across colleges reporting a value. */
  medianEarnings: number | null;
}

function median(nums: number[]): number | null {
  const sorted = nums.filter((n) => n != null).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function average(nums: number[]): number | null {
  const valid = nums.filter((n) => n != null);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

/**
 * State-level aggregate metrics. Computed across every college in the state
 * with a Scorecard record; null fields are ignored, so a state with sparse
 * data still returns useful numbers.
 */
export function getStateAggregates(state: string): StateScorecardAggregates {
  const records = Array.from(getStateScorecardMap(state).values());
  const pluckCost = (
    select: (r: ScorecardRecord) => number | null
  ): number[] =>
    records
      .map(select)
      .filter((v): v is number => typeof v === "number");

  return {
    count: records.length,
    medianTuitionInState: median(pluckCost((r) => r.cost.tuitionInState)),
    medianNetPrice: median(pluckCost((r) => r.cost.avgNetPricePublic)),
    avgPellRate: average(
      records
        .map((r) => r.aid.pellGrantRate)
        .filter((v): v is number => typeof v === "number")
    ),
    medianCompletionRate: median(
      records
        .map((r) => r.completion.completionRate150nt)
        .filter((v): v is number => typeof v === "number")
    ),
    medianEarnings: median(
      records
        .map((r) => r.earnings.median10YrsAfterEntry)
        .filter((v): v is number => typeof v === "number")
    ),
  };
}

/**
 * Format helpers — keep all display-layer formatting in one place so cost
 * numbers are consistent across course pages, college pages, and the blog.
 */
export function formatDollar(v: number | null | undefined): string {
  if (v == null) return "—";
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function formatPercent(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(0)}%`;
}

// ---------------------------------------------------------------------------
// Benchmarks — state + national context for stat tiles (issue #411)
// ---------------------------------------------------------------------------

export interface BenchmarkBucket {
  median: number;
  count: number;
}

export interface NationalBenchmarkBucket extends BenchmarkBucket {
  percentiles: Record<string, number>;
}

interface ScorecardBenchmarks {
  generatedAt: string;
  totalColleges: number;
  national: Record<string, NationalBenchmarkBucket>;
  byState: Record<string, Record<string, BenchmarkBucket>>;
}

let benchmarksCache: ScorecardBenchmarks | null | undefined;

function loadBenchmarks(): ScorecardBenchmarks | null {
  if (benchmarksCache !== undefined) return benchmarksCache;
  const p = path.join(process.cwd(), "data", "_benchmarks", "scorecard.json");
  if (!fs.existsSync(p)) {
    benchmarksCache = null;
    return null;
  }
  try {
    benchmarksCache = JSON.parse(
      fs.readFileSync(p, "utf-8"),
    ) as ScorecardBenchmarks;
    return benchmarksCache;
  } catch {
    benchmarksCache = null;
    return null;
  }
}

/**
 * Return benchmark stats for a metric. Pass `state` for per-state median,
 * omit for the national median. Returns null when benchmarks are missing
 * or the metric/state combination has insufficient data.
 */
export function getBenchmark(
  metric: string,
  state?: string,
): BenchmarkBucket | null {
  const b = loadBenchmarks();
  if (!b) return null;
  if (state) return b.byState[state.toLowerCase()]?.[metric] ?? null;
  return b.national[metric] ?? null;
}

/**
 * Approximate percentile rank of `value` within the national CC
 * distribution for `metric`. Returns 0–100 (e.g. 73 means "higher than
 * 73% of US community colleges"). Uses linear interpolation between the
 * stored p5…p95 breakpoints.
 */
export function getNationalPercentileRank(
  metric: string,
  value: number,
): number | null {
  const b = loadBenchmarks();
  if (!b) return null;
  const nat = b.national[metric];
  if (!nat?.percentiles) return null;

  const pcts = Object.entries(nat.percentiles)
    .map(([k, v]) => [Number(k), v] as [number, number])
    .sort((a, b) => a[0] - b[0]);

  if (pcts.length === 0) return null;
  if (value <= pcts[0][1]) return pcts[0][0];
  if (value >= pcts[pcts.length - 1][1]) return pcts[pcts.length - 1][0];

  for (let i = 0; i < pcts.length - 1; i++) {
    const [p1, v1] = pcts[i];
    const [p2, v2] = pcts[i + 1];
    if (value >= v1 && value <= v2) {
      if (v2 === v1) return p1;
      const t = (value - v1) / (v2 - v1);
      return Math.round(p1 + t * (p2 - p1));
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-program (CIP) reader — issue #406
// ---------------------------------------------------------------------------

import type { ScorecardProgramRecord } from "@/scripts/lib/college-scorecard";

export type { ScorecardProgramRecord };

const programsCache = new Map<string, ScorecardProgramRecord[] | null>();

function programsPath(state: string, collegeId: string): string {
  return path.join(
    process.cwd(),
    "data",
    state,
    "scorecard-programs",
    `${collegeId}.json`,
  );
}

/**
 * Return all per-program outcome records for one college, or null when
 * the file is missing (college not ingested yet or no programs data
 * exists). Empty array means we tried but the school had no programs in
 * Scorecard at the CC credential levels (1 or 2).
 */
export function getScorecardPrograms(
  state: string,
  collegeId: string,
): ScorecardProgramRecord[] | null {
  const key = `${state}:${collegeId}`;
  const cached = programsCache.get(key);
  if (cached !== undefined) return cached;

  const p = programsPath(state, collegeId);
  if (!fs.existsSync(p)) {
    programsCache.set(key, null);
    return null;
  }
  try {
    const parsed = JSON.parse(
      fs.readFileSync(p, "utf-8"),
    ) as ScorecardProgramRecord[];
    programsCache.set(key, parsed);
    return parsed;
  } catch {
    programsCache.set(key, null);
    return null;
  }
}

/**
 * Pick the most-relevant per-program record at a college for a set of
 * CIP codes (e.g. `["5138", "5139", "5116"]` for Nursing). Returns the
 * record with the most awards/year — picks the dominant CC track rather
 * than a niche related certificate.
 */
export function getScorecardProgramForCips(
  state: string,
  collegeId: string,
  cips: string[],
): ScorecardProgramRecord | null {
  if (cips.length === 0) return null;
  const all = getScorecardPrograms(state, collegeId);
  if (!all || all.length === 0) return null;
  const cipSet = new Set(cips);
  const matches = all.filter((p) => cipSet.has(p.cipCode));
  if (matches.length === 0) return null;
  matches.sort((a, b) => {
    const awA = (a.awardsLevel2 ?? 0) + (a.awardsLevel1 ?? 0);
    const awB = (b.awardsLevel2 ?? 0) + (b.awardsLevel1 ?? 0);
    return awB - awA;
  });
  return matches[0];
}

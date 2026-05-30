/**
 * Compute state + national benchmarks from existing per-college Scorecard
 * data. Reads every `data/{state}/scorecard/*.json`, filters to public
 * community colleges, and emits `data/_benchmarks/scorecard.json`.
 *
 * Usage:  tsx scripts/build-benchmarks.ts
 *
 * Issue #411. The output file is committed — run this script whenever
 * scorecard data is re-ingested (roughly annually after the October
 * Scorecard refresh).
 */

import fs from "fs";
import path from "path";

import type { ScorecardRecord } from "@/scripts/lib/college-scorecard";

// ── Metric extractors ────────────────────────────────────────────────

type Extractor = (r: ScorecardRecord) => number | null | undefined;

const METRICS: Record<string, Extractor> = {
  tuitionInState: (r) => r.cost.tuitionInState,
  avgNetPrice: (r) => r.cost.avgNetPricePublic,
  pellRate: (r) => r.aid.pellGrantRate,
  completionRate150: (r) => r.completion.completionRate150nt,
  completionRate200: (r) => r.completion.completionRate200nt,
  retentionFt: (r) => r.completion.retentionRateFullTime,
  transferRate: (r) => r.completion.transferRate,
  earnings1Yr: (r) => r.earnings.median1YrAfterCompletion,
  earnings10Yr: (r) => r.earnings.median10YrsAfterEntry,
  aboveHsGrad: (r) => r.earnings.shareEarningAboveHsGrad,
  medianDebt: (r) => r.aid.medianDebtCompleters,
};

// ── Stats helpers ────────────────────────────────────────────────────

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function percentileValue(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

interface BenchmarkBucket {
  median: number;
  count: number;
}

interface NationalBenchmarkBucket extends BenchmarkBucket {
  percentiles: Record<string, number>;
}

// ── Load all scorecard records ───────────────────────────────────────

function loadAllRecords(): Map<string, ScorecardRecord[]> {
  const dataDir = path.join(process.cwd(), "data");
  const byState = new Map<string, ScorecardRecord[]>();

  for (const entry of fs.readdirSync(dataDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
    const scDir = path.join(dataDir, entry.name, "scorecard");
    if (!fs.existsSync(scDir)) continue;

    const records: ScorecardRecord[] = [];
    for (const file of fs.readdirSync(scDir)) {
      if (!file.endsWith(".json")) continue;
      try {
        const r = JSON.parse(
          fs.readFileSync(path.join(scDir, file), "utf-8"),
        ) as ScorecardRecord;
        if (r.ownership === 1) records.push(r);
      } catch {
        // skip malformed files
      }
    }
    if (records.length > 0) byState.set(entry.name, records);
  }
  return byState;
}

// ── Compute benchmarks ───────────────────────────────────────────────

function computeBucket(values: number[]): BenchmarkBucket | null {
  if (values.length < 3) return null;
  return { median: Math.round(median(values) * 1e6) / 1e6, count: values.length };
}

function computeNationalBucket(
  values: number[],
): NationalBenchmarkBucket | null {
  if (values.length < 3) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const percentiles: Record<string, number> = {};
  for (let p = 5; p <= 95; p += 5) {
    percentiles[String(p)] =
      Math.round(percentileValue(sorted, p) * 1e6) / 1e6;
  }
  return {
    median: Math.round(median(values) * 1e6) / 1e6,
    count: values.length,
    percentiles,
  };
}

function extractValues(records: ScorecardRecord[], extract: Extractor): number[] {
  return records
    .map(extract)
    .filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
}

// ── Main ─────────────────────────────────────────────────────────────

const byState = loadAllRecords();
const allRecords = Array.from(byState.values()).flat();

console.log(
  `Loaded ${allRecords.length} public CC records across ${byState.size} states`,
);

const national: Record<string, NationalBenchmarkBucket> = {};
const stateLevel: Record<string, Record<string, BenchmarkBucket>> = {};

for (const [key, extract] of Object.entries(METRICS)) {
  const allVals = extractValues(allRecords, extract);
  const nb = computeNationalBucket(allVals);
  if (nb) national[key] = nb;

  for (const [state, records] of byState) {
    const vals = extractValues(records, extract);
    const bucket = computeBucket(vals);
    if (bucket) {
      if (!stateLevel[state]) stateLevel[state] = {};
      stateLevel[state][key] = bucket;
    }
  }
}

const output = {
  generatedAt: new Date().toISOString(),
  totalColleges: allRecords.length,
  national,
  byState: stateLevel,
};

const outDir = path.join(process.cwd(), "data", "_benchmarks");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "scorecard.json");
fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n");

console.log(`Wrote ${outPath}`);
console.log(`  National metrics: ${Object.keys(national).length}`);
console.log(`  States with benchmarks: ${Object.keys(stateLevel).length}`);

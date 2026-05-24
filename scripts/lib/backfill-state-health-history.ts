/**
 * backfill-state-health-history.ts
 *
 * One-shot bootstrap of data/state-health/history.jsonl from past
 * scheduled-scrape runs. Run after PR #513 landed but BEFORE the CI
 * wiring PR turns on live --history-out writes — gives the
 * state-health-triage agent ~2 weeks of seed data to reason over
 * without waiting for cron ticks to accumulate.
 *
 * Two record sources:
 *
 *   1. Historical (partial detail). For each of the last ~20
 *      scheduled-scrape runs, pulls /runs/{id}/jobs and emits one
 *      record per matrix job. We get real ts, run_id, run_url,
 *      conclusion. We do NOT get status (healthy/empty) — that needs
 *      output-file inspection which we can't redo against historical
 *      state (artifacts expire after 7d, and main has moved on). Such
 *      records get status="unknown" for success and status="failed"
 *      otherwise.
 *
 *   2. Live (full detail). For each datatype, runs the live
 *      check-scrape-health.ts against the most recent successful run.
 *      Produces full-detail records with per-college lists, status,
 *      and detail — anchors the agent's "now" view.
 *
 * Records are sorted by ts ascending and written to
 * data/state-health/history.jsonl. Existing file content is
 * preserved by appending (so re-running the script extends rather
 * than replaces).
 *
 * Usage:
 *   npx tsx scripts/lib/backfill-state-health-history.ts
 *   npx tsx scripts/lib/backfill-state-health-history.ts --limit 30
 *   npx tsx scripts/lib/backfill-state-health-history.ts --dry-run
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { dirname } from "node:path";
import { execSync } from "node:child_process";

const REPO = "rohan-c0de/cc-coursemap";
const OUT = "data/state-health/history.jsonl";
const DATATYPES = ["courses", "transfers", "prereqs", "programs"] as const;
type DataType = (typeof DATATYPES)[number];

interface HealthRecord {
  ts: string;
  run_id: string;
  run_url: string;
  datatype: DataType;
  state: string;
  job_index: number;
  scripts: string[];
  conclusion: string | null;
  status: "healthy" | "empty" | "failed" | "unknown";
  detail: string;
  colleges_missing?: string[];
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  if (i + 1 >= process.argv.length || process.argv[i + 1].startsWith("--"))
    return ""; // bare flag
  return process.argv[i + 1];
}

const limit = parseInt(arg("limit") ?? "20", 10);
const dryRun = arg("dry-run") !== undefined;

// ---------------------------------------------------------------------------
// Step 1: list recent scheduled-scrape runs
// ---------------------------------------------------------------------------

interface RunSummary {
  databaseId: number;
  createdAt: string;
  conclusion: string;
}

function listRuns(): RunSummary[] {
  const out = execSync(
    `gh run list --workflow=scheduled-scrape.yml --limit ${limit} --json databaseId,createdAt,conclusion -R ${REPO}`,
    { encoding: "utf8" }
  );
  return JSON.parse(out) as RunSummary[];
}

// ---------------------------------------------------------------------------
// Step 2: extract matrix-job records from a run
// ---------------------------------------------------------------------------

interface GhJob {
  name: string;
  conclusion: string | null;
}

function fetchJobs(runId: number): GhJob[] {
  try {
    const out = execSync(
      `gh api --paginate "/repos/${REPO}/actions/runs/${runId}/jobs" --jq '.jobs[] | {name, conclusion}'`,
      { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 }
    );
    return out
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as GhJob);
  } catch (err) {
    console.error(`  ! failed to fetch jobs for run ${runId}:`, err);
    return [];
  }
}

// Matrix job display name contains the unique matrix id `<state>-<datatype>-<idx>`
// as a substring. Pattern is strict enough to ignore aggregate / health /
// notify jobs.
const MATRIX_ID_RE = /\b([a-z]{2})-(courses|transfers|prereqs|programs)-(\d+)\b/;

function recordsFromRun(run: RunSummary, jobs: GhJob[]): HealthRecord[] {
  const records: HealthRecord[] = [];
  for (const job of jobs) {
    const m = job.name.match(MATRIX_ID_RE);
    if (!m) continue;
    const [, state, dtRaw, idxStr] = m;
    const datatype = dtRaw as DataType;
    const jobIndex = parseInt(idxStr, 10);
    const conclusion = job.conclusion;
    const status: HealthRecord["status"] =
      conclusion === "success" ? "unknown" : "failed";
    records.push({
      ts: run.createdAt,
      run_id: String(run.databaseId),
      run_url: `https://github.com/${REPO}/actions/runs/${run.databaseId}`,
      datatype,
      state,
      job_index: jobIndex,
      scripts: [], // unknown for historical replay — registry may have changed
      conclusion,
      status,
      detail:
        status === "unknown"
          ? "backfill: matrix job succeeded; output check not replayed"
          : `backfill: matrix job conclusion=${conclusion}`,
    });
  }
  return records;
}

// ---------------------------------------------------------------------------
// Step 3: live "now" records via check-scrape-health.ts per datatype
// ---------------------------------------------------------------------------

function mostRecentRunForDatatype(
  records: HealthRecord[],
  dt: DataType
): string | null {
  const matching = records
    .filter((r) => r.datatype === dt)
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  return matching[0]?.run_id ?? null;
}

function liveRecordsForDatatype(dt: DataType, runId: string): HealthRecord[] {
  const tmpFile = `/tmp/backfill-live-${dt}-${Date.now()}.jsonl`;
  try {
    execSync(
      `npx tsx scripts/lib/check-scrape-health.ts --datatype ${dt} --run-id ${runId} --repo ${REPO} --history-out ${tmpFile}`,
      { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] }
    );
    if (!existsSync(tmpFile)) return [];
    const lines = readFileSync(tmpFile, "utf8")
      .split("\n")
      .filter((l) => l.trim());
    unlinkSync(tmpFile);
    const parsed = lines.map((l) => JSON.parse(l) as HealthRecord);
    // Filter out "registry/matrix mismatch" artifacts. These happen when a
    // state was added to the registry AFTER the anchoring historical run
    // executed — not a real failure, just an absence. Keeping them would
    // mislead the triage agent into thinking those states are broken.
    return parsed.filter(
      (r) => !r.detail.includes("matrix job not found in workflow run")
    );
  } catch (err) {
    console.error(`  ! live check failed for ${dt}:`, err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log(`Backfilling state-health history (limit=${limit}, dry-run=${dryRun})`);

console.log("Step 1: listing recent scheduled-scrape runs...");
const runs = listRuns();
console.log(`  → ${runs.length} runs found`);

console.log("Step 2: extracting matrix-job records from each run...");
const historical: HealthRecord[] = [];
for (const run of runs) {
  const jobs = fetchJobs(run.databaseId);
  const recs = recordsFromRun(run, jobs);
  console.log(`  run ${run.databaseId} (${run.createdAt}): ${recs.length} matrix records`);
  historical.push(...recs);
}
console.log(`  → ${historical.length} historical records total`);

console.log("Step 3: live snapshot per datatype via check-scrape-health.ts...");
const live: HealthRecord[] = [];
for (const dt of DATATYPES) {
  const runId = mostRecentRunForDatatype(historical, dt);
  if (!runId) {
    console.log(`  ${dt}: no historical runs found; skipping live snapshot`);
    continue;
  }
  const recs = liveRecordsForDatatype(dt, runId);
  console.log(`  ${dt}: ${recs.length} live records (anchored to run ${runId})`);
  live.push(...recs);
}
console.log(`  → ${live.length} live records total`);

// Merge: live records take precedence over historical for the same key
// (live has full per-college detail; historical is conclusion-only).
const keyOf = (r: HealthRecord) =>
  `${r.run_id}-${r.datatype}-${r.state}-${r.job_index}`;
const merged = new Map<string, HealthRecord>();
for (const r of historical) merged.set(keyOf(r), r);
for (const r of live) merged.set(keyOf(r), r); // overwrites historical
const all = Array.from(merged.values()).sort(
  (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
);

console.log(`Total deduped records: ${all.length}`);

const statusCounts = all.reduce<Record<string, number>>(
  (acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }),
  {} as any
);
console.log(`Status distribution: ${JSON.stringify(statusCounts)}`);

if (dryRun) {
  console.log("Dry run — not writing to disk.");
  console.log("First 3 records:");
  for (const r of all.slice(0, 3)) console.log("  " + JSON.stringify(r));
  process.exit(0);
}

mkdirSync(dirname(OUT), { recursive: true });
const lines = all.map((r) => JSON.stringify(r)).join("\n") + "\n";
appendFileSync(OUT, lines);
console.log(`Wrote ${all.length} records to ${OUT}`);

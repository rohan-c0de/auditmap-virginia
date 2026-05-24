/**
 * check-scrape-health.ts
 *
 * Per-cron-tick health check for scheduled scraping (issue #120).
 *
 * Runs in the `aggregate` job of scheduled-scrape.yml after the matrix
 * completes. For the cron's datatype, classifies every (state × scraper)
 * pair declared in the registry as:
 *
 *   ✅ healthy  — matrix job succeeded AND expected output exists / non-empty
 *   ⚠️ empty    — matrix job succeeded but output is missing or empty
 *   ❌ failed   — matrix job exited non-zero (or never ran)
 *
 * Two outputs:
 *   - Markdown report on stdout (rolling-issue body, Actions log)
 *   - JSON status to --status-out (read by the workflow to decide whether
 *     to open/update/close the rolling issue)
 *
 * The website is only useful if the data is current. Anything that lets
 * the cron run without producing fresh data must surface as ⚠️ or ❌.
 *
 * Usage (from the aggregate job):
 *   npx tsx scripts/lib/check-scrape-health.ts \
 *     --datatype courses \
 *     --run-id "$GITHUB_RUN_ID" \
 *     --repo "$GITHUB_REPOSITORY" \
 *     --data-dir data \
 *     --status-out /tmp/health.json
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { execSync } from "node:child_process";
import { getAllStates } from "../../lib/states/registry";
import type { ScrapeJob, ScraperCoverage } from "../../lib/states/registry";

type DataType = "courses" | "transfers" | "prereqs" | "programs";
type Status = "healthy" | "empty" | "failed";

interface JobResult {
  state: string;
  datatype: DataType;
  jobIndex: number; // matrix entry index within (state, datatype)
  scripts: string[];
  conclusion: string | null; // "success", "failure", "cancelled", or null if missing
  status: Status;
  detail: string;
  // Per-college presence (set for courses/programs only). Lets downstream
  // tooling (state-health history, drift triage) reason about per-college
  // drift instead of just "N of M colleges have data".
  collegesWithData?: string[];
  collegesMissing?: string[];
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function arg(name: string, required = true): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || !process.argv[i + 1]) {
    if (required) {
      console.error(`Missing required --${name}`);
      process.exit(2);
    }
    return "";
  }
  return process.argv[i + 1];
}

const datatype = arg("datatype") as DataType;
const runId = arg("run-id");
const repo = arg("repo");
const dataDir = arg("data-dir", false) || "data";
const statusOut = arg("status-out", false);
const historyOut = arg("history-out", false);

if (!["courses", "transfers", "prereqs", "programs"].includes(datatype)) {
  console.error(`Invalid --datatype: ${datatype}`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Registry → declared jobs
// ---------------------------------------------------------------------------

function jobsFor(scrapers: ScraperCoverage, dt: DataType): ScrapeJob[] {
  if (dt === "courses") return scrapers.courses ?? [];
  if (dt === "transfers") return scrapers.transfers ?? [];
  if (dt === "programs") return scrapers.programs ?? [];
  const p = scrapers.prereqs;
  // `aggregate-from-courses` states have no separate scrape job; nothing to
  // schedule and so nothing to check here.
  if (!p || !Array.isArray(p)) return [];
  return p;
}

interface DeclaredJob {
  state: string;
  jobIndex: number;
  scripts: string[];
  matrixId: string;
}

function collectDeclaredJobs(): DeclaredJob[] {
  const out: DeclaredJob[] = [];
  for (const cfg of getAllStates()) {
    if (!cfg.scrapers) continue;
    const jobs = jobsFor(cfg.scrapers, datatype);
    jobs.forEach((job, i) => {
      out.push({
        state: cfg.slug,
        jobIndex: i,
        scripts: job.scripts,
        matrixId: `${cfg.slug}-${datatype}-${i}`,
      });
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// GitHub Actions per-job result lookup
// ---------------------------------------------------------------------------

interface GhJob {
  name: string;
  conclusion: string | null;
}

function fetchRunJobs(): GhJob[] {
  // gh CLI paginates automatically with --paginate; cap output via jq.
  // Workflow runs with large matrices can have 100+ jobs, so paginate.
  try {
    const out = execSync(
      `gh api --paginate "/repos/${repo}/actions/runs/${runId}/jobs" --jq '.jobs[] | {name, conclusion}'`,
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
    );
    // --jq with one object per line; wrap into an array.
    return out
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as GhJob);
  } catch (err) {
    console.error("Failed to fetch run jobs from gh API:", err);
    return [];
  }
}

/**
 * Find the matrix-entry job for a given declared scraper job.
 *
 * GitHub Actions names matrix-entry jobs `<job-id> (<matrix-value>, ...)`.
 * Our matrix has multiple keys (id, state, datatype, runner, scripts,
 * termSystem) so the displayed name varies — but the unique `id` field
 * (e.g. `va-courses-0`) always appears. Match by substring.
 */
function findJobConclusion(matrixId: string, jobs: GhJob[]): string | null {
  const hit = jobs.find((j) => j.name.includes(matrixId));
  return hit?.conclusion ?? null;
}

// ---------------------------------------------------------------------------
// Per-datatype output checks
// ---------------------------------------------------------------------------

interface OutputCheck {
  ok: boolean;
  detail: string;
  collegesWithData?: string[];
  collegesMissing?: string[];
}

// Cap on how many missing college slugs to inline into the detail string. The
// full list always goes to JSON; the markdown summary stays scannable.
const DETAIL_MISSING_CAP = 5;

function formatMissingList(missing: string[]): string {
  if (missing.length <= DETAIL_MISSING_CAP) return missing.join(", ");
  const head = missing.slice(0, DETAIL_MISSING_CAP).join(", ");
  return `${head} (+${missing.length - DETAIL_MISSING_CAP} more)`;
}

function checkCoursesOutput(state: string): OutputCheck {
  const dir = join(dataDir, state, "courses");
  if (!existsSync(dir)) {
    return { ok: false, detail: "no courses directory" };
  }
  const colleges = readdirSync(dir)
    .filter((entry) => {
      const full = join(dir, entry);
      return statSync(full).isDirectory();
    })
    .sort();
  if (colleges.length === 0) {
    return { ok: false, detail: "no college subdirectories" };
  }
  // Look for at least one non-trivial JSON file across the colleges.
  // "Non-trivial" = >100 bytes (an empty array is "[]" = 2 bytes; a single
  // section is well over 100). Catches both "no file written" and "wrote
  // [] because parser saw a login redirect."
  const collegesWithData: string[] = [];
  const collegesMissing: string[] = [];
  for (const college of colleges) {
    const collegeDir = join(dir, college);
    const files = readdirSync(collegeDir).filter((f) => f.endsWith(".json"));
    const hasData = files.some((f) => {
      const sz = statSync(join(collegeDir, f)).size;
      return sz > 100;
    });
    if (hasData) collegesWithData.push(college);
    else collegesMissing.push(college);
  }
  if (collegesWithData.length === 0) {
    return {
      ok: false,
      detail: `${colleges.length} college dir(s) but all course files <100 bytes`,
      collegesWithData,
      collegesMissing,
    };
  }
  if (collegesMissing.length > 0) {
    return {
      ok: true,
      detail: `${collegesWithData.length}/${colleges.length} colleges have data; missing: ${formatMissingList(collegesMissing)}`,
      collegesWithData,
      collegesMissing,
    };
  }
  return {
    ok: true,
    detail: `${collegesWithData.length} college(s) with data`,
    collegesWithData,
    collegesMissing,
  };
}

function checkSingleFileOutput(state: string, filename: string): OutputCheck {
  const path = join(dataDir, state, filename);
  if (!existsSync(path)) {
    return { ok: false, detail: `${filename} missing` };
  }
  const size = statSync(path).size;
  if (size <= 100) {
    return { ok: false, detail: `${filename} is empty (${size} bytes)` };
  }
  return { ok: true, detail: `${filename} present (${size} bytes)` };
}

function checkProgramsOutput(state: string): OutputCheck {
  const dir = join(dataDir, state, "programs");
  if (!existsSync(dir)) {
    return { ok: false, detail: "no programs directory" };
  }
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  if (files.length === 0) {
    return { ok: false, detail: "no program JSON files" };
  }
  const collegesWithData: string[] = [];
  const collegesMissing: string[] = [];
  for (const f of files) {
    const slug = f.replace(/\.json$/, "");
    if (statSync(join(dir, f)).size > 100) collegesWithData.push(slug);
    else collegesMissing.push(slug);
  }
  if (collegesWithData.length === 0) {
    return {
      ok: false,
      detail: `${files.length} file(s) but all <100 bytes`,
      collegesWithData,
      collegesMissing,
    };
  }
  if (collegesMissing.length > 0) {
    return {
      ok: true,
      detail: `${collegesWithData.length}/${files.length} colleges with program data; missing: ${formatMissingList(collegesMissing)}`,
      collegesWithData,
      collegesMissing,
    };
  }
  return {
    ok: true,
    detail: `${collegesWithData.length} college(s) with program data`,
    collegesWithData,
    collegesMissing,
  };
}

function checkOutput(state: string, scripts: string[]): OutputCheck {
  if (datatype === "courses") return checkCoursesOutput(state);
  if (datatype === "transfers")
    return checkSingleFileOutput(state, "transfer-equiv.json");
  if (datatype === "prereqs") return checkSingleFileOutput(state, "prereqs.json");
  if (datatype === "programs") return checkProgramsOutput(state);
  return { ok: false, detail: `unknown datatype ${datatype}` };
}

// ---------------------------------------------------------------------------
// Classification + reporting
// ---------------------------------------------------------------------------

function classify(declared: DeclaredJob, conclusion: string | null): JobResult {
  if (conclusion === null) {
    return {
      state: declared.state,
      datatype,
      jobIndex: declared.jobIndex,
      scripts: declared.scripts,
      conclusion,
      status: "failed",
      detail: "matrix job not found in workflow run (registry/matrix mismatch)",
    };
  }
  if (conclusion !== "success") {
    return {
      state: declared.state,
      datatype,
      jobIndex: declared.jobIndex,
      scripts: declared.scripts,
      conclusion,
      status: "failed",
      detail: `matrix job conclusion=${conclusion}`,
    };
  }
  const out = checkOutput(declared.state, declared.scripts);
  return {
    state: declared.state,
    datatype,
    jobIndex: declared.jobIndex,
    scripts: declared.scripts,
    conclusion,
    status: out.ok ? "healthy" : "empty",
    detail: out.detail,
    collegesWithData: out.collegesWithData,
    collegesMissing: out.collegesMissing,
  };
}

function emoji(s: Status): string {
  return s === "healthy" ? "✅" : s === "empty" ? "⚠️" : "❌";
}

function renderMarkdown(results: JobResult[]): string {
  const counts = {
    healthy: results.filter((r) => r.status === "healthy").length,
    empty: results.filter((r) => r.status === "empty").length,
    failed: results.filter((r) => r.status === "failed").length,
  };
  const lines: string[] = [];
  lines.push(`# Scraper health — ${datatype}`);
  lines.push("");
  lines.push(
    `**${counts.healthy} healthy · ${counts.empty} empty · ${counts.failed} failed** (of ${results.length} declared)`
  );
  lines.push("");
  lines.push(`Workflow run: https://github.com/${repo}/actions/runs/${runId}`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");

  // Group: failures first, then empty, then healthy.
  const order: Status[] = ["failed", "empty", "healthy"];
  for (const status of order) {
    const group = results.filter((r) => r.status === status);
    if (group.length === 0) continue;
    lines.push(`## ${emoji(status)} ${status} (${group.length})`);
    lines.push("");
    lines.push("| State | Scripts | Detail |");
    lines.push("| --- | --- | --- |");
    for (const r of group) {
      const scripts = r.scripts.map((s) => `\`${s}\``).join("<br>");
      lines.push(`| \`${r.state}\` | ${scripts} | ${r.detail} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const declared = collectDeclaredJobs();
const ghJobs = fetchRunJobs();
const results = declared.map((d) => classify(d, findJobConclusion(d.matrixId, ghJobs)));

const md = renderMarkdown(results);
console.log(md);

if (statusOut) {
  const counts = {
    healthy: results.filter((r) => r.status === "healthy").length,
    empty: results.filter((r) => r.status === "empty").length,
    failed: results.filter((r) => r.status === "failed").length,
  };
  const allHealthy = counts.empty === 0 && counts.failed === 0;
  writeFileSync(
    statusOut,
    JSON.stringify(
      { datatype, allHealthy, counts, results, markdown: md },
      null,
      2
    )
  );
}

// ---------------------------------------------------------------------------
// History append (state-health drift triage; issue #TBD)
// ---------------------------------------------------------------------------
//
// Each cron tick appends one JSON object per declared (state × scraper job).
// Append-only JSONL so parallel datatype writes don't conflict at the line
// level. Schema matches JobResult plus run metadata so the file is the
// canonical time-series of scraper health across all datatypes.

if (historyOut) {
  const ts = new Date().toISOString();
  const runUrl = `https://github.com/${repo}/actions/runs/${runId}`;
  mkdirSync(dirname(historyOut), { recursive: true });
  const lines = results
    .map((r) =>
      JSON.stringify({
        ts,
        run_id: runId,
        run_url: runUrl,
        datatype: r.datatype,
        state: r.state,
        job_index: r.jobIndex,
        scripts: r.scripts,
        conclusion: r.conclusion,
        status: r.status,
        detail: r.detail,
        // Per-college missing list (courses/programs only). The full
        // colleges_with_data array is intentionally NOT persisted — over a
        // year of cron ticks it would balloon history.jsonl by ~90 MB for no
        // analytical gain. The denominator and full college list are derived
        // from data/{state}/institutions.json at read time.
        ...(r.collegesMissing
          ? { colleges_missing: r.collegesMissing }
          : {}),
      })
    )
    .join("\n");
  appendFileSync(historyOut, lines + "\n");
}

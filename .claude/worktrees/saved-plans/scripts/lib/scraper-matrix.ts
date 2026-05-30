/**
 * scraper-matrix.ts — emits a GitHub Actions matrix JSON for one data type.
 *
 * Reads `getAllStates()` and pulls every `ScrapeJob` registered for the
 * requested data type. Each `ScrapeJob` becomes one matrix entry (a single
 * runner instance) that runs its `scripts` array sequentially.
 *
 * Usage:
 *   npx tsx scripts/lib/scraper-matrix.ts --datatype courses
 *   npx tsx scripts/lib/scraper-matrix.ts --datatype prereqs --mode states
 *
 * Modes:
 *   --mode scrape (default) — emits `{"include":[...]}` for `strategy.matrix`
 *     of the scrape job. One entry per registered ScrapeJob.
 *   --mode states — emits `{"states":["va","nj",...]}` of every state with
 *     anything to aggregate for this datatype. Drives the per-state aggregate
 *     matrix (issue #169). Includes both states with explicit ScrapeJobs and
 *     prereqs-via-`aggregate-from-courses` states whose prereqs.json is
 *     refreshed from already-committed course data each tick.
 *
 * `scripts` is a newline-separated string so the workflow can pipe it
 * through `xargs` — GitHub Actions matrix entries don't support arrays.
 */

import { getAllStates } from "../../lib/states/registry";
import type { ScrapeJob, ScraperCoverage } from "../../lib/states/registry";

type DataType = "courses" | "transfers" | "prereqs" | "programs";

const args = process.argv.slice(2);
const dtIdx = args.indexOf("--datatype");
const datatype = (dtIdx >= 0 ? args[dtIdx + 1] : null) as DataType | null;
if (!datatype || !["courses", "transfers", "prereqs", "programs"].includes(datatype)) {
  console.error("Usage: scraper-matrix.ts --datatype courses|transfers|prereqs|programs [--mode scrape|states]");
  process.exit(1);
}
const modeIdx = args.indexOf("--mode");
const mode = (modeIdx >= 0 ? args[modeIdx + 1] : "scrape") as "scrape" | "states";

function jobsFor(scrapers: ScraperCoverage, dt: DataType): ScrapeJob[] {
  if (dt === "courses") return scrapers.courses ?? [];
  if (dt === "transfers") return scrapers.transfers ?? [];
  if (dt === "programs") return scrapers.programs ?? [];
  const p = scrapers.prereqs;
  // `aggregate-from-courses` states have no separate scrape job — the
  // courses scrape already captured `prerequisite_text` per section and a
  // separate aggregation step runs at import time. Nothing to schedule here.
  if (!p || !Array.isArray(p)) return [];
  return p;
}

function aggregatesFor(scrapers: ScraperCoverage, dt: DataType): boolean {
  if (jobsFor(scrapers, dt).length > 0) return true;
  // Prereqs-via-aggregate-from-courses still produces a per-tick prereqs.json
  // diff and so needs a per-state aggregate runner even though no scrape ran.
  if (dt === "prereqs") {
    const p = scrapers.prereqs;
    if (p && !Array.isArray(p) && p.source === "aggregate-from-courses") return true;
  }
  return false;
}

interface MatrixEntry {
  id: string;
  state: string;
  datatype: DataType;
  runner: "http" | "playwright";
  /** Newline-joined so the workflow can iterate via `while read`. */
  scripts: string;
  /** Term-resolution system (see resolve-terms.ts). Empty string when not needed. */
  termSystem: string;
}

if (mode === "states") {
  const states: string[] = [];
  for (const cfg of getAllStates()) {
    if (!cfg.scrapers) continue;
    if (aggregatesFor(cfg.scrapers, datatype)) states.push(cfg.slug);
  }
  console.log(JSON.stringify({ states }));
} else {
  const include: MatrixEntry[] = [];
  for (const cfg of getAllStates()) {
    if (!cfg.scrapers) continue;
    const jobs = jobsFor(cfg.scrapers, datatype);
    jobs.forEach((job, i) => {
      include.push({
        id: `${cfg.slug}-${datatype}-${i}`,
        state: cfg.slug,
        datatype,
        runner: job.runner,
        scripts: job.scripts.join("\n"),
        termSystem: job.termSystem ?? "",
      });
    });
  }
  // Matrix must be emitted as a single JSON line — GitHub Actions' `fromJSON`
  // doesn't accept pretty-printed input reliably inside ${{ }}.
  console.log(JSON.stringify({ include }));
}

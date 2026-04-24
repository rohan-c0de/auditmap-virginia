/**
 * scraper-matrix.ts — emits a GitHub Actions matrix JSON for one data type.
 *
 * Reads `getAllStates()` and pulls every `ScrapeJob` registered for the
 * requested data type. Each `ScrapeJob` becomes one matrix entry (a single
 * runner instance) that runs its `scripts` array sequentially.
 *
 * Usage:
 *   npx tsx scripts/lib/scraper-matrix.ts --datatype courses
 *
 * Output (single-line JSON to stdout; consumed via `fromJSON()` in a
 * workflow's `strategy.matrix`):
 *   {"include":[{"state":"va","scripts":"scripts/va/scrape-vccs.ts","runner":"http","id":"va-courses-0"}, ...]}
 *
 * `scripts` is a newline-separated string so the workflow can pipe it
 * through `xargs` — GitHub Actions matrix entries don't support arrays.
 */

import { getAllStates } from "../../lib/states/registry";
import type { ScrapeJob, ScraperCoverage } from "../../lib/states/registry";

type DataType = "courses" | "transfers" | "prereqs";

const args = process.argv.slice(2);
const dtIdx = args.indexOf("--datatype");
const datatype = (dtIdx >= 0 ? args[dtIdx + 1] : null) as DataType | null;
if (!datatype || !["courses", "transfers", "prereqs"].includes(datatype)) {
  console.error("Usage: scraper-matrix.ts --datatype courses|transfers|prereqs");
  process.exit(1);
}

function jobsFor(scrapers: ScraperCoverage, dt: DataType): ScrapeJob[] {
  if (dt === "courses") return scrapers.courses ?? [];
  if (dt === "transfers") return scrapers.transfers ?? [];
  const p = scrapers.prereqs;
  // `aggregate-from-courses` states have no separate scrape job — the
  // courses scrape already captured `prerequisite_text` per section and a
  // separate aggregation step runs at import time. Nothing to schedule here.
  if (!p || !Array.isArray(p)) return [];
  return p;
}

interface MatrixEntry {
  id: string;
  state: string;
  datatype: DataType;
  runner: "http" | "playwright";
  /** Newline-joined so the workflow can iterate via `while read`. */
  scripts: string;
}

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
    });
  });
}

// Matrix must be emitted as a single JSON line — GitHub Actions' `fromJSON`
// doesn't accept pretty-printed input reliably inside ${{ }}.
console.log(JSON.stringify({ include }));

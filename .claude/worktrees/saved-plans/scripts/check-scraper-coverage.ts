/**
 * Scraper-coverage integrity check (issues #59, #111).
 *
 * For every state in `getAllStates()`, every data type in
 * {courses, transfers, prereqs} must be either:
 *   - declared in `scrapers.<datatype>` (a non-empty job array, or
 *     `{ source: "aggregate-from-courses" }` for prereqs), OR
 *   - explicitly opted out via a marker comment in the config file:
 *       `// manual-only: <datatype> — <reason>`           (per-datatype)
 *     or, when `scrapers` is omitted entirely:
 *       `// manual-only: <reason>`                         (blanket)
 *
 * Also verifies every declared script path resolves on disk — a typo
 * silently breaks the unified scheduled-scrape workflow at runtime.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getAllStates, type ScraperCoverage } from "../lib/states/registry";

const ROOT = resolve(__dirname, "..");
const DATATYPES = ["courses", "transfers", "prereqs", "programs"] as const;
type Datatype = (typeof DATATYPES)[number];

const errors: string[] = [];

function err(slug: string, msg: string) {
  errors.push(`[${slug}] ${msg}`);
}

function isDeclared(scrapers: ScraperCoverage | undefined, dt: Datatype): boolean {
  if (!scrapers) return false;
  const entry = scrapers[dt];
  if (!entry) return false;
  if (Array.isArray(entry)) return entry.length > 0;
  // prereqs can be `{ source: "aggregate-from-courses" }`
  return entry.source === "aggregate-from-courses";
}

function hasDatatypeMarker(source: string, dt: Datatype): boolean {
  return new RegExp(`manual-only:\\s*${dt}\\b`, "i").test(source);
}

function hasBlanketMarker(source: string): boolean {
  // A `manual-only:` whose next non-whitespace token is NOT a datatype keyword.
  return /manual-only:(?!\s*(?:courses|transfers|prereqs|programs)\b)/i.test(source);
}

function declaredScriptPaths(scrapers: ScraperCoverage): string[] {
  const paths: string[] = [];
  for (const job of scrapers.courses ?? []) paths.push(...job.scripts);
  for (const job of scrapers.transfers ?? []) paths.push(...job.scripts);
  if (Array.isArray(scrapers.prereqs)) {
    for (const job of scrapers.prereqs) paths.push(...job.scripts);
  }
  for (const job of scrapers.programs ?? []) paths.push(...job.scripts);
  return paths;
}

for (const cfg of getAllStates()) {
  const { slug } = cfg;
  const configPath = resolve(ROOT, `lib/states/${slug}/config.ts`);
  if (!existsSync(configPath)) {
    err(slug, `lib/states/${slug}/config.ts missing (also caught by check-registry-integrity)`);
    continue;
  }

  const source = readFileSync(configPath, "utf8");
  const blanket = !cfg.scrapers && hasBlanketMarker(source);

  for (const dt of DATATYPES) {
    if (isDeclared(cfg.scrapers, dt)) continue;
    if (blanket) continue;
    if (hasDatatypeMarker(source, dt)) continue;
    err(
      slug,
      `${dt} is neither declared in \`scrapers.${dt}\` nor marked \`// manual-only: ${dt} — <reason>\` in config. See issue #111.`
    );
  }

  if (cfg.scrapers) {
    for (const script of declaredScriptPaths(cfg.scrapers)) {
      if (!existsSync(resolve(ROOT, script))) {
        err(slug, `declared scraper script "${script}" does not exist`);
      }
    }
  }
}

if (errors.length > 0) {
  console.error("Scraper-coverage check FAILED:\n");
  for (const line of errors) console.error("  " + line);
  console.error(
    `\n${errors.length} issue(s) across ${getAllStates().length} registered state(s).`
  );
  console.error(
    "\nEvery state × {courses, transfers, prereqs, programs} must either be declared in `scrapers` or carry a `manual-only:` marker. See issues #59 and #111."
  );
  process.exit(1);
}

console.log(
  `Scraper-coverage OK — ${getAllStates().length} states × ${DATATYPES.length} datatypes accounted for.`
);

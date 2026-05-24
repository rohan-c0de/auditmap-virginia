/**
 * refingerprint-sweep.ts
 *
 * Periodic re-fingerprint of every college in every currently-supported
 * state. Diffs against a committed baseline (data/state-health/
 * fingerprint-baseline.json) to detect SIS migrations BEFORE they break
 * the scheduled scrapers.
 *
 * Read-only: no scraping, no course data touched. Just HEAD/GET probes
 * against each college's primary URL to classify SIS platform.
 *
 * Output:
 *   data/state-health/fingerprint-baseline.json — overwrites with the
 *     latest sweep. Append-style would balloon over time without giving
 *     useful history (the relevant signal is "did this college's platform
 *     change since last sweep?", not "what was it 18 months ago?").
 *   /tmp/refingerprint-diff.json (optional via --diff-out) — the diff
 *     workflow reads to decide whether to open an issue.
 *
 * Cadence: monthly via .github/workflows/refingerprint-sweep.yml. Catches
 * SIS migrations within ~30 days instead of the indefinite delay between
 * "scraper started returning empty" and human investigation.
 *
 * Usage:
 *   npx tsx scripts/lib/refingerprint-sweep.ts
 *   npx tsx scripts/lib/refingerprint-sweep.ts --states nc,sc,ma
 *   npx tsx scripts/lib/refingerprint-sweep.ts --diff-out /tmp/diff.json
 *   npx tsx scripts/lib/refingerprint-sweep.ts --concurrency 4
 *   npx tsx scripts/lib/refingerprint-sweep.ts --dry-run
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { getAllStates } from "../../lib/states/registry";
import { fingerprint, type Platform } from "./fingerprint-college";

const BASELINE_PATH = "data/state-health/fingerprint-baseline.json";

interface CollegeEntry {
  state: string;
  slug: string;
  name: string;
  primaryUrl: string;
  platform: Platform;
  confidence: "high" | "medium" | "low";
  lastChecked: string; // ISO8601
}

interface Baseline {
  generatedAt: string;
  perCollege: Record<string, CollegeEntry>; // key: `${state}-${slug}`
  totals: {
    statesSwept: number;
    collegesFingerprinted: number;
    byPlatform: Record<string, number>;
  };
}

interface DiffEntry {
  state: string;
  slug: string;
  name: string;
  fromPlatform: Platform;
  toPlatform: Platform;
  fromConfidence: string;
  toConfidence: string;
  primaryUrl: string;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  return process.argv[i + 1] ?? fallback;
}

const statesArg = arg("states");
const diffOut = arg("diff-out");
const concurrency = parseInt(arg("concurrency") ?? "4", 10);
const dryRun = process.argv.includes("--dry-run");

const targetStates = statesArg
  ? statesArg.split(",").map((s) => s.trim().toLowerCase())
  : getAllStates().map((c) => c.slug);

// ---------------------------------------------------------------------------
// Load institutions and existing baseline
// ---------------------------------------------------------------------------

interface InstitutionEntry {
  id?: string;
  college_slug?: string;
  slug?: string;
  name?: string;
  homepage_url?: string;
  url?: string;
  primaryUrl?: string;
  website?: string;
  [k: string]: unknown;
}

function loadInstitutions(state: string): InstitutionEntry[] {
  const path = join("data", state, "institutions.json");
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    if (Array.isArray(data)) return data;
    return data.institutions ?? data.colleges ?? [];
  } catch {
    return [];
  }
}

function institutionUrl(inst: InstitutionEntry): string | null {
  return (inst.homepage_url ?? inst.primaryUrl ?? inst.url ?? inst.website ?? null) as string | null;
}

function institutionSlug(inst: InstitutionEntry): string | null {
  return (inst.college_slug ?? inst.slug ?? inst.id ?? null) as string | null;
}

function loadBaseline(): Baseline | null {
  if (!existsSync(BASELINE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Sweep loop with bounded concurrency
// ---------------------------------------------------------------------------

interface SweepTask {
  state: string;
  slug: string;
  name: string;
  url: string;
}

async function runSweep(tasks: SweepTask[]): Promise<CollegeEntry[]> {
  const out: CollegeEntry[] = [];
  let next = 0;
  let done = 0;

  async function worker(): Promise<void> {
    while (next < tasks.length) {
      const idx = next++;
      const t = tasks[idx];
      try {
        const result = await fingerprint(t.url);
        out.push({
          state: t.state,
          slug: t.slug,
          name: t.name,
          primaryUrl: t.url,
          platform: result.platform,
          confidence: result.confidence,
          lastChecked: new Date().toISOString(),
        });
      } catch (err) {
        out.push({
          state: t.state,
          slug: t.slug,
          name: t.name,
          primaryUrl: t.url,
          platform: "unknown" as Platform,
          confidence: "low",
          lastChecked: new Date().toISOString(),
        });
      }
      done++;
      if (done % 25 === 0 || done === tasks.length) {
        console.log(`  ${done}/${tasks.length} fingerprinted`);
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);
  return out;
}

// ---------------------------------------------------------------------------
// Build / write baseline
// ---------------------------------------------------------------------------

function recomputeTotals(perCollege: Record<string, CollegeEntry>): Baseline["totals"] {
  const byPlatform: Record<string, number> = {};
  const states = new Set<string>();
  for (const e of Object.values(perCollege)) {
    states.add(e.state);
    byPlatform[e.platform] = (byPlatform[e.platform] ?? 0) + 1;
  }
  return {
    statesSwept: states.size,
    collegesFingerprinted: Object.keys(perCollege).length,
    byPlatform,
  };
}

// ---------------------------------------------------------------------------
// Compute diff
// ---------------------------------------------------------------------------

function computeDiff(prev: Baseline | null, current: CollegeEntry[]): DiffEntry[] {
  if (!prev) return []; // first run — nothing to diff against
  const diffs: DiffEntry[] = [];
  for (const c of current) {
    const key = `${c.state}-${c.slug}`;
    const before = prev.perCollege[key];
    if (!before) continue; // new college; not a migration, just added
    if (before.platform === c.platform) continue; // no change
    diffs.push({
      state: c.state,
      slug: c.slug,
      name: c.name,
      fromPlatform: before.platform,
      toPlatform: c.platform,
      fromConfidence: before.confidence,
      toConfidence: c.confidence,
      primaryUrl: c.primaryUrl,
    });
  }
  return diffs;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Refingerprint sweep (states=${targetStates.length}, concurrency=${concurrency}, dry-run=${dryRun})`);

  // Build task list
  const tasks: SweepTask[] = [];
  for (const state of targetStates) {
    const insts = loadInstitutions(state);
    for (const inst of insts) {
      const url = institutionUrl(inst);
      const slug = institutionSlug(inst);
      const name = (inst.name ?? slug) as string | undefined;
      if (!url || !slug) continue;
      tasks.push({ state, slug, name: name ?? slug, url });
    }
  }
  console.log(`Tasks: ${tasks.length} colleges across ${targetStates.length} states`);

  if (tasks.length === 0) {
    console.error("No tasks — empty institutions or unknown states.");
    process.exit(1);
  }

  const prev = loadBaseline();
  if (prev) {
    console.log(`Loaded prior baseline (generated ${prev.generatedAt}, ${prev.totals.collegesFingerprinted} colleges)`);
  } else {
    console.log("No prior baseline — first sweep, no diff will be emitted.");
  }

  const entries = await runSweep(tasks);
  console.log(`Fingerprinting complete: ${entries.length} entries`);

  // Merge into baseline map (keyed by `{state}-{slug}`)
  const perCollege: Record<string, CollegeEntry> = {};
  for (const e of entries) perCollege[`${e.state}-${e.slug}`] = e;

  // For states that weren't swept this run but were in the prior baseline,
  // preserve their entries (partial sweeps don't wipe history).
  if (prev) {
    for (const [k, v] of Object.entries(prev.perCollege)) {
      if (!targetStates.includes(v.state)) perCollege[k] ??= v;
    }
  }

  const baseline: Baseline = {
    generatedAt: new Date().toISOString(),
    perCollege,
    totals: recomputeTotals(perCollege),
  };

  // Diff
  const diffs = computeDiff(prev, entries);
  console.log(`\nPlatform changes detected: ${diffs.length}`);
  for (const d of diffs) {
    console.log(`  ${d.state}/${d.slug}: ${d.fromPlatform} (${d.fromConfidence}) → ${d.toPlatform} (${d.toConfidence})`);
  }

  if (diffOut) {
    writeFileSync(
      diffOut,
      JSON.stringify(
        {
          generatedAt: baseline.generatedAt,
          diffCount: diffs.length,
          diffs,
        },
        null,
        2
      )
    );
    console.log(`\nDiff written to ${diffOut}`);
  }

  if (dryRun) {
    console.log("Dry run — not writing baseline.");
    return;
  }

  mkdirSync(dirname(BASELINE_PATH), { recursive: true });
  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2));
  console.log(`Baseline written to ${BASELINE_PATH}`);
}

main().catch((err) => {
  console.error("Sweep failed:", err);
  process.exit(1);
});

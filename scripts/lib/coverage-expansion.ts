/**
 * coverage-expansion.ts
 *
 * Surfaces colleges that COULD be scraped but aren't yet. For each
 * college in data/state-health/fingerprint-baseline.json whose fingerprint
 * is a templated platform (banner-ssb-9 / banner-8 / colleague / jenzabar
 * / coursedog), checks whether course data exists for it under
 * data/{state}/courses/{slug}/. If not, surfaces it as a coverage
 * candidate.
 *
 * Two scenarios this catches:
 *   1. A college was always templated but never wired to a scraper
 *      (oversight during add-state or auto-add-state)
 *   2. A college migrated from a custom/auth-gated platform to a
 *      templated one (the refingerprint sweep catches the platform
 *      change; this catches the implication for coverage)
 *
 * Output: structured JSON (--out) for the workflow + human-readable
 * console summary. Workflow opens a rolling issue with the suggestions.
 *
 * Read-only. The user merges suggested registry edits via PRs.
 *
 * Usage:
 *   npx tsx scripts/lib/coverage-expansion.ts
 *   npx tsx scripts/lib/coverage-expansion.ts --out /tmp/coverage.json
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const BASELINE_PATH = "data/state-health/fingerprint-baseline.json";

const TEMPLATED_PLATFORMS = new Set([
  "banner-ssb-9",
  "banner-8",
  "colleague",
  "jenzabar",
  "coursedog",
]);

interface BaselineEntry {
  state: string;
  slug: string;
  name: string;
  primaryUrl: string;
  platform: string;
  confidence: "high" | "medium" | "low";
  lastChecked: string;
}

interface Baseline {
  generatedAt: string;
  perCollege: Record<string, BaselineEntry>;
  totals?: unknown;
}

interface Candidate extends BaselineEntry {
  reason: string; // why we think this is addressable
  scriptHint: string; // path of the template script we'd reuse
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  return process.argv[i + 1];
}

const outPath = arg("out");

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

function hasCourseData(state: string, slug: string): boolean {
  const dir = join("data", state, "courses", slug);
  if (!existsSync(dir)) return false;
  try {
    const stats = statSync(dir);
    if (!stats.isDirectory()) return false;
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    // Require ≥1 non-trivial file (>100 bytes) — matches the threshold the
    // health check uses for "actually has data" vs "wrote [] on login redirect."
    return files.some((f) => statSync(join(dir, f)).size > 100);
  } catch {
    return false;
  }
}

function scriptHintFor(platform: string, state: string): string {
  // We don't try to be clever about which file already exists — just
  // suggest the conventional template path. The user inspecting the
  // suggestion knows whether to extend an existing scraper or add
  // a new one.
  switch (platform) {
    case "banner-ssb-9":
      return `scripts/${state}/scrape-banner-ssb.ts`;
    case "banner-8":
      return `scripts/${state}/scrape-banner8.ts`;
    case "colleague":
      return `scripts/${state}/scrape-colleague.ts`;
    case "jenzabar":
      return `scripts/${state}/scrape-jenzabar.ts`;
    case "coursedog":
      return `scripts/${state}/scrape-coursedog.ts`;
    default:
      return `scripts/${state}/scrape-${platform}.ts`;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

if (!existsSync(BASELINE_PATH)) {
  console.error(
    `Baseline file ${BASELINE_PATH} not found. Run refingerprint-sweep.ts first (or wait for the monthly cron to populate it).`
  );
  if (outPath) {
    writeFileSync(
      outPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          candidateCount: 0,
          candidates: [],
          note: "no fingerprint baseline exists yet",
        },
        null,
        2
      )
    );
  }
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;

const candidates: Candidate[] = [];
for (const entry of Object.values(baseline.perCollege)) {
  if (!TEMPLATED_PLATFORMS.has(entry.platform)) continue;
  if (hasCourseData(entry.state, entry.slug)) continue;
  const reason =
    entry.confidence === "high"
      ? `fingerprinted as ${entry.platform} (high confidence) but no course data under data/${entry.state}/courses/${entry.slug}/`
      : `fingerprinted as ${entry.platform} (${entry.confidence} confidence) but no course data; lower confidence — verify by hand before wiring`;
  candidates.push({
    ...entry,
    reason,
    scriptHint: scriptHintFor(entry.platform, entry.state),
  });
}

candidates.sort((a, b) =>
  a.state === b.state ? a.slug.localeCompare(b.slug) : a.state.localeCompare(b.state)
);

console.log(`Coverage expansion: ${candidates.length} candidates`);
for (const c of candidates) {
  console.log(`  ${c.state}/${c.slug} (${c.platform}, ${c.confidence}) → ${c.scriptHint}`);
}

const summary = {
  generatedAt: new Date().toISOString(),
  baselineGeneratedAt: baseline.generatedAt,
  candidateCount: candidates.length,
  byPlatform: candidates.reduce<Record<string, number>>((acc, c) => {
    acc[c.platform] = (acc[c.platform] ?? 0) + 1;
    return acc;
  }, {}),
  byConfidence: candidates.reduce<Record<string, number>>((acc, c) => {
    acc[c.confidence] = (acc[c.confidence] ?? 0) + 1;
    return acc;
  }, {}),
  candidates,
};

if (outPath) {
  writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${outPath}`);
}

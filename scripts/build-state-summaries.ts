/**
 * build-state-summaries.ts — precompute per-state landing-page summaries (#946).
 *
 * Runs the heavy per-state loaders ONCE, offline (in the scrape pipeline, not
 * the deploy build), and writes a tiny `data/{state}/summary.json` manifest the
 * state-landing page reads. This decouples the build from data volume: the
 * build no longer loads full datasets for every state's landing page, so it
 * stays cheap and OOM-immune as the state count grows.
 *
 * Sequential by design — running all states concurrently is exactly what
 * saturated the free-tier Supabase pool during static generation. One state at
 * a time keeps connections well under the limit.
 *
 * Usage:
 *   npx tsx scripts/build-state-summaries.ts            # all registered states
 *   npx tsx scripts/build-state-summaries.ts va nc      # specific states
 */

import * as fs from "fs";
import * as path from "path";
import { getAllStates } from "../lib/states/registry";
import { loadOnlineData, onlineQualifies } from "../lib/online";
import { getQualifyingProgramSlugs } from "../lib/programs";
import type { StateSummary } from "../lib/state-summary";

async function buildOne(state: string): Promise<StateSummary> {
  // Mirror the landing page's own failure handling: a loader error degrades to
  // "section hidden" rather than aborting the whole manifest.
  const [programSlugs, onlineData] = await Promise.all([
    getQualifyingProgramSlugs(state).catch(() => [] as string[]),
    loadOnlineData(state).catch(() => null),
  ]);
  return {
    showOnline: onlineQualifies(onlineData),
    onlineSections: onlineData?.totalSections ?? 0,
    onlineColleges: onlineData?.totalColleges ?? 0,
    programSlugs,
    generatedAt: new Date().toISOString(),
  };
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const states =
    args.length > 0 ? args : getAllStates().map((s) => s.slug);

  console.log(`Building state summaries for ${states.length} state(s)...\n`);
  let written = 0;
  for (const state of states) {
    try {
      const summary = await buildOne(state);
      const outDir = path.join(process.cwd(), "data", state);
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(
        path.join(outDir, "summary.json"),
        JSON.stringify(summary, null, 2) + "\n",
      );
      written++;
      console.log(
        `  ${state}: showOnline=${summary.showOnline} programs=${summary.programSlugs.length}`,
      );
    } catch (e) {
      console.error(
        `  ${state}: FAILED — ${e instanceof Error ? e.message : e}`,
      );
    }
  }
  console.log(`\n✓ Wrote ${written}/${states.length} summary manifests.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

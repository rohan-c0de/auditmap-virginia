/**
 * CI guard: flag any Scorecard record older than 18 months.
 *
 * Scorecard publishes refreshed data each October. An 18-month window means
 * one annual refresh can be missed without firing, but two cannot — so this
 * gives us a year of slack to catch up after a missed October refresh
 * without the check screaming on every PR.
 *
 * Exit codes:
 *   0 — every record is fresh (or there are no records to check)
 *   1 — one or more records are stale; details are printed
 *
 * Usage:
 *   npm run check:scorecard
 *   tsx scripts/check-scorecard-freshness.ts            # all states
 *   tsx scripts/check-scorecard-freshness.ts va nc      # specific states
 *
 * To refresh after the check fires, run:
 *   tsx scripts/ingest-scorecard.ts                     # all states
 *   tsx scripts/ingest-scorecard.ts <stale-state-slug>  # one state
 */

import fs from "fs";
import path from "path";

const MAX_AGE_MS = 18 * 30 * 24 * 60 * 60 * 1000; // ~18 months

interface StaleEntry {
  state: string;
  collegeId: string;
  fetchedAt: string;
  ageDays: number;
}

function listStates(filter: string[]): string[] {
  const all = fs
    .readdirSync("data", { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((s) => fs.existsSync(`data/${s}/scorecard`));
  if (filter.length === 0) return all;
  return all.filter((s) => filter.includes(s));
}

function checkFile(
  state: string,
  collegeId: string,
  file: string
): StaleEntry | null {
  let parsed: { fetchedAt?: string };
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    // Invalid JSON is a different kind of problem; let it be caught
    // elsewhere (the ingest script regenerates these, so they should never
    // be malformed).
    return null;
  }
  const fetchedAt = parsed.fetchedAt;
  if (!fetchedAt) {
    return {
      state,
      collegeId,
      fetchedAt: "missing",
      ageDays: Number.POSITIVE_INFINITY,
    };
  }
  const fetched = Date.parse(fetchedAt);
  if (Number.isNaN(fetched)) {
    return {
      state,
      collegeId,
      fetchedAt,
      ageDays: Number.POSITIVE_INFINITY,
    };
  }
  const ageMs = Date.now() - fetched;
  if (ageMs > MAX_AGE_MS) {
    return {
      state,
      collegeId,
      fetchedAt,
      ageDays: Math.round(ageMs / (24 * 60 * 60 * 1000)),
    };
  }
  return null;
}

function main(): void {
  const states = listStates(process.argv.slice(2));
  if (states.length === 0) {
    console.log("No Scorecard data found. (Run `tsx scripts/ingest-scorecard.ts` to populate.)");
    process.exit(0);
  }

  const stale: StaleEntry[] = [];
  let checked = 0;
  for (const state of states) {
    const dir = `data/${state}/scorecard`;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const collegeId = file.slice(0, -".json".length);
      checked++;
      const result = checkFile(state, collegeId, path.join(dir, file));
      if (result) stale.push(result);
    }
  }

  console.log(
    `Checked ${checked} Scorecard records across ${states.length} state${states.length === 1 ? "" : "s"}.`
  );

  if (stale.length === 0) {
    console.log("All records are fresh (≤ 18 months old).");
    process.exit(0);
  }

  // Group stale by state for readability.
  const byState = new Map<string, StaleEntry[]>();
  for (const e of stale) {
    if (!byState.has(e.state)) byState.set(e.state, []);
    byState.get(e.state)!.push(e);
  }

  console.error(`\n${stale.length} stale Scorecard record${stale.length === 1 ? "" : "s"} (> 18 months old):\n`);
  for (const [state, entries] of byState) {
    console.error(`  ${state}: ${entries.length} stale`);
    // Show the worst offenders in each state.
    const worst = [...entries].sort((a, b) => b.ageDays - a.ageDays).slice(0, 3);
    for (const e of worst) {
      console.error(`    - ${e.collegeId}  (${e.ageDays} days old, fetchedAt=${e.fetchedAt})`);
    }
    if (entries.length > 3) console.error(`    ...and ${entries.length - 3} more`);
  }
  console.error(
    `\nTo refresh, run:\n  tsx scripts/ingest-scorecard.ts            # all states\n  tsx scripts/ingest-scorecard.ts ${[...byState.keys()].join(" ")}   # only stale states\n`
  );
  process.exit(1);
}

main();

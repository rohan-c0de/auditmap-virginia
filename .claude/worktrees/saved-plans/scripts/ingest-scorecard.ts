/**
 * Per-college Scorecard ingest.
 *
 * Reads every `data/{state}/institutions.json`, picks the institutions that
 * have a `unitid` (set by `scripts/scorecard-map.ts`), fetches their
 * Scorecard record, and writes `data/{state}/scorecard/{college_id}.json`.
 *
 * Usage:
 *   tsx scripts/ingest-scorecard.ts            # all states with unitids
 *   tsx scripts/ingest-scorecard.ts va         # just one state
 *   tsx scripts/ingest-scorecard.ts va nc      # multiple states
 *
 * Run cadence: yearly (Scorecard publishes refreshed data each October).
 * Auto-add-state should call this for any new state once unitid-mapping
 * runs. See issue #392 PR 4 for the workflow hookup.
 */

import fs from "fs";
import path from "path";
import {
  fetchScorecardByUnitid,
  type ScorecardRecord,
} from "@/scripts/lib/college-scorecard";
import type { Institution } from "@/lib/types";

function listStates(filter: string[]): string[] {
  const all = fs
    .readdirSync("data", { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((s) => fs.existsSync(`data/${s}/institutions.json`));
  if (filter.length === 0) return all;
  return all.filter((s) => filter.includes(s));
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

async function ingestOne(
  state: string,
  inst: Institution
): Promise<{ ok: boolean; reason?: string }> {
  if (!inst.unitid) return { ok: false, reason: "no unitid" };
  const dir = `data/${state}/scorecard`;
  ensureDir(dir);
  const file = path.join(dir, `${inst.id}.json`);

  let record: ScorecardRecord | null;
  try {
    record = await fetchScorecardByUnitid(inst.unitid);
  } catch (e) {
    return {
      ok: false,
      reason: `fetch failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  if (!record) return { ok: false, reason: "no record for unitid" };
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + "\n");
  return { ok: true };
}

async function ingestState(state: string): Promise<{ written: number; skipped: number; failed: number }> {
  const insts = JSON.parse(
    fs.readFileSync(`data/${state}/institutions.json`, "utf-8")
  ) as Institution[];

  let written = 0;
  let skipped = 0;
  let failed = 0;
  const failures: string[] = [];

  process.stdout.write(`${state} (${insts.length}): `);
  for (const inst of insts) {
    const res = await ingestOne(state, inst);
    if (res.ok) {
      written++;
      process.stdout.write("·");
    } else if (res.reason === "no unitid") {
      skipped++;
      process.stdout.write("-");
    } else {
      failed++;
      failures.push(`  ${inst.id}: ${res.reason}`);
      process.stdout.write("x");
    }
  }
  process.stdout.write("\n");
  if (failures.length > 0) {
    console.log(failures.join("\n"));
  }
  return { written, skipped, failed };
}

async function main(): Promise<void> {
  const states = listStates(process.argv.slice(2));
  console.log(`Ingesting Scorecard records for ${states.length} state(s).\n`);

  let totWritten = 0;
  let totSkipped = 0;
  let totFailed = 0;
  for (const state of states) {
    const r = await ingestState(state);
    totWritten += r.written;
    totSkipped += r.skipped;
    totFailed += r.failed;
  }

  console.log("");
  console.log(`Wrote:    ${totWritten}`);
  console.log(`Skipped:  ${totSkipped} (no unitid mapped)`);
  console.log(`Failed:   ${totFailed}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

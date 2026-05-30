/**
 * Per-college per-program Scorecard ingest. Companion to
 * `scripts/ingest-scorecard.ts` (school-level data). Issue #406.
 *
 * For every institution with an IPEDS unitid in
 * `data/{state}/institutions.json`, calls the Scorecard programs endpoint
 * and writes the filtered result to
 * `data/{state}/scorecard-programs/{college_slug}.json`.
 *
 * Re-run cadence: yearly with the rest of Scorecard. Free public API.
 *
 * Usage:
 *   tsx scripts/ingest-scorecard-programs.ts            # all states
 *   tsx scripts/ingest-scorecard-programs.ts nc va      # named states
 */

import fs from "fs";
import path from "path";
import {
  fetchScorecardProgramsByUnitid,
  type ScorecardProgramRecord,
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
  inst: Institution,
): Promise<{ ok: boolean; count: number; reason?: string }> {
  if (!inst.unitid) return { ok: false, count: 0, reason: "no unitid" };
  const dir = `data/${state}/scorecard-programs`;
  ensureDir(dir);
  const file = path.join(dir, `${inst.id}.json`);

  let programs: ScorecardProgramRecord[];
  try {
    programs = await fetchScorecardProgramsByUnitid(inst.unitid);
  } catch (e) {
    return {
      ok: false,
      count: 0,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
  fs.writeFileSync(file, JSON.stringify(programs, null, 2) + "\n");
  return { ok: true, count: programs.length };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const states = listStates(args);
  console.log(`Ingesting per-program Scorecard data for ${states.length} state(s)…`);

  let totalOk = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  let totalPrograms = 0;
  for (const state of states) {
    const insts: Institution[] = JSON.parse(
      fs.readFileSync(`data/${state}/institutions.json`, "utf-8"),
    );
    process.stdout.write(`${state} (${insts.length}): `);
    for (const inst of insts) {
      const r = await ingestOne(state, inst);
      if (r.ok) {
        process.stdout.write("·");
        totalOk++;
        totalPrograms += r.count;
      } else if (r.reason === "no unitid") {
        process.stdout.write("-");
        totalSkipped++;
      } else {
        process.stdout.write("X");
        totalFailed++;
      }
    }
    process.stdout.write("\n");
  }

  console.log(`\nWrote:    ${totalOk}`);
  console.log(`Programs: ${totalPrograms}`);
  console.log(`Skipped:  ${totalSkipped} (no unitid mapped)`);
  console.log(`Failed:   ${totalFailed}`);
}

void main();

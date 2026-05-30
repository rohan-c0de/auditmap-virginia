/**
 * import-programs.ts
 *
 * Bulk import program/degree requirement data from JSON files into Supabase.
 *
 * Usage:
 *   npx tsx scripts/import-programs.ts --state va
 *   npx tsx scripts/import-programs.ts --all
 */

import { importProgramsToSupabase } from "./lib/supabase-import";
import { getAllStates } from "../lib/states/registry";

const ALL_STATES = getAllStates().map((s) => s.slug);

async function main() {
  const args = process.argv.slice(2);
  const stateIdx = args.indexOf("--state");
  const isAll = args.includes("--all");
  const force = args.includes("--force");

  let states: string[];
  if (isAll) {
    states = ALL_STATES;
  } else if (stateIdx >= 0) {
    const s = args[stateIdx + 1];
    if (!ALL_STATES.includes(s)) {
      console.error(`Unknown state: ${s}. Available: ${ALL_STATES.join(", ")}`);
      process.exit(1);
    }
    states = [s];
  } else {
    console.log(
      "Usage:\n" +
        "  npx tsx scripts/import-programs.ts --state va\n" +
        "  npx tsx scripts/import-programs.ts --all"
    );
    return;
  }

  console.log(`Importing programs for: ${states.join(", ")}`);

  let grandTotal = 0;
  for (const state of states) {
    const count = await importProgramsToSupabase(state, { force });
    grandTotal += count || 0;
  }

  console.log(`\nDone. Total: ${grandTotal} programs imported.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

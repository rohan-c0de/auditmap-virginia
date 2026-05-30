/**
 * import-transfers.ts
 *
 * Bulk import transfer equivalency data from JSON files into Supabase.
 *
 * Usage:
 *   npx tsx scripts/import-transfers.ts --state va
 *   npx tsx scripts/import-transfers.ts --all
 */

import { importTransfersToSupabase } from "./lib/supabase-import";
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
        "  npx tsx scripts/import-transfers.ts --state va\n" +
        "  npx tsx scripts/import-transfers.ts --all"
    );
    return;
  }

  console.log(`Importing transfers for: ${states.join(", ")}`);

  let grandTotal = 0;
  for (const state of states) {
    const count = await importTransfersToSupabase(state, { force });
    grandTotal += count || 0;
  }

  console.log(`\nDone. Total: ${grandTotal} transfer mappings imported.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

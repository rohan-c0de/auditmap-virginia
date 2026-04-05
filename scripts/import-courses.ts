/**
 * import-courses.ts
 *
 * Bulk import course data from JSON files into Supabase.
 * This is a thin wrapper around the shared import module.
 *
 * Usage:
 *   npx tsx scripts/import-courses.ts --state va
 *   npx tsx scripts/import-courses.ts --all
 */

import { importCoursesToSupabase } from "./lib/supabase-import";

const ALL_STATES = ["va", "nc", "sc", "dc", "md", "ga", "de"];

async function main() {
  const args = process.argv.slice(2);
  const stateIdx = args.indexOf("--state");
  const isAll = args.includes("--all");

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
        "  npx tsx scripts/import-courses.ts --state va\n" +
        "  npx tsx scripts/import-courses.ts --all"
    );
    return;
  }

  console.log(`Importing courses for: ${states.join(", ")}`);

  let grandTotal = 0;
  for (const state of states) {
    const count = await importCoursesToSupabase(state);
    grandTotal += count || 0;
  }

  console.log(`\nDone. Total: ${grandTotal} sections imported.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

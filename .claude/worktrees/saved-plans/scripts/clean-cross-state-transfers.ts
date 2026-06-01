/**
 * One-time cleanup: drops out-of-state target universities from any state's
 * transfer-equiv.json. Catches contamination from the CollegeTransfer.Net
 * OData scrapers (NH, ME, DC) which previously ingested every equivalency
 * in the national database regardless of target state.
 *
 * For each state with a CT.Net-name override declared below:
 *   1. Fetch the set of institutions CT.Net registers in that state.
 *   2. Load data/{state}/transfer-equiv.json.
 *   3. Drop entries whose `university_name` isn't in the in-state set.
 *   4. Write back. Print before/after counts.
 *
 * Idempotent — running it on already-clean data is a no-op.
 *
 * Usage: tsx scripts/clean-cross-state-transfers.ts
 */
import fs from "fs";
import path from "path";
import { fetchInStateInstitutions } from "./lib/in-state-institutions.js";

// State slug → full state name as CT.Net spells it. Add a state here once
// it pulls transfers via CollegeTransfer.Net OData.
const CT_NET_STATES: Record<string, string> = {
  nh: "New Hampshire",
  me: "Maine",
  dc: "District of Columbia",
};

interface TransferRow {
  university_name: string;
  [key: string]: unknown;
}

async function cleanState(slug: string, stateName: string) {
  const file = path.join("data", slug, "transfer-equiv.json");
  if (!fs.existsSync(file)) {
    console.log(`  ${slug}: no transfer-equiv.json — skipping`);
    return;
  }
  const before = JSON.parse(fs.readFileSync(file, "utf8")) as TransferRow[];

  console.log(`  ${slug}: fetching in-state institutions for "${stateName}"…`);
  const { names } = await fetchInStateInstitutions(stateName);
  console.log(`  ${slug}: ${names.size} in-state institutions registered`);

  const after = before.filter((row) =>
    names.has((row.university_name || "").trim()),
  );
  const droppedUnivs = new Map<string, number>();
  for (const row of before) {
    if (!names.has((row.university_name || "").trim())) {
      const u = row.university_name || "(blank)";
      droppedUnivs.set(u, (droppedUnivs.get(u) ?? 0) + 1);
    }
  }

  fs.writeFileSync(file, JSON.stringify(after, null, 2) + "\n");

  const removed = before.length - after.length;
  console.log(
    `  ${slug}: ${before.length} → ${after.length} entries (-${removed})`,
  );
  const distinctAfter = new Set(after.map((r) => r.university_name)).size;
  console.log(`  ${slug}: ${distinctAfter} distinct in-state target universities`);
  if (droppedUnivs.size > 0) {
    const top = Array.from(droppedUnivs.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    console.log(
      `  ${slug}: dropped (top 5): ${top.map(([u, n]) => `${u} (${n})`).join(", ")}`,
    );
  }
}

(async () => {
  console.log("Cleaning out-of-state transfer entries\n");
  for (const [slug, stateName] of Object.entries(CT_NET_STATES)) {
    await cleanState(slug, stateName);
    console.log();
  }
  console.log("Done. Review diffs in data/{nh,me,dc}/transfer-equiv.json,");
  console.log("then re-import to Supabase via the existing import path.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

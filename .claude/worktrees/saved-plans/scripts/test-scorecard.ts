/**
 * Smoke test for the College Scorecard API client.
 *
 * Usage:
 *   tsx scripts/test-scorecard.ts <unitid>
 *   tsx scripts/test-scorecard.ts search "<name>" <state>
 *
 * Examples:
 *   tsx scripts/test-scorecard.ts 232450
 *   tsx scripts/test-scorecard.ts search "Wake Technical" NC
 *   tsx scripts/test-scorecard.ts search "Northern Virginia" VA
 *
 * Useful for verifying COLLEGE_SCORECARD_API_KEY works end-to-end and for
 * eyeballing what fields are actually populated on a given college before
 * the full ingest (PR 2) runs against ~600 institutions.
 */

import {
  fetchScorecardByUnitid,
  searchScorecardByName,
  type ScorecardRecord,
} from "@/scripts/lib/college-scorecard";

function formatPct(v: number | null): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function formatDollar(v: number | null): string {
  if (v == null) return "—";
  return `$${v.toLocaleString("en-US")}`;
}

function printRecord(r: ScorecardRecord): void {
  console.log(`\n${r.schoolName} — ${r.city}, ${r.state} (unitid ${r.unitid})`);
  console.log(`  Enrollment: ${r.size ?? "—"}`);
  console.log(`  Share first-gen: ${formatPct(r.shareFirstGeneration)}`);
  console.log(`  Tuition (in-state / out-of-state): ${formatDollar(r.cost.tuitionInState)} / ${formatDollar(r.cost.tuitionOutOfState)}`);
  console.log(`  Avg net price (after aid): ${formatDollar(r.cost.avgNetPricePublic)}`);
  console.log(`  Net price by income:`);
  console.log(`    $0–30k:        ${formatDollar(r.cost.netPriceByIncome["0_30000"])}`);
  console.log(`    $30–48k:       ${formatDollar(r.cost.netPriceByIncome["30001_48000"])}`);
  console.log(`    $48–75k:       ${formatDollar(r.cost.netPriceByIncome["48001_75000"])}`);
  console.log(`    $75–110k:      ${formatDollar(r.cost.netPriceByIncome["75001_110000"])}`);
  console.log(`    $110k+:        ${formatDollar(r.cost.netPriceByIncome["110001_plus"])}`);
  console.log(`  Pell rate / fed loan rate: ${formatPct(r.aid.pellGrantRate)} / ${formatPct(r.aid.federalLoanRate)}`);
  console.log(`  Median debt at completion: ${formatDollar(r.aid.medianDebtCompleters)}`);
  console.log(`  Completion (150% / 200% time): ${formatPct(r.completion.completionRate150nt)} / ${formatPct(r.completion.completionRate200nt)}`);
  console.log(`  Transfer rate (FT): ${formatPct(r.completion.transferRate)}`);
  console.log(`  Median earnings 10y after entry: ${formatDollar(r.earnings.median10YrsAfterEntry)}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage:");
    console.error("  tsx scripts/test-scorecard.ts <unitid>");
    console.error('  tsx scripts/test-scorecard.ts search "<name>" <state>');
    process.exit(1);
  }

  if (args[0] === "search") {
    const name = args[1];
    const state = args[2];
    if (!name || !state) {
      console.error('Usage: tsx scripts/test-scorecard.ts search "<name>" <state>');
      process.exit(1);
    }
    const results = await searchScorecardByName(name, state);
    if (results.length === 0) {
      console.log(`No matches for "${name}" in ${state}.`);
      return;
    }
    console.log(`Found ${results.length} match${results.length === 1 ? "" : "es"}:`);
    for (const r of results) printRecord(r);
    return;
  }

  const unitid = Number(args[0]);
  if (!Number.isInteger(unitid) || unitid <= 0) {
    console.error(`Invalid unitid: ${args[0]}`);
    process.exit(1);
  }
  const record = await fetchScorecardByUnitid(unitid);
  if (!record) {
    console.log(`No record found for unitid ${unitid}.`);
    return;
  }
  printRecord(record);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

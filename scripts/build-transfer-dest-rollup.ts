/**
 * Pre-compute top transfer destinations per state from local
 * data/{state}/transfer-equiv.json → data/{state}/transfer-dest-rollup.json.
 *
 * During `next build`, loadStateTransferDestinations in lib/state-insights.ts
 * was querying Supabase via an RPC for every state page (51 pages × 3 workers).
 * For large states (TX 187k, CA 162k, AL 87k, AZ 31k rows) the concurrent
 * queries saturated the connection pool and hit the 2-minute statement_timeout.
 * This script moves that work to a pre-build step that reads from disk.
 *
 * Usage:
 *   npx tsx scripts/build-transfer-dest-rollup.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";

interface TransferMapping {
  university?: string;
  university_name?: string;
  univ_course?: string;
}

export interface TransferDestRollup {
  generatedAt: string;
  total: number;
  destinations: Array<{ university: string; mappingCount: number }>;
}

const DATA_DIR = path.join(process.cwd(), "data");

function listStates(): string[] {
  return fs
    .readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.length === 2)
    .map((d) => d.name)
    .sort();
}

function buildOne(state: string): { written: boolean; total: number } {
  const inPath = path.join(DATA_DIR, state, "transfer-equiv.json");
  if (!fs.existsSync(inPath)) return { written: false, total: 0 };

  const raw = fs.readFileSync(inPath, "utf8");
  const data = JSON.parse(raw) as TransferMapping[];

  const counts = new Map<string, number>();
  let total = 0;
  for (const m of data) {
    if (!m.university) continue;
    if (m.univ_course && m.univ_course.includes("*")) continue;
    counts.set(m.university, (counts.get(m.university) ?? 0) + 1);
    total++;
  }

  const destinations = Array.from(counts.entries())
    .map(([university, mappingCount]) => ({ university, mappingCount }))
    .sort((a, b) => b.mappingCount - a.mappingCount)
    .slice(0, 5);

  const out: TransferDestRollup = {
    generatedAt: fs.statSync(inPath).mtime.toISOString(),
    total,
    destinations,
  };

  const outPath = path.join(DATA_DIR, state, "transfer-dest-rollup.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
  return { written: true, total };
}

function main() {
  const states = listStates();
  let count = 0;
  for (const s of states) {
    const t0 = Date.now();
    const { written, total } = buildOne(s);
    const ms = Date.now() - t0;
    if (written) {
      console.log(
        `  ${s}: ${total.toString().padStart(7)} mappings, top 5 destinations  (${ms}ms)`,
      );
      count++;
    }
  }
  console.log(`\nWrote ${count} transfer-dest-rollup files.`);
}

main();

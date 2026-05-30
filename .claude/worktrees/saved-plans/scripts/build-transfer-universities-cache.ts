/**
 * Pre-compute the distinct {slug, name} list of receiving universities
 * per state, from data/{state}/transfer-equiv.json. Output:
 * data/{state}/transfer-universities.json
 *
 * Why this exists: at request time, getUniversities() in lib/transfer.ts
 * was paginating every transfer row in Supabase just to derive a 2-43
 * row DISTINCT list. For CA (100K+ rows) and TX (280K+ rows) that took
 * 16-23 seconds and pushed /[state]/transfer past Vercel's serverless
 * function timeout. Issue #777.
 *
 * Usage:
 *   npx tsx scripts/build-transfer-universities-cache.ts
 *
 * Runs over every state under data/. Idempotent; re-run after any
 * transfer-equiv refresh (the unified scheduled-scrape workflow does
 * this implicitly via `npm run build` calling this script).
 */

import * as fs from "node:fs";
import * as path from "node:path";

interface TransferMapping {
  state?: string;
  university: string;
  university_name: string;
}

interface UniversityEntry {
  slug: string;
  name: string;
}

const DATA_DIR = path.join(process.cwd(), "data");

function listStates(): string[] {
  return fs
    .readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.length === 2)
    .map((d) => d.name)
    .sort();
}

function buildOne(state: string): { written: boolean; count: number } {
  const inPath = path.join(DATA_DIR, state, "transfer-equiv.json");
  if (!fs.existsSync(inPath)) return { written: false, count: 0 };

  const raw = fs.readFileSync(inPath, "utf8");
  const data = JSON.parse(raw) as TransferMapping[];

  const seen = new Map<string, string>();
  for (const m of data) {
    if (!m.university) continue;
    if (!seen.has(m.university)) seen.set(m.university, m.university_name || m.university);
  }

  const out: UniversityEntry[] = Array.from(seen.entries())
    .map(([slug, name]) => ({ slug, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const outPath = path.join(DATA_DIR, state, "transfer-universities.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
  return { written: true, count: out.length };
}

function main() {
  const states = listStates();
  console.log(`Building transfer-universities cache for ${states.length} states…\n`);
  let totalUniversities = 0;
  let withCache = 0;
  for (const s of states) {
    const t0 = Date.now();
    const { written, count } = buildOne(s);
    const ms = Date.now() - t0;
    if (written) {
      console.log(`  ${s}: ${count.toString().padStart(3)} universities  (${ms}ms)`);
      totalUniversities += count;
      withCache++;
    }
  }
  console.log(
    `\nWrote ${withCache} cache files, ${totalUniversities} universities total.`,
  );
}

main();

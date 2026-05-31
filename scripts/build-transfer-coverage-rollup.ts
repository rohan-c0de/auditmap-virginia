/**
 * Pre-aggregate data/{state}/transfer-coverage.json into a small per-receiver
 * rollup written to data/{state}/transfer-coverage-rollup.json.
 *
 * The source coverage file is large (CA: 60 MB) — too expensive to
 * JSON.parse at request time inside a Vercel function (it's what crashed
 * /ca/transfer originally when the UI section first shipped via PR #732).
 * The rollup is ~10 KB per state, read by lib/transfer-coverage.ts in
 * <5 ms. Same pattern as scripts/build-transfer-universities-cache.ts.
 *
 * Wired into `npm run build` so the rollup regenerates whenever the
 * source coverage file is refreshed (Phase A scraper output).
 *
 * Usage:
 *   npx tsx scripts/build-transfer-coverage-rollup.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";

interface CoverageEntry {
  ccSlug: string;
  ccAssistId: number;
  receiverCode: string;
  receiverName: string;
  receiverCategory: "UC" | "CSU" | "Independent";
  receiverSlug: string;
  majorCount: number;
  majors: Array<{ label: string; key: string }>;
}

interface CoverageFile {
  generatedAt: string;
  academicYearId: number;
  entries: CoverageEntry[];
}

interface ReceiverRollup {
  receiverCode: string;
  receiverName: string;
  receiverSlug: string;
  receiverCategory: "UC" | "CSU" | "Independent";
  totalAgreements: number;
  ccsWithAgreement: number;
}

interface RollupFile {
  generatedAt: string;
  sourceGeneratedAt: string;
  academicYearId: number;
  totalReceivers: number;
  totalAgreements: number;
  receivers: ReceiverRollup[];
}

const DATA_DIR = path.join(process.cwd(), "data");

function listStates(): string[] {
  return fs
    .readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.length === 2)
    .map((d) => d.name)
    .sort();
}

function buildOne(state: string): { written: boolean; receivers: number } {
  const inPath = path.join(DATA_DIR, state, "transfer-coverage.json");
  if (!fs.existsSync(inPath)) return { written: false, receivers: 0 };

  const raw = fs.readFileSync(inPath, "utf8");
  const parsed = JSON.parse(raw) as CoverageFile;

  const byReceiver = new Map<string, ReceiverRollup>();
  for (const e of parsed.entries) {
    const key = e.receiverCode.trim();
    const existing = byReceiver.get(key);
    if (existing) {
      existing.totalAgreements += e.majorCount;
      if (e.majorCount > 0) existing.ccsWithAgreement++;
    } else {
      byReceiver.set(key, {
        receiverCode: key,
        receiverName: e.receiverName,
        receiverSlug: e.receiverSlug,
        receiverCategory: e.receiverCategory,
        totalAgreements: e.majorCount,
        ccsWithAgreement: e.majorCount > 0 ? 1 : 0,
      });
    }
  }

  const receivers = Array.from(byReceiver.values()).sort(
    (a, b) => b.totalAgreements - a.totalAgreements,
  );

  const out: RollupFile = {
    // Use the source's generation timestamp so the rollup file is stable
    // across rebuilds when the source hasn't changed. (Date.now() at build
    // time would invalidate git diffs every deploy.)
    generatedAt: parsed.generatedAt,
    sourceGeneratedAt: parsed.generatedAt,
    academicYearId: parsed.academicYearId,
    totalReceivers: receivers.length,
    totalAgreements: receivers.reduce((s, r) => s + r.totalAgreements, 0),
    receivers,
  };

  const outPath = path.join(DATA_DIR, state, "transfer-coverage-rollup.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
  return { written: true, receivers: receivers.length };
}

function main() {
  const states = listStates();
  let withRollup = 0;
  for (const s of states) {
    const t0 = Date.now();
    const { written, receivers } = buildOne(s);
    const ms = Date.now() - t0;
    if (written) {
      console.log(`  ${s}: ${receivers.toString().padStart(3)} receivers  (${ms}ms)`);
      withRollup++;
    }
  }
  console.log(`\nWrote ${withRollup} coverage-rollup files.`);
}

main();

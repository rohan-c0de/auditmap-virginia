/**
 * Per-receiver transfer coverage map loader.
 *
 * Reads the pre-aggregated rollup at data/{state}/transfer-coverage-rollup.json
 * (built by scripts/build-transfer-coverage-rollup.ts, wired into
 * `npm run build`). The rollup is ~16 KB; the source coverage file is up
 * to 60 MB and JSON.parsing it at request time crashed /ca/transfer the
 * first time the UI section shipped (PR #732 → reverted #743). Hence the
 * pre-aggregation.
 *
 * Only CA currently has a coverage file; other states return null and
 * the UI hides the section. Filesystem-driven — no state list to maintain.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface ReceiverRollup {
  receiverCode: string;
  receiverName: string;
  receiverSlug: string;
  receiverCategory: "UC" | "CSU" | "Independent";
  /** Total agreement count across all CCs in the state. */
  totalAgreements: number;
  /** How many CCs in the state have at least 1 agreement with this receiver. */
  ccsWithAgreement: number;
}

export interface CoverageRollup {
  generatedAt: string;
  academicYearId: number;
  totalReceivers: number;
  totalAgreements: number;
  /** Receivers sorted by total agreement count, grouped by category at render time. */
  receivers: ReceiverRollup[];
}

export async function loadTransferCoverage(
  state: string,
): Promise<CoverageRollup | null> {
  const filePath = path.join(
    process.cwd(),
    "data",
    state,
    "transfer-coverage-rollup.json",
  );
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as CoverageRollup;
    if (!parsed.receivers || parsed.receivers.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

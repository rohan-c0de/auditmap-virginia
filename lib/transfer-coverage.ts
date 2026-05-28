/**
 * Per-receiver transfer coverage map loader.
 *
 * Reads data/{state}/transfer-coverage.json (produced by
 * scripts/{state}/scrape-assist-receivers.ts or analogous), and aggregates
 * the (CC × receiver × majors) entries into a per-receiver rollup suitable
 * for a "browse by destination" UI surface.
 *
 * Only CA currently has a coverage file; other states return null and the
 * UI hides the section. Coverage support is filesystem-driven — no state
 * list to maintain.
 */

import * as fs from "node:fs";
import * as path from "node:path";

interface CoverageMajor {
  label: string;
  key: string;
}

interface CoverageEntry {
  ccSlug: string;
  ccAssistId: number;
  receiverCode: string;
  receiverName: string;
  receiverCategory: "UC" | "CSU" | "Independent";
  receiverSlug: string;
  majorCount: number;
  majors: CoverageMajor[];
}

interface CoverageFile {
  generatedAt: string;
  academicYearId: number;
  pairsAttempted: number;
  pairsSucceeded: number;
  totalMajors: number;
  entries: CoverageEntry[];
}

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
    "transfer-coverage.json",
  );
  if (!fs.existsSync(filePath)) return null;

  let parsed: CoverageFile;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }

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

  return {
    generatedAt: parsed.generatedAt,
    academicYearId: parsed.academicYearId,
    totalReceivers: receivers.length,
    totalAgreements: receivers.reduce((s, r) => s + r.totalAgreements, 0),
    receivers,
  };
}

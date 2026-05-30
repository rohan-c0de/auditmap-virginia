/**
 * Reader for federal BLS OEWS data ingested by
 * `scripts/ingest-bls.ts` into `data/bls/wages.json`. Used by the
 * program-page Career Outlook section (issue #413 priority #6).
 *
 * All values can be null — BLS suppresses metrics when a state's
 * cohort for a given occupation is too small to publish, and not
 * every program maps to an SOC.
 */

import fs from "node:fs";
import path from "node:path";

export interface StateSocStats {
  employment: number | null;
  meanAnnualWage: number | null;
  medianAnnualWage: number | null;
}

export interface WagesFile {
  fetchedAt: string;
  year: number;
  byState: Record<string, Record<string, StateSocStats>>;
}

let cache: WagesFile | null | "missing" = null;

function load(): WagesFile | null {
  if (cache === "missing") return null;
  if (cache) return cache;
  const file = path.join(process.cwd(), "data", "bls", "wages.json");
  if (!fs.existsSync(file)) {
    cache = "missing";
    return null;
  }
  try {
    cache = JSON.parse(fs.readFileSync(file, "utf-8")) as WagesFile;
    return cache;
  } catch {
    cache = "missing";
    return null;
  }
}

/** Reporting year of the most recent BLS data, e.g. 2024. */
export function getBlsReportingYear(): number | null {
  return load()?.year ?? null;
}

/**
 * State-level OEWS stats for an SOC. Returns null when the data file is
 * missing OR when BLS suppressed every metric for that (state, SOC).
 */
export function getStateSocStats(
  state: string,
  soc: string,
): StateSocStats | null {
  const stats = load()?.byState[state]?.[soc] ?? null;
  if (
    stats == null ||
    (stats.medianAnnualWage == null &&
      stats.meanAnnualWage == null &&
      stats.employment == null)
  ) {
    return null;
  }
  return stats;
}

/**
 * Cross-state median for an SOC, used as an approximate national
 * benchmark when displaying "state vs nation" comparisons. Averages
 * the state medians of every state where the metric isn't suppressed.
 * Not a true population-weighted national median, but close enough for
 * "is this state above or below the typical state" framing.
 */
export function getApproxNationalMedian(soc: string): number | null {
  const file = load();
  if (!file) return null;
  const medians: number[] = [];
  for (const s of Object.values(file.byState)) {
    const m = s[soc]?.medianAnnualWage;
    if (m != null) medians.push(m);
  }
  if (medians.length === 0) return null;
  // Median of state medians, not mean — robust to outlier states.
  medians.sort((a, b) => a - b);
  const mid = Math.floor(medians.length / 2);
  return medians.length % 2
    ? medians[mid]
    : Math.round((medians[mid - 1] + medians[mid]) / 2);
}

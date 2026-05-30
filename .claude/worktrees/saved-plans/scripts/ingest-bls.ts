/**
 * BLS OEWS ingest — pull state-level median wage + employment data for
 * each program's primary SOC code into `data/bls/wages.json`. Used by
 * the program-page Career Outlook section (issue #413 priority #6).
 *
 * Federal BLS public API. Unauthenticated requests are capped at 25/day
 * per IP; we batch carefully to stay under the cap.
 *
 * BLS OEWS state series ID format:
 *   OEUS { fips:2 } { area:7=0000000 } { industry:4=0000 } { soc:6 } { dataType:2 }
 *
 * Example for NC Registered Nurses (FIPS 37, SOC 291141):
 *   OEUS370000000000029114101 → annual employment count
 *   OEUS370000000000029114109 → annual median wage
 *
 * Data type codes (verified empirically against NC RN data — BLS docs
 * disagree across sources, so trust the actual returned values):
 *   01 = Employment count
 *   03 = Hourly mean wage
 *   04 = Annual mean wage
 *   08 = Hourly median wage
 *   09 = Hourly 75th percentile wage
 *   13 = Annual median wage   ← what we want for the page tile
 *   14 = Annual 75th percentile wage
 *   15 = Annual 90th percentile wage
 *
 * National data: BLS publishes national-level OEWS but the public-API
 * series prefix is not the obvious "OEUN" or "OEUS00" — both probe as
 * REQUEST_NOT_PROCESSED. Skipping for now; the program page surfaces
 * state-level data only. Adding a registered BLS API key would let us
 * pull national from a different endpoint later if needed.
 *
 * Run cadence: yearly. BLS publishes the May OEWS release each spring.
 *
 * Usage:
 *   tsx scripts/ingest-bls.ts
 */

import fs from "fs";
import { PROGRAMS } from "@/lib/programs/registry";
import { getAllStates } from "@/lib/states/registry";
import { loadEnv } from "./lib/load-env";

loadEnv();

const BLS_API = "https://api.bls.gov/publicAPI/v2/timeseries/data/";
// Registered API key bumps the daily cap from 25 → 500 queries and lets
// the response include current-year revisions. Optional; the script
// falls back to unauthenticated requests when unset.
const BLS_API_KEY = process.env.BLS_API_KEY ?? "";

interface BlsResponse {
  status: string;
  Results?: {
    series: Array<{
      seriesID: string;
      data: Array<{ year: string; value: string; latest?: string }>;
    }>;
  };
  message?: string[];
}

interface StateSocStats {
  employment: number | null;
  meanAnnualWage: number | null;
  medianAnnualWage: number | null;
}

interface WagesFile {
  fetchedAt: string;
  year: number;
  /** Keyed by state slug → SOC → stats. */
  byState: Record<string, Record<string, StateSocStats>>;
}

function fipsForState(slug: string): string | null {
  const metadata = JSON.parse(
    fs.readFileSync("data/state-metadata.json", "utf-8"),
  ) as { fipsCodes: Record<string, string> };
  return metadata.fipsCodes[slug] ?? null;
}

async function fetchBls(seriesIds: string[]): Promise<BlsResponse> {
  const body: Record<string, unknown> = { seriesid: seriesIds };
  if (BLS_API_KEY) body.registrationkey = BLS_API_KEY;
  const res = await fetch(BLS_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`BLS API HTTP ${res.status}`);
  return (await res.json()) as BlsResponse;
}

// OEUS{fips:2}{area:7=0000000}{industry:4=0000}{soc:6}{dataType:2} = 25 chars
function stateSeriesId(fips: string, soc: string, dataType: string): string {
  return `OEUS${fips}${"0".repeat(11)}${soc}${dataType}`;
}

function parseValue(v: string | undefined): number | null {
  if (v == null || v === "" || v === "-") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function main(): Promise<void> {
  const programs = PROGRAMS.filter((p) => p.primarySoc != null);
  const socs = Array.from(new Set(programs.map((p) => p.primarySoc!))).sort();
  const states = getAllStates();

  // Median annual wage only (data type 09) — the headline number for the
  // career-outlook tile. Total = states × socs × 1 series. With ~26
  // states × 10 SOCs = 260 series, that's 11 batches of 25 — within the
  // unauthenticated daily cap. Employment + mean are nice-to-haves we
  // can add later if we register a BLS API key (free, instant, 500/day).
  console.log(
    `Fetching BLS OEWS state median wages: ${states.length} states × ${socs.length} SOCs` +
      (BLS_API_KEY ? " (registered tier, 500/day)" : " (unauth tier, 25/day)"),
  );

  const byState: WagesFile["byState"] = {};
  for (const s of states) {
    byState[s.slug] = {};
    for (const soc of socs) {
      byState[s.slug][soc] = {
        employment: null,
        meanAnnualWage: null,
        medianAnnualWage: null,
      };
    }
  }

  let latestYear = 0;

  // Build the full series list, then batch. With a registered API key
  // the daily budget is 500 queries; fetch employment (01), annual mean
  // wage (04), AND annual median wage (13) per (state, SOC) — 3× the
  // unauth scope. Without a key, fall back to median-only to stay
  // under the 25/day unauth cap.
  const dataTypes = BLS_API_KEY ? ["01", "04", "13"] : ["13"];
  const seriesList: Array<{ id: string; state: string; soc: string; dt: string }> = [];
  for (const state of states) {
    const fips = fipsForState(state.slug);
    if (!fips) continue;
    for (const soc of socs) {
      for (const dt of dataTypes) {
        seriesList.push({
          id: stateSeriesId(fips, soc, dt),
          state: state.slug,
          soc,
          dt,
        });
      }
    }
  }

  console.log(`Total series: ${seriesList.length} (in ${Math.ceil(seriesList.length / 25)} batches of 25)`);

  for (let i = 0; i < seriesList.length; i += 25) {
    const batch = seriesList.slice(i, i + 25);
    const byId = new Map(batch.map((b) => [b.id, b]));
    process.stdout.write(`  batch ${Math.floor(i / 25) + 1}/${Math.ceil(seriesList.length / 25)}: `);
    let resp: BlsResponse;
    try {
      resp = await fetchBls(batch.map((b) => b.id));
    } catch (e) {
      console.error(` HTTP error: ${e}`);
      continue;
    }
    if (resp.status !== "REQUEST_SUCCEEDED") {
      console.error(` BLS: ${resp.status}`);
      continue;
    }
    let got = 0;
    for (const s of resp.Results?.series ?? []) {
      const meta = byId.get(s.seriesID);
      if (!meta || !s.data || s.data.length === 0) continue;
      const row = s.data.find((d) => d.latest === "true") ?? s.data[0];
      const year = parseInt(row.year, 10);
      if (year > latestYear) latestYear = year;
      const value = parseValue(row.value);
      if (value == null) continue;
      const stats = byState[meta.state][meta.soc];
      if (meta.dt === "01") stats.employment = value;
      else if (meta.dt === "04") stats.meanAnnualWage = value;
      else if (meta.dt === "13") stats.medianAnnualWage = value;
      got++;
    }
    console.log(`${got} values`);
  }

  const out: WagesFile = {
    fetchedAt: new Date().toISOString(),
    year: latestYear || new Date().getUTCFullYear(),
    byState,
  };
  fs.mkdirSync("data/bls", { recursive: true });
  fs.writeFileSync("data/bls/wages.json", JSON.stringify(out, null, 2) + "\n");
  console.log(`\nWrote data/bls/wages.json (year ${out.year})`);

  // Print summary so reviewer can sanity-check
  const totalPopulated = states.reduce(
    (n, s) =>
      n +
      socs.filter((soc) => byState[s.slug][soc].medianAnnualWage != null)
        .length,
    0,
  );
  console.log(
    `Populated (state, SOC) pairs with median wage: ${totalPopulated} / ${states.length * socs.length}`,
  );
}

void main();

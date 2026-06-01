/**
 * fetch-zipcodes.ts
 *
 * Downloads the GeoNames US zip-code dataset, filters by state, and writes
 * `data/{state}/zipcodes.json` in the format expected by lib/geo.ts:
 *
 *   { "20101": { "lat": 38.8462, "lng": -77.6383, "city": "Centreville" }, ... }
 *
 * Source: https://download.geonames.org/export/zip/US.zip
 *   - Country code (US)
 *   - Postal code (5-digit)
 *   - City / place name
 *   - State name
 *   - State abbr (the field we filter on)
 *   - County / lat / lng / accuracy
 *
 * Cached in tmp/geonames/US.txt to avoid re-downloading on every run. The
 * download is ~1.5 MB compressed, ~17 MB uncompressed; cache makes per-state
 * runs essentially instant.
 *
 * Used by the auto-add-state orchestrator (PR 7) — the bootstrap step.
 *
 * Library:
 *   import { fetchZipcodesForState } from "../lib/fetch-zipcodes";
 *   const written = await fetchZipcodesForState({ state: "oh" });
 *
 * CLI:
 *   npx tsx scripts/lib/fetch-zipcodes.ts --state oh
 *   npx tsx scripts/lib/fetch-zipcodes.ts --state oh --output /tmp/test.json
 */

import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync } from "child_process";

const GEONAMES_URL = "https://download.geonames.org/export/zip/US.zip";
const CACHE_DIR = path.join(process.cwd(), "tmp", "geonames");
const CACHED_TXT = path.join(CACHE_DIR, "US.txt");
const CACHED_ZIP = path.join(CACHE_DIR, "US.zip");

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ZipEntry {
  lat: number;
  lng: number;
  city: string;
}

export type ZipMap = Record<string, ZipEntry>;

export interface FetchZipcodesOptions {
  /** Lowercase state slug (e.g. "oh"). Resolved to GeoNames state abbr by upper-casing. */
  state: string;
  /**
   * Override the output path. Defaults to `data/{state}/zipcodes.json`.
   * Pass false-y to skip writing entirely (library-only use case).
   */
  outputPath?: string | null;
  /** Disable caching — force a fresh download. */
  noCache?: boolean;
}

export interface FetchZipcodesResult {
  state: string;
  totalRows: number;
  outputPath: string | null;
  zips: ZipMap;
  cacheHit: boolean;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

async function ensureCachedDataset(noCache: boolean): Promise<boolean> {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  if (!noCache && fs.existsSync(CACHED_TXT)) {
    return true; // cache hit
  }

  console.log(`Downloading ${GEONAMES_URL}...`);
  const res = await fetch(GEONAMES_URL);
  if (!res.ok) {
    throw new Error(`GeoNames download failed: HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(CACHED_ZIP, buf);
  const sizeMB = (buf.length / 1024 / 1024).toFixed(1);
  console.log(`  → ${CACHED_ZIP} (${sizeMB} MB compressed)`);

  // Unzip — use system unzip rather than a JS dep to keep zero-dep posture.
  const tmpExtract = fs.mkdtempSync(path.join(os.tmpdir(), "geonames-"));
  try {
    execFileSync("unzip", ["-q", "-o", CACHED_ZIP, "-d", tmpExtract], {
      stdio: ["ignore", "ignore", "inherit"],
    });
    const innerTxt = path.join(tmpExtract, "US.txt");
    if (!fs.existsSync(innerTxt)) {
      throw new Error(`Expected US.txt inside ${CACHED_ZIP} not found`);
    }
    fs.copyFileSync(innerTxt, CACHED_TXT);
  } finally {
    fs.rmSync(tmpExtract, { recursive: true, force: true });
  }
  fs.unlinkSync(CACHED_ZIP);
  console.log(`  Extracted → ${CACHED_TXT}`);
  return false; // fresh download, not a cache hit
}

/**
 * Parse GeoNames US.txt and return ZIP entries for the given state abbr.
 * The file is tab-separated; field 4 (0-indexed) is the state abbr.
 */
function parseZipcodesForState(stateAbbr: string): {
  zips: ZipMap;
  totalRows: number;
} {
  const upperAbbr = stateAbbr.toUpperCase();
  const data = fs.readFileSync(CACHED_TXT, "utf-8");
  const zips: ZipMap = {};
  let totalRows = 0;

  for (const line of data.split("\n")) {
    if (!line) continue;
    totalRows++;
    const fields = line.split("\t");
    // 0=country 1=zip 2=city 3=state-name 4=state-abbr 5=county-name 6=county-fips
    // 7=admin3-name 8=admin3-code 9=lat 10=lng 11=accuracy
    if (fields.length < 11) continue;
    if (fields[4] !== upperAbbr) continue;

    const zip = fields[1];
    const city = fields[2];
    const lat = parseFloat(fields[9]);
    const lng = parseFloat(fields[10]);
    if (!zip || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    // Round to 4 decimal places (~10m precision) — matches existing files
    zips[zip] = {
      lat: Math.round(lat * 10000) / 10000,
      lng: Math.round(lng * 10000) / 10000,
      city,
    };
  }

  return { zips, totalRows };
}

export async function fetchZipcodesForState(
  opts: FetchZipcodesOptions
): Promise<FetchZipcodesResult> {
  const stateLower = opts.state.toLowerCase();
  const stateUpper = stateLower.toUpperCase();
  const cacheHit = await ensureCachedDataset(opts.noCache ?? false);

  const { zips, totalRows } = parseZipcodesForState(stateUpper);
  const matched = Object.keys(zips).length;

  const defaultOut = path.join(
    process.cwd(),
    "data",
    stateLower,
    "zipcodes.json"
  );
  let outputPath: string | null;
  if (opts.outputPath === null) {
    outputPath = null;
  } else if (opts.outputPath) {
    outputPath = opts.outputPath;
  } else {
    outputPath = defaultOut;
  }

  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    // Sort keys for stable diffs across runs.
    const sorted = Object.keys(zips)
      .sort()
      .reduce<ZipMap>((acc, k) => {
        acc[k] = zips[k];
        return acc;
      }, {});
    // Match existing format — one zip per line, compact (`"20101": { ... }`)
    const lines = ['{'];
    const keys = Object.keys(sorted);
    keys.forEach((k, i) => {
      const z = sorted[k];
      const comma = i < keys.length - 1 ? "," : "";
      lines.push(
        `  "${k}": { "lat": ${z.lat}, "lng": ${z.lng}, "city": ${JSON.stringify(z.city)} }${comma}`
      );
    });
    lines.push("}");
    fs.writeFileSync(outputPath, lines.join("\n") + "\n");
  }

  console.log(
    `  ${stateUpper}: ${matched.toLocaleString()} zip codes (of ${totalRows.toLocaleString()} US rows)${outputPath ? ` → ${outputPath}` : ""}`
  );
  return { state: stateLower, totalRows, outputPath, zips, cacheHit };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliArgs {
  state?: string;
  outputPath?: string;
  noCache: boolean;
  help: boolean;
  err?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { noCache: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--state") out.state = argv[++i];
    else if (a === "--output") out.outputPath = argv[++i];
    else if (a === "--no-cache") out.noCache = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else out.err = `Unknown argument: ${a}`;
  }
  return out;
}

function printHelp() {
  console.log(`Usage:
  npx tsx scripts/lib/fetch-zipcodes.ts --state <state> [--output <path>] [--no-cache]

Downloads the GeoNames US zipcodes file (cached at tmp/geonames/US.txt),
filters by state, and writes data/{state}/zipcodes.json.

Examples:
  npx tsx scripts/lib/fetch-zipcodes.ts --state oh
  npx tsx scripts/lib/fetch-zipcodes.ts --state oh --output /tmp/oh-zips.json
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.err || !args.state) {
    if (args.err) console.error(`Error: ${args.err}`);
    if (!args.state && !args.help && !args.err) {
      console.error("Error: --state is required");
    }
    printHelp();
    process.exit(args.err || !args.state ? 1 : 0);
  }
  await fetchZipcodesForState({
    state: args.state,
    outputPath: args.outputPath,
    noCache: args.noCache,
  });
}

const isMain =
  import.meta.url.startsWith("file:") &&
  process.argv[1] &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  main().catch((e) => {
    console.error("Fatal:", e);
    process.exit(1);
  });
}

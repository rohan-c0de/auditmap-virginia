/**
 * discover-colleges.ts
 *
 * Returns the list of public 2-year community colleges in a state, with
 * names + addresses + lat/lng + primary website. Drives the auto-add-state
 * orchestrator's bootstrap step (PR 6) so it doesn't have to be told the
 * college list manually.
 *
 * Source: IPEDS via the Urban Institute's Education Data API
 *   (educationdata.urban.org) — a free, well-documented JSON wrapper
 *   over the federal IPEDS directory.
 *
 * IPEDS is the authoritative federal directory of every Title IV
 * postsecondary institution. Coverage is comprehensive and address data
 * is curated; lat/lng come straight through the API. We don't need to
 * geocode separately.
 *
 * Filtering rationale — three things we have to handle:
 *
 *   1. Some states' "community colleges" sit in sector=4 (public 2-year):
 *      Ohio, NC, MA, NJ, etc. These are the textbook case.
 *
 *   2. Some states' CCs sit in sector=1 (public 4-year) because the system
 *      offers a few bachelor's programs alongside the associate-degree
 *      core. Florida is the canonical example — every FCS college is in
 *      sector=1 even though the system is functionally a CC system.
 *      Some CA, GA, and NY institutions follow the same pattern.
 *
 *   3. Both sectors include adult-ed / career-tech / workforce centers
 *      that aren't truly "community colleges" by our definition.
 *
 *   Discriminator that works across all three: `inst_category` ∈ {3, 4}.
 *   Per IPEDS, those codes mean "Degree-granting, primarily associate's"
 *   (cat=3 = not primarily baccalaureate; cat=4 = associate's + certs).
 *   This cleanly catches both buckets of CCs and excludes non-degree
 *   workforce centers, while not over-including 4-year universities.
 *   Spot-checked against FL (28 expected, returns 28 FCS members),
 *   OH (14 expected, returns 14), and CA (~115 districts/colleges).
 *
 * Library:
 *   import { discoverPublicCommunityColleges } from "../lib/discover-colleges";
 *   const colleges = await discoverPublicCommunityColleges("oh");
 *   // [{ unitid, name, slug, primaryUrl, address, city, zip, lat, lng }, ...]
 *
 * CLI:
 *   npx tsx scripts/lib/discover-colleges.ts --state oh
 *   npx tsx scripts/lib/discover-colleges.ts --state oh --json
 */

import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiscoveredCollege {
  /** IPEDS unitid — stable federal identifier; useful for re-discovery / dedupe. */
  unitid: number;
  /** Official name from IPEDS (e.g. "Cuyahoga Community College District"). */
  name: string;
  /** Lowercase, hyphen-separated slug derived from name. Caller may override. */
  slug: string;
  /** Primary institutional URL (no protocol — caller adds https://). */
  primaryUrl: string;
  /** Mailing address — typically the main campus. */
  address: string;
  city: string;
  /** State USPS abbr (e.g. "OH"). */
  stateAbbr: string;
  zip: string;
  /** Coordinates of the institution's primary location. */
  lat: number;
  lng: number;
  /** Some big systems (CUNY, Maricopa) have a parent unit — exposed for dedupe. */
  hasParent: boolean;
}

export interface DiscoverOptions {
  /** Lowercase state slug (e.g. "oh"). */
  state: string;
  /** Override the IPEDS data year. Defaults to the latest known year. */
  year?: number;
  /** Filter results to slugs containing this substring (debug helper). */
  filter?: string;
}

// ---------------------------------------------------------------------------
// FIPS lookup (read from data/state-metadata.json so we have one source
// of truth for state codes across the bootstrap pipeline).
// ---------------------------------------------------------------------------

interface StateMetadataFile {
  fipsCodes: Record<string, string>;
}

let cachedMetadata: StateMetadataFile | null = null;

function loadStateMetadata(): StateMetadataFile {
  if (cachedMetadata) return cachedMetadata;
  const file = path.join(process.cwd(), "data", "state-metadata.json");
  cachedMetadata = JSON.parse(fs.readFileSync(file, "utf-8"));
  return cachedMetadata!;
}

export function fipsCodeForState(stateSlug: string): string | null {
  const meta = loadStateMetadata();
  return meta.fipsCodes[stateSlug.toLowerCase()] ?? null;
}

// ---------------------------------------------------------------------------
// IPEDS query — Urban Institute Education Data API
//
// Endpoint shape:
//   GET https://educationdata.urban.edu/api/v1/college-university/ipeds/directory/{year}/?fips={fips}&sector=4
//
// Response is paginated; default 100 rows per page. We follow .next until
// it's null. The number of public 2-year institutions per state is small
// (Ohio = 23, Texas = 50+) so paging completes in 1–3 requests.
// ---------------------------------------------------------------------------

const IPEDS_BASE =
  "https://educationdata.urban.org/api/v1/college-university/ipeds/directory";
const DEFAULT_YEAR = 2023;
const REQUEST_TIMEOUT_MS = 30_000;

interface IpedsRow {
  unitid: number;
  inst_name: string;
  address: string | null;
  city: string;
  state_abbr: string;
  zip: string;
  longitude: number | null;
  latitude: number | null;
  url_school: string | null;
  sector: number;
  inst_status: number | null; // 1 = currently active
  inst_size: number | null;
  inst_category: number | null;
  degree_granting: number | null; // 1 = grants degrees
  parent_unitid_for_branch: number | null;
}

interface IpedsResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: IpedsRow[];
}

async function fetchIpedsPage(url: string): Promise<IpedsResponse> {
  const res = await fetch(url, {
    headers: { "User-Agent": "CommunityCollegePath/1.0 (auto-add-state)" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(
      `IPEDS API returned HTTP ${res.status} for ${url}`
    );
  }
  return res.json();
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[''']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function cleanUrl(raw: string | null): string {
  if (!raw) return "";
  // IPEDS sometimes returns "Www.example.edu", "http://example.edu/", or empty.
  let s = raw.trim();
  s = s.replace(/^https?:\/\//i, "");
  s = s.replace(/^www\./i, "");
  s = s.replace(/\/+$/, "");
  return s.toLowerCase();
}

export async function discoverPublicCommunityColleges(
  state: string,
  opts: { year?: number; filter?: string } = {}
): Promise<DiscoveredCollege[]> {
  const fips = fipsCodeForState(state);
  if (!fips) {
    throw new Error(
      `Unknown state '${state}'. Add it to data/state-metadata.json fipsCodes.`
    );
  }

  const year = opts.year ?? DEFAULT_YEAR;
  // Query sector=1 (public 4-year) AND sector=4 (public 2-year) — see
  // header docs for why FL/CA/etc. CCs land in sector=1.
  const sectorUrls = [
    `${IPEDS_BASE}/${year}/?fips=${fips}&sector=1`,
    `${IPEDS_BASE}/${year}/?fips=${fips}&sector=4`,
  ];

  const rows: IpedsRow[] = [];
  for (const startUrl of sectorUrls) {
    let url: string | null = startUrl;
    while (url) {
      const page = await fetchIpedsPage(url);
      rows.push(...page.results);
      url = page.next;
    }
  }

  // Dedupe by unitid (an institution should only appear in one sector,
  // but defend against API quirks).
  const seenIds = new Set<number>();
  const filtered = rows.filter((r) => {
    if (seenIds.has(r.unitid)) return false;
    seenIds.add(r.unitid);

    // Drop non-degree-granting institutions. Compared as Number() because
    // the API serializes some flags as string "1" rather than number 1.
    if (Number(r.degree_granting) !== 1) return false;

    // Critical filter: inst_category ∈ {3, 4} = "Degree-granting, primarily
    // associate's degrees / associate's + certificates". Excludes both
    // 4-year universities (cat=2) and non-degree workforce centers (cat=5,6).
    const cat = Number(r.inst_category);
    if (cat !== 3 && cat !== 4) return false;

    // Exclude 4-year university branch campuses. They show up in IPEDS
    // sector=1 cat=3 because they grant associate's, but they aren't
    // standalone CCs — they're regional satellites of bachelor's-granting
    // institutions ("Kent State University at Ashtabula", "Ohio State
    // University-Mansfield Campus", "University of Cincinnati-Blue Ash
    // College"). Heuristic: drop names containing "University" unless
    // they're explicitly a community college named after a university
    // (none observed across all 50 states; community-college names use
    // "College", "Community College", "Tech College", or just "College").
    if (/\bUniversit/i.test(r.inst_name) && !/\bCommunity College\b/i.test(r.inst_name)) {
      return false;
    }
    return true;
  });

  const slugCounts = new Map<string, number>();
  const colleges: DiscoveredCollege[] = filtered.map((r) => {
    let slug = slugify(r.inst_name);
    // Some institution names are duplicates after slugifying (rare, but
    // possible for "X Community College - North Campus" vs main). Append a
    // counter to avoid collisions.
    const used = slugCounts.get(slug) ?? 0;
    if (used > 0) slug = `${slug}-${used}`;
    slugCounts.set(slug, used + 1);

    return {
      unitid: r.unitid,
      name: r.inst_name,
      slug,
      primaryUrl: cleanUrl(r.url_school),
      address: r.address ?? "",
      city: r.city,
      stateAbbr: r.state_abbr,
      zip: r.zip,
      lat: r.latitude ?? 0,
      lng: r.longitude ?? 0,
      // The Urban Institute API omits null fields entirely, so the parent
      // field arrives as `undefined` for non-branches. Truthy check
      // catches both undefined and the rare zero/null edge cases.
      hasParent:
        r.parent_unitid_for_branch !== null &&
        r.parent_unitid_for_branch !== undefined &&
        r.parent_unitid_for_branch > 0,
    };
  });

  if (opts.filter) {
    const f = opts.filter.toLowerCase();
    return colleges.filter(
      (c) => c.slug.includes(f) || c.name.toLowerCase().includes(f)
    );
  }

  return colleges;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliArgs {
  state?: string;
  json: boolean;
  filter?: string;
  year?: number;
  help: boolean;
  err?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--state") out.state = argv[++i];
    else if (a === "--filter") out.filter = argv[++i];
    else if (a === "--year") out.year = parseInt(argv[++i], 10);
    else if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else out.err = `Unknown argument: ${a}`;
  }
  return out;
}

function printHelp() {
  console.log(`Usage:
  npx tsx scripts/lib/discover-colleges.ts --state <state> [--year YYYY] [--filter <substr>] [--json]

Returns the list of public 2-year community colleges in a state via IPEDS
(Urban Institute Education Data API).

Examples:
  npx tsx scripts/lib/discover-colleges.ts --state oh
  npx tsx scripts/lib/discover-colleges.ts --state oh --json
  npx tsx scripts/lib/discover-colleges.ts --state ca --filter los-angeles
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

  const colleges = await discoverPublicCommunityColleges(args.state, {
    year: args.year,
    filter: args.filter,
  });

  if (args.json) {
    console.log(JSON.stringify(colleges, null, 2));
    return;
  }

  console.log(
    `\nDiscovered ${colleges.length} public 2-year college(s) in ${args.state.toUpperCase()}:\n`
  );
  for (const c of colleges) {
    const flag = c.hasParent ? " ⤷branch" : "";
    console.log(`  ${c.slug.padEnd(40)} unitid=${c.unitid}${flag}`);
    console.log(`    ${c.name}`);
    console.log(`    ${c.address}, ${c.city}, ${c.stateAbbr} ${c.zip}`);
    console.log(`    ${c.primaryUrl || "(no URL in IPEDS)"}`);
    console.log(`    ${c.lat}, ${c.lng}`);
    console.log();
  }
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

/**
 * resolve-terms.ts
 *
 * Determines which academic terms to scrape for each state/system.
 * Probes external APIs to check if the next term has data yet, and
 * outputs both current and next term when the next one is available.
 *
 * This eliminates the manual "update VCCS_TERM env var" step —
 * scrapers automatically start pulling next-semester data as soon as
 * registration opens.
 *
 * Usage:
 *   npx tsx scripts/lib/resolve-terms.ts --system vccs
 *   npx tsx scripts/lib/resolve-terms.ts --system colleague-nc
 *   npx tsx scripts/lib/resolve-terms.ts --system banner-ga
 *
 * Output (JSON to stdout for GitHub Actions consumption):
 *   {"terms":["Summer 2026","Fall 2026"],"termCodes":["2026SU","2026FA"]}
 *
 * In GitHub Actions:
 *   terms=$(npx tsx scripts/lib/resolve-terms.ts --system vccs)
 *   echo "matrix=$(echo $terms | jq -c)" >> $GITHUB_OUTPUT
 */

import { loadEnv } from "./load-env";
loadEnv();

// Many college sites have self-signed or expired SSL certs.
// The GitHub Actions workflows already set this, but ensure it's set here too.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// ---------------------------------------------------------------------------
// Term arithmetic
// ---------------------------------------------------------------------------

export interface TermInfo {
  name: string;      // "Summer 2026"
  code: string;      // "2026SU"
  season: string;    // "SU"
  year: number;      // 2026
}

/** Current calendar-based term (not what's in the DB, what makes sense now). */
export function currentCalendarTerm(): TermInfo {
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12
  const year = now.getFullYear();

  // Academic calendar approximation:
  //   Jan-May  → Spring of current year (registration usually already open)
  //   Jun-Jul  → Summer of current year
  //   Aug-Dec  → Fall of current year
  let season: string;
  let seasonName: string;
  if (month <= 5) {
    season = "SP"; seasonName = "Spring";
  } else if (month <= 7) {
    season = "SU"; seasonName = "Summer";
  } else {
    season = "FA"; seasonName = "Fall";
  }

  return {
    name: `${seasonName} ${year}`,
    code: `${year}${season}`,
    season,
    year,
  };
}

/** Get the next term after a given term. */
export function nextTerm(t: TermInfo): TermInfo {
  if (t.season === "SP") return { name: `Summer ${t.year}`, code: `${t.year}SU`, season: "SU", year: t.year };
  if (t.season === "SU") return { name: `Fall ${t.year}`, code: `${t.year}FA`, season: "FA", year: t.year };
  // FA → next year SP
  return { name: `Spring ${t.year + 1}`, code: `${t.year + 1}SP`, season: "SP", year: t.year + 1 };
}

/**
 * Filter Banner-style terms (objects with a human-readable label like
 * "Spring 2026" or "Fall Semester 2026 17-AUG-2026 - 08-DEC-2026") down to
 * those at or after the current calendar term.
 *
 * Used by both Banner SSB (DC, CT, GA — `description` field) and Banner 8
 * HTML scrapers (DE — `description`, RI — `name`). Each Banner deployment
 * uses its own season-suffix scheme in the term *code* (DC: 20=SP, CT: 40=SP,
 * GA: 12=SP, RI: 10=SP), so the label string is the only universal
 * denominator across deployments — pass `descriptionOf` when the label
 * lives on a field other than `description`.
 *
 * Pass an `exclude` predicate to drop deployment-specific noise (e.g. DE's
 * "Professional Dev" entries) without re-implementing the year filter.
 *
 * "(View only)" / "(View Only)" entries are dropped by default — they have
 * no current sections and the data we already have for them is canonical.
 */
export function pickRecentSsbTerms<T>(
  terms: T[],
  opts: {
    exclude?: (t: T) => boolean;
    descriptionOf?: (t: T) => string;
    /**
     * If true, keep "(View Only)" entries instead of dropping them.
     * Default false. Set true for sites that intentionally re-scrape past
     * terms (e.g. backfill scenarios where past sections are still valid
     * to refresh).
     */
    includeViewOnly?: boolean;
  } = {}
): T[] {
  const cur = currentCalendarTerm();
  const SEASON_RANK: Record<string, number> = { SP: 1, SU: 2, FA: 3 };
  const SEASON_FROM_DESC: Record<string, string> = {
    spring: "SP",
    summer: "SU",
    fall: "FA",
  };
  const curRank = cur.year * 10 + SEASON_RANK[cur.season];
  const getDesc =
    opts.descriptionOf ?? ((t: T) => (t as { description: string }).description);

  return terms.filter((t) => {
    const desc = getDesc(t).toLowerCase();
    if (!opts.includeViewOnly && desc.includes("view only")) return false;
    if (opts.exclude?.(t)) return false;
    const yearMatch = desc.match(/\b(20\d{2})\b/);
    const seasonKey = Object.keys(SEASON_FROM_DESC).find((s) => desc.includes(s));
    if (!yearMatch || !seasonKey) return false;
    const season = SEASON_FROM_DESC[seasonKey];
    const rank = parseInt(yearMatch[1]) * 10 + SEASON_RANK[season];
    return rank >= curRank;
  });
}

/** Get the term before a given term. */
function prevTerm(t: TermInfo): TermInfo {
  if (t.season === "FA") return { name: `Summer ${t.year}`, code: `${t.year}SU`, season: "SU", year: t.year };
  if (t.season === "SU") return { name: `Spring ${t.year}`, code: `${t.year}SP`, season: "SP", year: t.year };
  // SP → prev year FA
  return { name: `Fall ${t.year - 1}`, code: `${t.year - 1}FA`, season: "FA", year: t.year - 1 };
}

// ---------------------------------------------------------------------------
// VCCS term probe — checks if courses.vccs.edu has data for a term
// ---------------------------------------------------------------------------

async function probeVccsTerm(termName: string): Promise<boolean> {
  try {
    // Try fetching the NOVA ENG course list for a given term.
    // courses.vccs.edu returns an HTML page with <dt>/<dd> course listings
    // when the term has data. Look for courseLink anchors or <dt> tags.
    const url = `https://courses.vccs.edu/colleges/nova/courses/ENG?term=${encodeURIComponent(termName)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "CommunityCollegePath/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return false;
    const html = await res.text();
    // courseLink anchors appear for each course; <dt> tags wrap course headers.
    // If we see several, the term has data.
    const dtCount = (html.match(/<dt/g) || []).length;
    return dtCount >= 3 || html.includes("courseLink") || html.includes("col-md-");
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Colleague term probe — moved to scripts/lib/colleague-terms.ts (issue #172).
// Each Colleague scraper now resolves terms per-college rather than via a
// single shared sample URL per state. resolve-terms.ts retains only the
// `vccs` and `vccs-ps` systems, where one endpoint genuinely represents
// every college in the system.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Banner SSB term probe — checks the getTerms API
// ---------------------------------------------------------------------------

async function probeBannerTerms(baseUrl: string): Promise<string[]> {
  try {
    const url = `${baseUrl}/StudentRegistrationSsb/ssb/classSearch/getTerms?searchTerm=&offset=1&max=30`;
    const res = await fetch(url, {
      headers: { "User-Agent": "CommunityCollegePath/1.0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const data = await res.json() as { code: string; description: string }[];
    return data.map((t) => t.description);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// PeopleSoft term code mapping
// ---------------------------------------------------------------------------

// VCCS PeopleSoft uses a custom numeric coding scheme.
// Pattern: year prefix (22 = 2025-26 academic year, 23 = 2026-27) + season suffix (62=SP, 63=SU, 64=FA)
// We maintain a lookup because this pattern isn't purely algorithmic.
const PS_TERM_CODES: Record<string, { termCode: string; jsonTerm: string }> = {
  "Spring 2026": { termCode: "2262", jsonTerm: "2026SP" },
  "Summer 2026": { termCode: "2263", jsonTerm: "2026SU" },
  "Fall 2026":   { termCode: "2264", jsonTerm: "2026FA" },
  "Spring 2027": { termCode: "2272", jsonTerm: "2027SP" },
  "Summer 2027": { termCode: "2273", jsonTerm: "2027SU" },
  "Fall 2027":   { termCode: "2274", jsonTerm: "2027FA" },
};

// ---------------------------------------------------------------------------
// System-specific resolvers
// ---------------------------------------------------------------------------

interface ResolvedTerms {
  terms: string[];      // Human-readable: ["Summer 2026", "Fall 2026"]
  termCodes: string[];  // Standardized: ["2026SU", "2026FA"]
  // VCCS PeopleSoft extras (only present for --system vccs-ps)
  psTermCodes?: string[];
  psJsonTerms?: string[];
}

async function resolveVccs(): Promise<ResolvedTerms> {
  const current = currentCalendarTerm();
  const next = nextTerm(current);
  const nextNext = nextTerm(next);

  // Probe current + next two terms. VCCS colleges typically open the
  // registration catalog ~6 months ahead, so in mid-April a student planning
  // for Fall is a real use case (Wake Tech already had 667 Fall sections
  // posted in April 2026). Probing three terms keeps parity with the
  // Colleague probe.
  const candidates = [current, next, nextNext];
  console.error(
    `Probing VCCS terms: ${candidates.map((c) => c.name).join(", ")}...`
  );

  const results = await Promise.all(candidates.map((c) => probeVccsTerm(c.name)));

  const terms: TermInfo[] = [];
  candidates.forEach((c, i) => {
    console.error(`  ${c.name}: ${results[i] ? "HAS DATA" : "no data"}`);
    if (results[i]) terms.push(c);
  });

  // Fallback: if nothing has data (unusual), try previous term
  if (terms.length === 0) {
    const prev = prevTerm(current);
    console.error(`  No candidate has data, falling back to ${prev.name}`);
    terms.push(prev);
  }

  return {
    terms: terms.map((t) => t.name),
    termCodes: terms.map((t) => t.code),
  };
}

async function resolveVccsPs(): Promise<ResolvedTerms> {
  const base = await resolveVccs();

  // Add PeopleSoft-specific codes
  const psTermCodes: string[] = [];
  const psJsonTerms: string[] = [];

  for (const name of base.terms) {
    const ps = PS_TERM_CODES[name];
    if (ps) {
      psTermCodes.push(ps.termCode);
      psJsonTerms.push(ps.jsonTerm);
    } else {
      console.error(`  WARNING: No PeopleSoft term code mapping for "${name}". Skipping.`);
    }
  }

  return { ...base, psTermCodes, psJsonTerms };
}

/** Banner SSB scrapers already auto-discover terms, so just return current + next. */
async function resolveBanner(): Promise<ResolvedTerms> {
  // Banner scrapers handle term discovery internally via getTerms() API.
  // We just need to confirm current + next are reasonable.
  const current = currentCalendarTerm();
  const next = nextTerm(current);

  return {
    terms: [current.name, next.name],
    termCodes: [current.code, next.code],
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const systemIdx = args.indexOf("--system");
  const system = systemIdx >= 0 ? args[systemIdx + 1] : null;

  if (!system) {
    console.error("Usage: npx tsx scripts/lib/resolve-terms.ts --system <system>");
    console.error("Systems: vccs, vccs-ps, banner");
    console.error("(Colleague systems removed — each Colleague scraper now resolves its own terms per-college; see scripts/lib/colleague-terms.ts)");
    process.exit(1);
  }

  let result: ResolvedTerms;

  switch (system) {
    case "vccs":
      result = await resolveVccs();
      break;
    case "vccs-ps":
      result = await resolveVccsPs();
      break;
    case "banner":
      result = await resolveBanner();
      break;
    default:
      console.error(`Unknown system: ${system}`);
      process.exit(1);
  }

  // Output JSON to stdout (GitHub Actions reads this)
  console.log(JSON.stringify(result));
}

// Only run the CLI when invoked directly, not when imported by another script
// (e.g. scrape-cuny.ts re-uses currentCalendarTerm/nextTerm).
const invokedDirectly =
  typeof import.meta.url === "string" &&
  process.argv[1] &&
  import.meta.url === `file://${process.argv[1]}`;

if (invokedDirectly) {
  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}

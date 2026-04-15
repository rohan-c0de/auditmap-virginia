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

interface TermInfo {
  name: string;      // "Summer 2026"
  code: string;      // "2026SU"
  season: string;    // "SU"
  year: number;      // 2026
}

/** Current calendar-based term (not what's in the DB, what makes sense now). */
function currentCalendarTerm(): TermInfo {
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
function nextTerm(t: TermInfo): TermInfo {
  if (t.season === "SP") return { name: `Summer ${t.year}`, code: `${t.year}SU`, season: "SU", year: t.year };
  if (t.season === "SU") return { name: `Fall ${t.year}`, code: `${t.year}FA`, season: "FA", year: t.year };
  // FA → next year SP
  return { name: `Spring ${t.year + 1}`, code: `${t.year + 1}SP`, season: "SP", year: t.year + 1 };
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
// Colleague term probe — POSTs to PostSearchCriteria to discover active terms
// ---------------------------------------------------------------------------

interface ColleagueActivePlanTerm {
  Code: string;         // "2026SP" or custom like "V26SP"
  Description: string;  // "Spring 2026", "CCV Spring 2026", etc.
}

interface ColleagueSession {
  cookie: string;          // Serialized "name=value; ..." cookie header
  verificationToken: string;
}

/** Build the JSON payload Colleague's Knockout.js search form sends. */
function colleagueSearchPayload(termCodes: string[] = []): Record<string, unknown> {
  return {
    subjects: [],
    synonyms: [],
    academicLevels: [],
    courseLevels: [],
    courseTypes: [],
    topicCodes: [],
    terms: termCodes,
    days: [],
    locations: [],
    faculty: [],
    startDate: null,
    endDate: null,
    startTime: null,
    endTime: null,
    startsAtTime: null,
    endsByTime: null,
    keyword: null,
    requirement: null,
    subrequirement: null,
    group: null,
    courseIds: null,
    sectionIds: null,
    requirementText: null,
    subRequirementText: null,
    onlineCategories: null,
    pageNumber: 1,
    quantityPerPage: 1,
    openSections: null,
    openAndWaitlistedSections: null,
    keywordComponents: [],
    searchResultsView: "CatalogListing",
    sortOn: "None",
    sortDirection: "Ascending",
  };
}

/**
 * Colleague Self-Service's PostSearchCriteria endpoint requires an antiforgery
 * token (both as a cookie and as an `__RequestVerificationToken` header).
 * Prime a session by GETting the Search page, capturing Set-Cookie headers,
 * and extracting the hidden token from the HTML.
 */
async function openColleagueSession(baseUrl: string): Promise<ColleagueSession | null> {
  try {
    const res = await fetch(`${baseUrl}/Student/Courses/Search`, {
      headers: { "User-Agent": "CommunityCollegePath/1.0" },
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Extract hidden antiforgery token from the rendered form.
    const tokenMatch = html.match(
      /name="__RequestVerificationToken"[^>]*value="([^"]+)"/
    );
    if (!tokenMatch) return null;

    // Collect cookies from Set-Cookie headers (getSetCookie is Node 20+).
    const setCookieHeaders =
      typeof (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === "function"
        ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
        : res.headers.get("set-cookie")?.split(/,(?=[^;]+=[^;]+)/g) ?? [];

    const cookiePairs: string[] = [];
    for (const raw of setCookieHeaders) {
      const [pair] = raw.split(";");
      if (pair && pair.includes("=")) cookiePairs.push(pair.trim());
    }

    return {
      cookie: cookiePairs.join("; "),
      verificationToken: tokenMatch[1],
    };
  } catch {
    return null;
  }
}

/** POST to Colleague's PostSearchCriteria endpoint using a primed session. */
async function colleaguePostSearch(
  baseUrl: string,
  session: ColleagueSession,
  termCodes: string[] = []
): Promise<{ TotalItems?: number; ActivePlanTerms?: ColleagueActivePlanTerm[] } | null> {
  try {
    const url = `${baseUrl}/Student/Courses/PostSearchCriteria`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "User-Agent": "CommunityCollegePath/1.0",
        "Content-Type": "application/json; charset=UTF-8",
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "__RequestVerificationToken": session.verificationToken,
        Cookie: session.cookie,
      },
      body: JSON.stringify(colleagueSearchPayload(termCodes)),
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Probe a Colleague site to find which of our candidate terms (current, next,
 * optionally next-next) have live sections. Returns a list of TermInfo whose
 * codes reflect the site's own term codes (handles VSC custom codes like V26SP).
 */
async function probeColleagueTerms(
  baseUrl: string,
  candidates: TermInfo[]
): Promise<TermInfo[]> {
  const session = await openColleagueSession(baseUrl);
  if (!session) return [];

  // Step 1: discover ActivePlanTerms (the terms the site knows about).
  //         Note: Colleague often lists terms far into the future here — the
  //         presence of a code doesn't mean sections are posted. We still
  //         have to verify each candidate with a filtered query.
  const discovery = await colleaguePostSearch(baseUrl, session);
  if (!discovery?.ActivePlanTerms || discovery.ActivePlanTerms.length === 0) {
    return [];
  }

  const found: TermInfo[] = [];
  const seenCodes = new Set<string>();

  // Step 2: for each candidate calendar term, find matching ActivePlanTerm(s).
  //         Two strategies because Colleague deployments are inconsistent:
  //           (a) Description contains the calendar name ("Spring 2026").
  //               Catches standard sites and multi-college sites like VSC
  //               where codes are custom (V26SP, S26SP) but descriptions
  //               still say "Spring 2026".
  //           (b) Code starts with the candidate's standard code ("2026SP").
  //               Catches sites with weird description formats (e.g. FDTC
  //               says "Spring 25-26 15-WK Term") but preserves the standard
  //               code convention, including mini-session variants like
  //               2026SP2 / 2026SP3 that represent different scheduling
  //               windows within the same semester.
  for (const cand of candidates) {
    const nameLc = cand.name.toLowerCase();
    const codeLc = cand.code.toLowerCase();
    const matches = discovery.ActivePlanTerms.filter(
      (t) =>
        t.Description.toLowerCase().includes(nameLc) ||
        t.Code.toLowerCase().startsWith(codeLc)
    );

    for (const m of matches) {
      if (seenCodes.has(m.Code)) continue;
      // Step 3: verify the term actually has sections posted
      const verify = await colleaguePostSearch(baseUrl, session, [m.Code]);
      const hasSections = (verify?.TotalItems ?? 0) > 0;
      if (hasSections) {
        seenCodes.add(m.Code);
        found.push({
          name: cand.name,
          code: m.Code,
          season: cand.season,
          year: cand.year,
        });
      }
    }
  }

  return found;
}

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

async function resolveColleague(sampleBaseUrl: string): Promise<ResolvedTerms> {
  const current = currentCalendarTerm();
  const next = nextTerm(current);
  const nextNext = nextTerm(next);

  const candidates = [current, next, nextNext];
  console.error(
    `Probing Colleague terms at ${sampleBaseUrl}: ${candidates.map((c) => c.name).join(", ")}...`
  );

  const found = await probeColleagueTerms(sampleBaseUrl, candidates);

  for (const cand of candidates) {
    const hit = found.find((f) => f.name === cand.name);
    if (hit) {
      console.error(`  ${cand.name}: FOUND (code=${hit.code})`);
    } else {
      console.error(`  ${cand.name}: not found`);
    }
  }

  // Dedup by calendar term name — Colleague sites may expose per-college term
  // codes (e.g. VSC "V26SP" + "S26SP" for the same Spring 2026). We keep
  // distinct term codes but collapse the human-readable list.
  const terms: TermInfo[] = found.length > 0 ? found : [prevTerm(current)];

  // Unique human-readable names preserving order.
  const seenNames = new Set<string>();
  const termNames: string[] = [];
  for (const t of terms) {
    if (!seenNames.has(t.name)) {
      seenNames.add(t.name);
      termNames.push(t.name);
    }
  }

  return {
    terms: termNames,
    termCodes: terms.map((t) => t.code),
  };
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
// Sample college URLs for probing each system
// ---------------------------------------------------------------------------

// Sample Colleague Self-Service hosts used to probe available terms per state.
// These must be live Colleague Self-Service instances that respond to
// /Student/Courses/PostSearchCriteria. Verified 2026-04.
const COLLEAGUE_SAMPLES: Record<string, string> = {
  nc: "https://selfserve.waketech.edu",      // Wake Tech
  sc: "https://selfservice.fdtc.edu",        // Florence-Darlington Tech
  md: "https://selfservice.pgcc.edu",        // Prince George's CC
  vt: "https://selfservice.vsc.edu",         // Vermont State Colleges (CCV + VTSU)
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const systemIdx = args.indexOf("--system");
  const system = systemIdx >= 0 ? args[systemIdx + 1] : null;

  if (!system) {
    console.error("Usage: npx tsx scripts/lib/resolve-terms.ts --system <system>");
    console.error("Systems: vccs, vccs-ps, colleague-nc, colleague-sc, colleague-md, colleague-vt, banner");
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
    case "colleague-nc":
      result = await resolveColleague(COLLEAGUE_SAMPLES.nc);
      break;
    case "colleague-sc":
      result = await resolveColleague(COLLEAGUE_SAMPLES.sc || COLLEAGUE_SAMPLES.nc);
      break;
    case "colleague-md":
      result = await resolveColleague(COLLEAGUE_SAMPLES.md || COLLEAGUE_SAMPLES.nc);
      break;
    case "colleague-vt":
      result = await resolveColleague(COLLEAGUE_SAMPLES.vt || COLLEAGUE_SAMPLES.nc);
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

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

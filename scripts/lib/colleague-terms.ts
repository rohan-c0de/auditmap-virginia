/**
 * colleague-terms.ts — per-college term discovery for Ellucian Colleague
 * Self-Service deployments. Each scraper calls `resolveCollegeTerms(baseUrl)`
 * before scraping a college, asking *that* college which of the current,
 * next, and next-next calendar terms have live sections, and gets back the
 * site's own term codes.
 *
 * Issue #172: replaces the previous shared-sample model in resolve-terms.ts
 * (which probed one URL per state and assumed every Colleague install in the
 * state used the same term codes). That assumption broke for NJ — Bergen
 * returns "2026SU" while Passaic returns "26/SU1" — and we got a Passaic
 * crash through #171. Same risk exists for NC's 37 colleges, SC's 16, MD's
 * 10+, VT's 4. Per-college discovery removes the assumption entirely.
 *
 * Banner SSB scrapers already do this pattern (`getTerms` per college +
 * `pickRecentSsbTerms` filter); this brings Colleague to parity.
 */

import { currentCalendarTerm, nextTerm, type TermInfo } from "./resolve-terms";
import { isFrozen } from "./term-freeze";

interface ColleagueActivePlanTerm {
  Code: string;         // "2026SP", custom like "V26SP", or quirky like "26/SU1"
  Description: string;  // "Spring 2026", "CCV Spring 2026", "Summer 1 26/SU1", etc.
}

interface ColleagueSession {
  cookie: string;
  verificationToken: string;
}

/** Build the JSON payload Colleague's Knockout.js search form sends. */
function colleagueSearchPayload(termCodes: string[] = []): Record<string, unknown> {
  return {
    subjects: [], synonyms: [], academicLevels: [], courseLevels: [],
    courseTypes: [], topicCodes: [], terms: termCodes, days: [],
    locations: [], faculty: [], startDate: null, endDate: null,
    startTime: null, endTime: null, startsAtTime: null, endsByTime: null,
    keyword: null, requirement: null, subrequirement: null, group: null,
    courseIds: null, sectionIds: null, requirementText: null,
    subRequirementText: null, onlineCategories: null,
    pageNumber: 1, quantityPerPage: 1,
    openSections: null, openAndWaitlistedSections: null,
    keywordComponents: [],
    searchResultsView: "CatalogListing",
    sortOn: "None", sortDirection: "Ascending",
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

    const tokenMatch = html.match(
      /name="__RequestVerificationToken"[^>]*value="([^"]+)"/
    );
    if (!tokenMatch) return null;

    const setCookieHeaders =
      typeof (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === "function"
        ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
        : res.headers.get("set-cookie")?.split(/,(?=[^;]+=[^;]+)/g) ?? [];

    const cookiePairs: string[] = [];
    for (const raw of setCookieHeaders) {
      const [pair] = raw.split(";");
      if (pair && pair.includes("=")) cookiePairs.push(pair.trim());
    }

    return { cookie: cookiePairs.join("; "), verificationToken: tokenMatch[1] };
  } catch {
    return null;
  }
}

async function colleaguePostSearch(
  baseUrl: string,
  session: ColleagueSession,
  termCodes: string[] = []
): Promise<{ TotalItems?: number; ActivePlanTerms?: ColleagueActivePlanTerm[] } | null> {
  try {
    const res = await fetch(`${baseUrl}/Student/Courses/PostSearchCriteria`, {
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
 * Match each candidate calendar term against the college's ActivePlanTerms.
 * Two strategies because Colleague deployments are inconsistent:
 *   (a) Description contains the calendar name ("Spring 2026"). Catches
 *       standard sites and multi-college sites like VSC where codes are
 *       custom (V26SP, S26SP) but descriptions still say "Spring 2026".
 *   (b) Code starts with the candidate's standard code ("2026SP"). Catches
 *       sites with weird description formats (e.g. FDTC says "Spring 25-26
 *       15-WK Term") but preserves the standard code convention, including
 *       mini-session variants like 2026SP2 / 2026SP3.
 */
function matchCandidates(
  active: ColleagueActivePlanTerm[],
  candidates: TermInfo[]
): { candidate: TermInfo; active: ColleagueActivePlanTerm }[] {
  const out: { candidate: TermInfo; active: ColleagueActivePlanTerm }[] = [];
  const seen = new Set<string>();
  for (const cand of candidates) {
    const nameLc = cand.name.toLowerCase();
    const codeLc = cand.code.toLowerCase();
    // 2-digit-year variant: convert "2026SU" → "26SU". CCAC and other
    // PA Colleague installs return codes like this.
    const codeShort = codeLc.replace(/^(20)(\d{2})/, "$2");
    // Canonical {YYYY}{SEASON} extracted from the candidate.
    const candYearSeason = canonicalize(codeLc);
    for (const t of active) {
      if (seen.has(t.Code)) continue;
      const desc = t.Description.toLowerCase();
      const tCode = t.Code.toLowerCase();
      // (a) Description includes "spring 2026" or similar — covers most
      //     standard sites and multi-college sites like VSC.
      // (b) Code starts with the candidate's 4-digit standard code
      //     ("2026SP*") — catches odd-description sites that keep
      //     conventional codes plus mini-session variants
      //     (2026SP2/2026SP3).
      // (c) Code starts with the 2-digit-year variant ("26SP*") — catches
      //     CCAC-style sites returning short codes.
      // (d) Canonical year+season extracted from both match — fallback
      //     when description has a weird format like "Summer Semester
      //     2026" (CCAC) or "Spring 25-26" (FDTC).
      if (
        desc.includes(nameLc) ||
        tCode.startsWith(codeLc) ||
        tCode.startsWith(codeShort) ||
        (candYearSeason && canonicalize(tCode) === candYearSeason) ||
        (candYearSeason &&
          extractYearSeasonFromDescription(desc) === candYearSeason)
      ) {
        seen.add(t.Code);
        out.push({ candidate: cand, active: t });
      }
    }
  }
  return out;
}

/**
 * Normalize a code like "2026sp", "26sp", "v26sp", or "2026sp2" to a
 * canonical "{4-year}{2-season}" form, e.g. "2026SP". Returns null if
 * year + season can't be unambiguously extracted.
 */
function canonicalize(code: string): string | null {
  const m = code.toLowerCase().match(/(\d{2,4})\s*(sp|su|fa|wi)/);
  if (!m) return null;
  let year = m[1];
  if (year.length === 2) {
    // Heuristic: 2-digit years 50-99 → 19xx, 00-49 → 20xx.
    const n = parseInt(year, 10);
    year = n >= 50 ? `19${year}` : `20${year}`;
  } else if (year.length === 3) {
    return null;
  }
  return `${year}${m[2].toUpperCase()}`;
}

/**
 * Pull a canonical year+season out of a description like
 * "Summer Semester 2026" or "Spring 25-26 15-WK Term".
 */
function extractYearSeasonFromDescription(desc: string): string | null {
  const seasonMap: Record<string, string> = {
    spring: "SP",
    summer: "SU",
    fall: "FA",
    winter: "WI",
  };
  const seasonMatch = desc.match(/(spring|summer|fall|winter)/);
  if (!seasonMatch) return null;
  const season = seasonMap[seasonMatch[1]];
  const yearMatch = desc.match(/\b(20\d{2})\b/);
  if (!yearMatch) return null;
  return `${yearMatch[1]}${season}`;
}

export interface CollegeTerm {
  /** Human-readable calendar name we use to identify the term in code paths
   *  that still take a `termName` (e.g. existing scrapeCollege signatures). */
  name: string;
  /** The site's native term code, used as-is for scrape requests + filenames. */
  code: string;
  /** The exact description string the site returned, useful for logs. */
  description: string;
  season: string;
  year: number;
}

/**
 * Discover which of the current, next, and next-next calendar terms have
 * live sections at this specific college, and return the site's native
 * codes for each. ~1 HTTP roundtrip + 1 verification POST per matched term.
 *
 * When `opts.freezeContext` is provided, terms whose on-disk data started
 * 3+ weeks ago (issue #173) are dropped from the result — drop-add is
 * closed and the data on disk is the final record. Pass `state` and `slug`
 * so the freeze check can locate `data/{state}/courses/{slug}/{term}.json`.
 *
 * Returns an empty array if the college is offline, gates Self-Service
 * behind auth, or has no sections posted for any of the candidate terms.
 */
export async function resolveCollegeTerms(
  baseUrl: string,
  opts: { freezeContext?: { state: string; slug: string } } = {}
): Promise<CollegeTerm[]> {
  const session = await openColleagueSession(baseUrl);
  if (!session) return [];

  const discovery = await colleaguePostSearch(baseUrl, session);
  if (!discovery?.ActivePlanTerms || discovery.ActivePlanTerms.length === 0) {
    return [];
  }

  const cur = currentCalendarTerm();
  const nxt = nextTerm(cur);
  const nxtNxt = nextTerm(nxt);
  const candidates = [cur, nxt, nxtNxt];

  const matches = matchCandidates(discovery.ActivePlanTerms, candidates);

  // Verify each candidate has sections posted before returning. Colleague
  // ActivePlanTerms often includes terms far into the future where the
  // catalog has been built but no sections exist yet.
  const found: CollegeTerm[] = [];
  for (const m of matches) {
    if (
      opts.freezeContext &&
      isFrozen(opts.freezeContext.state, opts.freezeContext.slug, m.active.Code)
    ) {
      console.log(`  [frozen] skipping ${opts.freezeContext.slug}/${m.active.Code} (${m.active.Description}) — started 3+ weeks ago`);
      continue;
    }
    const verify = await colleaguePostSearch(baseUrl, session, [m.active.Code]);
    if ((verify?.TotalItems ?? 0) > 0) {
      found.push({
        name: m.candidate.name,
        code: m.active.Code,
        description: m.active.Description,
        season: m.candidate.season,
        year: m.candidate.year,
      });
    }
  }

  return found;
}

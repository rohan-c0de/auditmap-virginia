/**
 * fingerprint-college.ts
 *
 * Given a college URL or domain, identify which Student Information System
 * (SIS) platform it runs by probing well-known endpoints and checking body
 * markers. Used by the auto-add-state orchestrator to decide which scraper
 * template to instantiate per college.
 *
 * Consolidates detection logic that previously lived in three per-state
 * scripts:
 *   - scripts/nc/discover-registration-systems.ts (path-based probing)
 *   - scripts/nc/discover-colleague-subdomains.ts (subdomain enumeration)
 *   - scripts/sc/discover-sc-systems.ts (body-marker matching)
 *
 * Detected platforms — these are the platforms we have (or can reasonably
 * write) scraper templates for:
 *
 *   banner-ssb-9         Modern Ellucian Self-Service Banner (REST + JSON)
 *   banner-8             Classic Banner (PL/SQL `pls/PROD/bwckschd...`)
 *   colleague            Ellucian Colleague Self-Service
 *   peoplesoft           Oracle PeopleSoft Campus Solutions
 *   jenzabar             Jenzabar JICS / Sonis
 *   coursedog            Coursedog catalog/registration
 *   workday              Workday Student
 *   ellucian-experience  Ellucian Experience cloud (typically auth-gated)
 *   courseleaf           CourseLeaf catalog (CIM/FOSE)
 *   webadvisor           Legacy Datatel WebAdvisor (predates Colleague SS)
 *   acalog               Acalog catalog (programs-side)
 *   auth-gated           SAML/OIDC redirect to SSO before any course search
 *   custom               HTML page detected but no known platform marker
 *   unknown              No course-search endpoint found at any candidate host
 *
 * Usage:
 *   npx tsx scripts/lib/fingerprint-college.ts --url https://www.valenciacollege.edu
 *   npx tsx scripts/lib/fingerprint-college.ts --domain valenciacollege.edu
 *   npx tsx scripts/lib/fingerprint-college.ts --urls url1,url2,url3
 *   npx tsx scripts/lib/fingerprint-college.ts --url URL --json
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const TIMEOUT_MS = 8000;
const PROBE_CONCURRENCY = 8;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Platform =
  | "banner-ssb-9"
  | "banner-8"
  | "colleague"
  | "peoplesoft"
  | "jenzabar"
  | "coursedog"
  | "workday"
  | "ellucian-experience"
  | "courseleaf"
  | "webadvisor"
  | "acalog"
  | "auth-gated"
  | "custom"
  | "unknown";

export type Confidence = "high" | "medium" | "low";

export interface PlatformMatch {
  platform: Platform;
  url: string;
  confidence: Confidence;
  evidence: string[];
}

export interface FingerprintResult {
  input: string;
  domain: string;
  platform: Platform;
  confidence: Confidence;
  evidence: string[];
  courseSearchUrl: string | null;
  candidates: PlatformMatch[];
  authGated: boolean;
  notes: string[];
}

// ---------------------------------------------------------------------------
// Detection rules — ordered by specificity. The first probe to return 200
// with a marker match wins. Probes without markers (markers: []) are
// last-resort signals: a 200 alone earns medium confidence at most.
// ---------------------------------------------------------------------------

interface ProbeRule {
  platform: Platform;
  paths: string[];
  // Markers checked against the response body. ALL must be substrings (case-
  // sensitive) for a high-confidence hit. Empty array → path-only signal.
  markers: string[];
  // If set, finalUrl matching this regex AFTER following redirects also
  // counts as a hit (e.g. workday redirect from student.{domain}).
  redirectMarker?: RegExp;
}

const PROBES: ProbeRule[] = [
  {
    platform: "banner-ssb-9",
    paths: [
      "/StudentRegistrationSsb/ssb/classSearch/classSearch",
      "/StudentRegistrationSsb/ssb/registration/registration",
      "/StudentRegistrationSsb/ssb/term/termSelection",
    ],
    markers: ["StudentRegistrationSsb"],
  },
  {
    platform: "banner-8",
    paths: [
      "/pls/PROD/bwckschd.p_disp_dyn_sched",
      "/pls/PROD/bwckctlg.p_disp_cat_term_date",
      "/pls/prod/bwckschd.p_disp_dyn_sched",
      // No-pls-prefix variants. CCCS uses college-specific codes like
      // `/PRODOJC/bwckschd.p_disp_dyn_sched` (Otero). We can't enumerate
      // every state's per-college code, but PROD covers many state systems
      // that share one Banner instance.
      "/PROD/bwckschd.p_disp_dyn_sched",
      "/PROD/bwckctlg.p_disp_cat_term_date",
    ],
    markers: ["bwckschd", "bwckctlg"],
  },
  {
    platform: "colleague",
    paths: [
      "/Student/Courses",
      "/Student/Courses/Search",
      "/Student/Student/Courses",
    ],
    // Colleague's React shell ships a verification-token meta + the
    // EllucianColleagueSelfService string in the bundle filenames. Newer
    // SCCCD-style deployments don't expose that exact string but ARE
    // unambiguously Colleague — they pull assets from elluciancloud.com.
    // Combined with the /Student/Courses path (which is uniquely Colleague),
    // any of these is a high-confidence match.
    markers: [
      "EllucianColleagueSelfService",
      "elluciancloud.com",
      "Colleague Self-Service",
    ],
  },
  {
    platform: "peoplesoft",
    paths: [
      "/psc/SA/EMPLOYEE/SA/c/SSR_STUDENT_FL.SSR_CLSRCH_ENTRY_FL.GBL",
      "/psc/PROD/EMPLOYEE/SA/c/SA_LEARNER_SERVICES.CLASS_SEARCH.GBL",
    ],
    markers: ["PeopleSoft"],
  },
  {
    platform: "jenzabar",
    paths: ["/ICS/", "/ICS/Academics/Course_Schedules.jnz"],
    markers: ["Jenzabar"],
  },
  {
    platform: "coursedog",
    paths: ["/courses", "/catalog", "/schedule"],
    markers: ["coursedog.com", "app.coursedog.com"],
  },
  {
    platform: "courseleaf",
    paths: ["/courseleaf/", "/coursesearch/"],
    markers: ["courseleaf"],
  },
  {
    platform: "webadvisor",
    paths: ["/WebAdvisor/WebAdvisor", "/webadvisor"],
    markers: ["WebAdvisor"],
  },
  {
    platform: "acalog",
    paths: ["/index.php?catoid=1", "/index.php"],
    markers: ["Acalog"],
  },
];

// Markers that can be detected on the bare college homepage, indicating an
// embedded third-party catalog or a Workday redirect. These don't gate on
// a probe path — we just check the homepage HTML.
const HOMEPAGE_MARKERS: Array<{ platform: Platform; marker: RegExp }> = [
  { platform: "coursedog", marker: /coursedog\.com|app\.coursedog\.com/i },
  { platform: "courseleaf", marker: /[a-z0-9-]+\.courseleaf\.com/i },
  { platform: "ellucian-experience", marker: /experience\.elluciancloud\.com/i },
  { platform: "workday", marker: /myworkday\.com|wd\d+\.myworkday\.com/i },
];

const AUTH_REDIRECT_MARKERS: RegExp[] = [
  /login\.microsoftonline\.com/i,
  /\/Shibboleth\.sso\//i,
  /okta\.com\/(?:login|app)/i,
  /\/cas\/login/i,
  /samlsso/i,
  /idp\.[a-z0-9-]+\.(?:edu|com)/i,
];

// Subdomain prefixes to enumerate when probing. Bare host comes first; if
// the SIS lives at the root domain the probe shortcuts before exploring
// the long tail. Some colleges put their SSB at idiosyncratic prefixes
// (`web.sjrstate.edu`, `banner.aws.valenciacollege.edu`) that are reached
// via the homepage-link harvest below, not by exhaustive enumeration.
const SUBDOMAIN_PREFIXES = [
  "",
  "www",
  "selfservice",
  "selfserve",
  "selfserv",
  "selfserviceprod",
  "ss",
  "ssb",
  "ssb-prod",
  "banner",
  "courses",
  "my",
  "myccp",
  "mycollegess",
  "reg",
  "registration",
  "student",
  "students",
  "sscourses",
  "colleague",
  "portal",
  "experience",
  "catalog",
  "web",
];

// State-system shared SIS hosts. Many colleges run their SIS on a system-
// wide domain rather than their own marketing host — Bismarck State's
// course search lives at studentadmin.connectnd.us (the NDUS shared
// PeopleSoft), not at any subdomain of bismarckstate.edu. Subdomain
// enumeration of the college's own domain can never find these.
//
// When fingerprint() is called with a stateHint, we ALSO probe every
// host listed here for the matching state. Per-state arrays keep this
// surgical — we only probe these hosts when we know they're relevant,
// not as a global "try every system host for every college."
//
// Seeded from the May 2026 spot-check that found 5/10 "custom" colleges
// were actually templated on system hosts. Extend this list whenever a
// new state's shared host is identified.
const STATE_SYSTEM_HOSTS: Record<string, string[]> = {
  // North Dakota University System — all ND public colleges
  nd: ["studentadmin.connectnd.us"],
  // Minnesota State Colleges and Universities — 26 colleges
  mn: ["eservices.minnstate.edu"],
  // Colorado Community College System — 13 colleges (Otero, etc.)
  co: ["erpdnssb.cccs.edu"],
  // Alabama Community College System — 22 colleges (Drake, etc.)
  al: ["ssb-prod.ec.accs.edu"],
  // California — system-by-system, not statewide. SCCCD (Fresno/Reedley/
  // Clovis), CCCD (Coast — Orange Coast/Coastline/Golden West). Add more
  // CA systems as their colleges surface in coverage gaps.
  ca: ["selfservice.scccd.edu", "catalog.cccd.edu"],
};

// Substrings that, when found in any URL on the college homepage, are a
// strong signal of which platform the college publishes. URL-based detection
// is far more reliable than subdomain enumeration — non-standard SSB hosts
// (banner.aws.X, reg-prod.X.elluciancloud.com:8103, web.X) and Ellucian
// Cloud hosts on non-443 ports show up in homepage links but never in a
// subdomain-prefix enumeration.
const URL_PATTERNS: Array<{ platform: Platform; pattern: RegExp }> = [
  { platform: "banner-ssb-9", pattern: /\/StudentRegistrationSsb\/ssb\//i },
  { platform: "banner-8", pattern: /\/(?:pls\/[^/]+\/)?bwck(?:schd|ctlg|gens)/i },
  { platform: "colleague", pattern: /\/Student\/(?:Courses|Student\/Courses)/i },
  // PeopleSoft URLs come in two flavors: /psc/ (content URL) and /psp/
  // (portal URL). Both indicate a Campus Solutions install.
  { platform: "peoplesoft", pattern: /\/ps[cp]\/[A-Z0-9_]+\/EMPLOYEE\/SA\//i },
  { platform: "jenzabar", pattern: /\/ICS\/(?:[A-Za-z_]+\.jnz)?/ },
  { platform: "coursedog", pattern: /coursedog\.com/i },
  { platform: "courseleaf", pattern: /[a-z0-9-]+\.courseleaf\.com|\/courseleaf\//i },
  { platform: "workday", pattern: /myworkday\.com|wd\d+\.myworkday\.com/i },
  { platform: "ellucian-experience", pattern: /experience\.elluciancloud\.com/i },
  { platform: "acalog", pattern: /\.acalog(?:\.com)?\b|\/index\.php\?catoid=/i },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeDomain(input: string): string {
  let s = input.trim();
  s = s.replace(/^https?:\/\//i, "");
  s = s.replace(/\/.*$/, "");
  s = s.replace(/^www\./i, "");
  return s.toLowerCase();
}

interface ProbeResponse {
  ok: boolean;
  status: number;
  finalUrl: string;
  body: string;
}

async function probe(url: string): Promise<ProbeResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": UA },
    });
    // Cap body read at 200 KB — markers are always near the top of the
    // page, and large pages (catalog dumps) waste memory.
    const body = (await resp.text()).slice(0, 200_000);
    return { ok: resp.ok, status: resp.status, finalUrl: resp.url, body };
  } catch {
    return { ok: false, status: 0, finalUrl: url, body: "" };
  } finally {
    clearTimeout(timer);
  }
}

function detectAuthGate(finalUrl: string, body: string): RegExp | null {
  for (const re of AUTH_REDIRECT_MARKERS) {
    if (re.test(finalUrl) || re.test(body)) return re;
  }
  return null;
}

// Run an array of async tasks with bounded concurrency.
async function pmap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

// ---------------------------------------------------------------------------
// Core fingerprint logic
// ---------------------------------------------------------------------------

interface ProbeJob {
  host: string;
  path: string;
  rule: ProbeRule;
}

function buildProbeJobs(domain: string, extraHosts: string[] = []): ProbeJob[] {
  const jobs: ProbeJob[] = [];
  for (const prefix of SUBDOMAIN_PREFIXES) {
    const host = prefix ? `${prefix}.${domain}` : domain;
    for (const rule of PROBES) {
      for (const path of rule.paths) {
        jobs.push({ host, path, rule });
      }
    }
  }
  // System-host probes: when a stateHint resolves to known shared hosts,
  // probe them as-is (no prefix multiplication — these are already full
  // SIS-style hostnames like `studentadmin.connectnd.us`).
  for (const host of extraHosts) {
    for (const rule of PROBES) {
      for (const path of rule.paths) {
        jobs.push({ host, path, rule });
      }
    }
  }
  return jobs;
}

function classifyHit(rule: ProbeRule, resp: ProbeResponse): PlatformMatch | null {
  if (resp.status < 200 || resp.status >= 400) return null;

  const evidence: string[] = [`HTTP ${resp.status} at ${resp.finalUrl}`];
  let confidence: Confidence = "low";

  // Body-marker confirmation
  const matchedMarkers = rule.markers.filter((m) => resp.body.includes(m));
  if (rule.markers.length > 0) {
    if (matchedMarkers.length === 0) {
      // 200 OK but no marker — too noisy to count as this platform
      return null;
    }
    confidence = "high";
    evidence.push(`body contains marker: ${matchedMarkers.join(", ")}`);
  } else {
    // Path-only signal: medium at best
    confidence = "medium";
  }

  // Final-URL marker bonus
  if (rule.redirectMarker?.test(resp.finalUrl)) {
    evidence.push(`final URL matches ${rule.redirectMarker}`);
    confidence = "high";
  }

  return {
    platform: rule.platform,
    url: resp.finalUrl,
    confidence,
    evidence,
  };
}

// Pick the single best candidate among matches. Higher confidence wins;
// within a confidence tier, more-specific platforms beat generic ones
// (banner-ssb-9 over webadvisor, etc., per PROBES order).
function pickBest(candidates: PlatformMatch[]): PlatformMatch | null {
  if (candidates.length === 0) return null;
  const tier: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };
  const platformOrder = new Map<Platform, number>(
    PROBES.map((p, i) => [p.platform, i] as const)
  );
  const ranked = [...candidates].sort((a, b) => {
    if (tier[a.confidence] !== tier[b.confidence]) {
      return tier[b.confidence] - tier[a.confidence];
    }
    return (platformOrder.get(a.platform) ?? 99) - (platformOrder.get(b.platform) ?? 99);
  });
  return ranked[0];
}

// Extract every absolute URL found in the page HTML. Looks at href / src
// attributes plus bare https:// strings (some Ellucian links live in
// inline JS or onclick handlers). Returns URLs deduplicated.
function extractLinks(html: string, baseDomain: string): string[] {
  const urls = new Set<string>();
  const hrefRe = /(?:href|src|action)\s*=\s*["']([^"'#]+)["']/gi;
  const bareRe = /https?:\/\/[^\s"'<>)]+/gi;
  let m;
  while ((m = hrefRe.exec(html)) !== null) {
    const u = m[1];
    if (/^https?:\/\//i.test(u)) {
      urls.add(u);
    } else if (u.startsWith("//")) {
      urls.add(`https:${u}`);
    } else if (u.startsWith("/")) {
      urls.add(`https://${baseDomain}${u}`);
    }
  }
  while ((m = bareRe.exec(html)) !== null) {
    urls.add(m[0]);
  }
  return [...urls];
}

// Find same-domain anchors on the homepage whose URL or surrounding link
// text suggests they go to a course-search / registration landing page.
// Returns up to `limit` URLs ranked by suggestive-keyword match. Used to
// drill one level deeper when the homepage itself doesn't link directly
// to the SIS (Valencia's SSB lives at /academics/schedule-search/, not /).
const REGISTRATION_KEYWORDS =
  /schedule|course[s-]?search|class[-_ ]?search|class[-_ ]?schedule|register|registration|courses|catalog/i;

function findRegistrationCandidates(
  html: string,
  baseDomain: string,
  limit: number
): string[] {
  // Anchor regex captures both the href and the inner text so we can score
  // by whichever signals first.
  const anchorRe =
    /<a\s+[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const ranked: Array<{ url: string; score: number }> = [];
  let m;
  while ((m = anchorRe.exec(html)) !== null) {
    const rawHref = m[1];
    const text = m[2].replace(/<[^>]+>/g, " ").trim();
    let absUrl: string;
    if (/^https?:\/\//i.test(rawHref)) {
      absUrl = rawHref;
    } else if (rawHref.startsWith("//")) {
      absUrl = `https:${rawHref}`;
    } else if (rawHref.startsWith("/")) {
      absUrl = `https://${baseDomain}${rawHref}`;
    } else {
      continue;
    }
    // Same-host check — drill into the college's own pages, not random
    // outbound links to social media etc.
    let host: string;
    try {
      host = new URL(absUrl).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (!host.endsWith(baseDomain)) continue;
    let score = 0;
    if (REGISTRATION_KEYWORDS.test(rawHref)) score += 2;
    if (REGISTRATION_KEYWORDS.test(text)) score += 1;
    if (score > 0) ranked.push({ url: absUrl, score });
  }
  // Dedupe + take top N
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of ranked.sort((a, b) => b.score - a.score)) {
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    out.push(r.url);
    if (out.length >= limit) break;
  }
  return out;
}

// Classify a discovered URL against URL_PATTERNS. Returns matches in
// patterns-list order so URL_PATTERNS' specificity is preserved.
function classifyUrl(url: string): Platform[] {
  const matches: Platform[] = [];
  for (const { platform, pattern } of URL_PATTERNS) {
    if (pattern.test(url)) matches.push(platform);
  }
  return matches;
}

export interface FingerprintOptions {
  /**
   * Two-letter state slug (e.g. "nd", "mn"). When set, the probe matrix
   * additionally targets that state's known shared SIS hosts. This catches
   * colleges whose SIS lives on a system-wide domain rather than their own
   * marketing host — e.g. Bismarck State's PeopleSoft Community Access lives
   * at studentadmin.connectnd.us, not anywhere under bismarckstate.edu.
   */
  stateHint?: string;
}

export async function fingerprint(
  input: string,
  opts: FingerprintOptions = {}
): Promise<FingerprintResult> {
  const domain = normalizeDomain(input);
  const evidence: string[] = [];
  const notes: string[] = [];
  const systemHosts = opts.stateHint
    ? STATE_SYSTEM_HOSTS[opts.stateHint.toLowerCase()] ?? []
    : [];

  // Step 1: hit the bare homepage to look for embedded catalogs and
  // auth-gate redirects. Also tells us if the college's domain even
  // resolves before we waste cycles enumerating subdomains.
  const homeResp = await probe(`https://${domain}/`);
  if (homeResp.status === 0) {
    notes.push(`Homepage https://${domain}/ failed to resolve`);
  }

  const homeMatches: PlatformMatch[] = [];
  if (homeResp.body) {
    for (const { platform, marker } of HOMEPAGE_MARKERS) {
      if (marker.test(homeResp.body)) {
        homeMatches.push({
          platform,
          url: homeResp.finalUrl,
          confidence: "medium",
          evidence: [`homepage HTML matches ${marker}`],
        });
      }
    }
  }

  // Step 1b: harvest links from the homepage. Many colleges publish their
  // SSB / Banner 8 / Colleague URL directly in their nav or registration
  // landing page, on a non-standard subdomain (e.g. valencia's
  // banner.aws.valenciacollege.edu, gulfcoast's reg-prod.gcsc.elluciancloud.com:8103
  // on port 8103) that subdomain enumeration alone will never find.
  //
  // If the homepage doesn't link directly to a known platform URL, drill
  // one level deeper into anchors that look like course-search nav
  // (schedule / register / classes / etc.). Valencia's SSB lives behind
  // /academics/schedule-search/index.php, not on the homepage.
  const harvestedProbes: PlatformMatch[] = [];
  if (homeResp.body) {
    const directLinks = extractLinks(homeResp.body, domain);
    const directlyClassified = directLinks.flatMap((url) =>
      classifyUrl(url).map((platform) => ({ url, platform }))
    );

    // Drill one level deeper if no direct platform-URLs were found at the
    // homepage. Capped at 5 candidate landing pages to keep latency
    // bounded — schedule-search is the keyword that hits 90% of cases.
    let drilledLinks: string[] = [];
    if (directlyClassified.length === 0) {
      const candidatePages = findRegistrationCandidates(homeResp.body, domain, 5);
      const candidateResponses = await pmap(
        candidatePages,
        async (url) => ({ url, resp: await probe(url) }),
        Math.min(PROBE_CONCURRENCY, 5)
      );
      for (const { resp } of candidateResponses) {
        if (resp.body) {
          drilledLinks = drilledLinks.concat(
            extractLinks(resp.body, domain)
          );
        }
      }
    }

    const harvestJobs: Array<{ url: string; platform: Platform }> = [
      ...directlyClassified,
      ...drilledLinks.flatMap((url) =>
        classifyUrl(url).map((platform) => ({ url, platform }))
      ),
    ];
    // Dedupe (url, platform) pairs and probe each. Cap to avoid hammering
    // a college that links to many platform-flavored URLs from its homepage.
    const seen = new Set<string>();
    const dedupedJobs = harvestJobs.filter((j) => {
      const k = `${j.platform}|${j.url}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const trimmed = dedupedJobs.slice(0, 32);

    const harvestResponses = await pmap(
      trimmed,
      async (j) => ({ ...j, resp: await probe(j.url) }),
      PROBE_CONCURRENCY
    );

    for (const { platform, url, resp } of harvestResponses) {
      if (resp.status === 0) continue;
      const authRe = detectAuthGate(resp.finalUrl, "");
      if (authRe) {
        harvestedProbes.push({
          platform: "auth-gated",
          url,
          confidence: "high",
          evidence: [`Homepage link ${url} redirected to ${resp.finalUrl}`],
        });
        continue;
      }
      // For URL-pattern-classified links, a 200 + matching final URL is
      // already strong evidence (the college published this link as its
      // own course-search). Boost to high confidence and evidence the
      // pattern that matched.
      if (resp.status >= 200 && resp.status < 400) {
        const evidenceList = [
          `homepage link ${url} → ${resp.finalUrl} (HTTP ${resp.status})`,
        ];
        // Body-marker confirmation when applicable
        const rule = PROBES.find((p) => p.platform === platform);
        if (rule && rule.markers.length > 0) {
          const matched = rule.markers.filter((m) => resp.body.includes(m));
          if (matched.length > 0) {
            evidenceList.push(`body contains marker: ${matched.join(", ")}`);
          }
        }
        harvestedProbes.push({
          platform,
          url: resp.finalUrl,
          confidence: "high",
          evidence: evidenceList,
        });
      }
    }
  }

  // Step 2: probe every (subdomain × path × platform) combo. Concurrency
  // bounded so we don't accidentally DOS a small college. When a stateHint
  // is given, also probe that state's known shared SIS hosts as-is.
  if (systemHosts.length > 0) {
    notes.push(
      `state hint "${opts.stateHint}" → additionally probing system hosts: ${systemHosts.join(", ")}`
    );
  }
  const jobs = buildProbeJobs(domain, systemHosts);
  const responses = await pmap(
    jobs,
    async (job) => {
      const url = `https://${job.host}${job.path}`;
      const resp = await probe(url);
      return { job, resp, url };
    },
    PROBE_CONCURRENCY
  );

  const probeMatches: PlatformMatch[] = [];
  let authGatedHit = false;

  for (const { job, resp, url } of responses) {
    if (resp.status === 0) continue;

    // Auth-gate detection — fingerprint anything that 302s into SSO
    const authRe = detectAuthGate(resp.finalUrl, "");
    if (authRe) {
      authGatedHit = true;
      probeMatches.push({
        platform: "auth-gated",
        url,
        confidence: "high",
        evidence: [`Redirected to ${resp.finalUrl} (matches ${authRe})`],
      });
      continue;
    }

    const match = classifyHit(job.rule, resp);
    if (match) {
      probeMatches.push({ ...match, url });
    }
  }

  // Step 3: combine + dedupe by (platform, url). When the same platform
  // is detected at multiple subdomains (very common with SSB at both
  // selfservice.X and ssb.X), keep the highest-confidence single entry.
  const all = [...homeMatches, ...harvestedProbes, ...probeMatches];
  const dedup = new Map<string, PlatformMatch>();
  for (const m of all) {
    const key = `${m.platform}|${m.url}`;
    const prev = dedup.get(key);
    if (!prev) {
      dedup.set(key, m);
      continue;
    }
    const tier: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };
    if (tier[m.confidence] > tier[prev.confidence]) dedup.set(key, m);
  }

  const candidates = [...dedup.values()];
  const best = pickBest(candidates);

  // Auth-gated takes precedence as the final platform IF nothing better
  // was found. If we found a real SIS endpoint AND a separate auth gate,
  // the SIS wins (the auth gate is just for the registration side).
  let platform: Platform;
  let confidence: Confidence;
  if (best && best.platform !== "auth-gated") {
    platform = best.platform;
    confidence = best.confidence;
    evidence.push(...best.evidence);
  } else if (authGatedHit) {
    platform = "auth-gated";
    confidence = "high";
    evidence.push("All candidate endpoints redirect to SSO");
  } else if (homeResp.body && homeResp.status >= 200 && homeResp.status < 400) {
    platform = "custom";
    confidence = "low";
    evidence.push("Homepage reachable but no known SIS endpoints found");
  } else {
    platform = "unknown";
    confidence = "low";
  }

  // Sort candidates by tier desc for human readability
  const tier: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };
  candidates.sort((a, b) => tier[b.confidence] - tier[a.confidence]);

  return {
    input,
    domain,
    platform,
    confidence,
    evidence,
    courseSearchUrl: best && best.platform !== "auth-gated" ? best.url : null,
    candidates,
    authGated: authGatedHit,
    notes,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): {
  inputs: string[];
  json: boolean;
  err?: string;
} {
  const inputs: string[] = [];
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url" || a === "--domain") {
      const v = argv[++i];
      if (!v) return { inputs: [], json, err: `${a} requires a value` };
      inputs.push(v);
    } else if (a === "--urls") {
      const v = argv[++i];
      if (!v) return { inputs: [], json, err: `--urls requires a comma list` };
      inputs.push(...v.split(",").map((x) => x.trim()).filter(Boolean));
    } else if (a === "--json") {
      json = true;
    } else if (a === "--help" || a === "-h") {
      return { inputs: [], json, err: "help" };
    }
  }
  return { inputs, json };
}

function printHelp() {
  console.log(`Usage:
  npx tsx scripts/lib/fingerprint-college.ts --url <url> [--json]
  npx tsx scripts/lib/fingerprint-college.ts --domain <domain>
  npx tsx scripts/lib/fingerprint-college.ts --urls <url1,url2,...>

Identifies the SIS platform a college runs by probing well-known
endpoints. Returns one of: banner-ssb-9, banner-8, colleague, peoplesoft,
jenzabar, coursedog, workday, ellucian-experience, courseleaf, webadvisor,
acalog, auth-gated, custom, unknown.

Examples:
  npx tsx scripts/lib/fingerprint-college.ts --url https://www.valenciacollege.edu
  npx tsx scripts/lib/fingerprint-college.ts --domain mdc.edu --json
`);
}

function printHumanResult(r: FingerprintResult) {
  const conf = r.confidence === "high" ? "✓" : r.confidence === "medium" ? "?" : "·";
  console.log(`\n${conf} ${r.input}`);
  console.log(`    domain:     ${r.domain}`);
  console.log(`    platform:   ${r.platform} (${r.confidence})`);
  if (r.courseSearchUrl) {
    console.log(`    courseUrl:  ${r.courseSearchUrl}`);
  }
  for (const e of r.evidence) {
    console.log(`    evidence:   ${e}`);
  }
  if (r.candidates.length > 1) {
    console.log(`    other matches:`);
    for (const c of r.candidates) {
      if (c.url === r.courseSearchUrl && c.platform === r.platform) continue;
      console.log(`      - ${c.platform} (${c.confidence}) ${c.url}`);
    }
  }
  for (const n of r.notes) {
    console.log(`    note:       ${n}`);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const { inputs, json, err } = parseArgs(argv);
  if (err === "help" || (!err && inputs.length === 0)) {
    printHelp();
    process.exit(err === "help" ? 0 : 1);
  }
  if (err) {
    console.error(`Error: ${err}`);
    printHelp();
    process.exit(1);
  }

  const results: FingerprintResult[] = [];
  for (const input of inputs) {
    const r = await fingerprint(input);
    results.push(r);
    if (!json) printHumanResult(r);
  }

  if (json) {
    console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
  } else {
    // One-line summary at the bottom
    const summary = new Map<Platform, number>();
    for (const r of results) summary.set(r.platform, (summary.get(r.platform) ?? 0) + 1);
    if (results.length > 1) {
      console.log(`\nSummary (${results.length} colleges):`);
      for (const [p, n] of [...summary.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${p.padEnd(20)} ${n}`);
      }
    }
  }
}

// Only run main when invoked as a script (not when imported as a library).
const isMain =
  import.meta.url.startsWith("file:") &&
  process.argv[1] &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}

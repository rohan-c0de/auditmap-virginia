/**
 * State registry — central configuration for multi-state expansion.
 *
 * Each state is defined by a StateConfig that encapsulates all state-specific
 * data: college system details, policies, branding, and external URLs.
 * Shared library code uses the state slug to load the right config + data.
 */

export interface SeniorWaiverConfig {
  ageThreshold: number;
  legalCitation: string;
  description: string;
  bannerTitle: string;
  bannerSummary: string;
  bannerDetail: string;
}

/**
 * One scrape job unit: a group of scripts run on the same runner.
 * A state can have multiple jobs per data type when scrapers target
 * different platforms (e.g. VA courses splits across VCCS-HTTP and
 * PeopleSoft-Playwright).
 *
 * `scripts` are repo-relative tsx paths, e.g. "scripts/va/scrape-vccs.ts".
 * `runner` controls whether the scheduled workflow needs Playwright installed.
 */
export interface ScrapeJob {
  scripts: string[];
  runner: "http" | "playwright";
  /**
   * Which term-resolution system to use (see scripts/lib/resolve-terms.ts).
   * When set, the scheduled workflow resolves live terms and passes --term
   * to each script. Omit for scrapers that auto-discover terms internally
   * or don't have term semantics (transfers, prereqs).
   */
  termSystem?: string;
}

/**
 * Declares which scheduled-scrape coverage a state has. Issue #59: this
 * registry field — not YAML — is the source of truth for what gets
 * re-scraped on cron. A unified workflow (PR 2) reads these entries to
 * build its matrix. A CI check (PR 1, this PR) fails any change that
 * registers a new state without populating this field or explicitly
 * opting out.
 */
export interface ScraperCoverage {
  /** Course-section scrapers, writing data/{state}/courses/**. */
  courses?: ScrapeJob[];
  /** Transfer-equivalency scrapers, writing data/{state}/transfer-equiv.json. */
  transfers?: ScrapeJob[];
  /**
   * Prereq coverage. Either dedicated scrape jobs writing data/{state}/prereqs.json,
   * or `aggregate-from-courses` for states where prereqs are flattened out of
   * the course scrape (prerequisite_text field on each section) rather than
   * scraped independently.
   */
  prereqs?: ScrapeJob[] | { source: "aggregate-from-courses" };
  /** Degree/program requirement scrapers, writing data/{state}/programs/**. */
  programs?: ScrapeJob[];
}

export interface StateConfig {
  /** Two-letter lowercase state slug, e.g. "va", "md", "nc" */
  slug: string;
  /** Full state name, e.g. "Virginia" */
  name: string;
  /** Name of the community college system, e.g. "VCCS" */
  systemName: string;
  /** Full name of the system, e.g. "Virginia Community College System" */
  systemFullName: string;
  /** System website URL */
  systemUrl: string;
  /** Number of colleges in the system */
  collegeCount: number;
  /** Senior tuition waiver config, or null if no waiver exists */
  seniorWaiver: SeniorWaiverConfig | null;
  /** Whether transfer equivalency data is available */
  transferSupported: boolean;
  /** Popular CC courses for transfer compare presets (e.g. ["ENGL 1101", "MATH 1111"]) */
  popularCourses: string[];
  /** Build the external course discovery URL for a specific course */
  courseDiscoveryUrl: (collegeSlug: string, prefix: string, number: string, term?: string) => string;
  /** Build the external URL for a college's course listing page */
  collegeCoursesUrl: (collegeSlug: string) => string;
  /** Default zip code placeholder for search forms */
  defaultZip: string;
  /** Default city for the search form placeholder (paired with defaultZip), e.g. "Atlanta" */
  defaultZipCity: string;
  /** Branding and SEO */
  branding: {
    siteName: string;
    tagline: string;
    footerText: string;
    disclaimer: string;
    metaKeywords: string[];
  };
  /**
   * Scheduled-scrape coverage. Declarative source of truth for cron
   * orchestration — see issue #59. Leaving this `undefined` requires a
   * `// manual-only: <reason>` marker in the config file (enforced by
   * scripts/check-scraper-coverage.ts).
   */
  scrapers?: ScraperCoverage;
  /**
   * University aliases for the LLM classifier. Injected per-state into the
   * user message so the system prompt stays cacheable across states.
   */
  universityAliases?: Array<{ slug: string; names: string[] }>;
  /**
   * Known structural ceilings — gaps in the data that have a documented
   * reason and cannot be closed through normal scraping work. The audit
   * grader uses this to distinguish "C-tier because of unfinished work"
   * from "C-tier because of a real-world constraint". Each value is a
   * one-line reason a reviewer would accept.
   *
   * Examples: DC's transfers (UDC's CT.Net data targets only out-of-state
   * schools; the in-state-only rule strips it to empty); NH's transfers
   * (UNH/Plymouth publish no public articulation database); SC's NETC and
   * Williamsburg courses (Colleague Self-Service is auth-gated).
   */
  documentedCeilings?: {
    transfers?: string;
    scorecard?: string;
    /** Per-college course-coverage gaps that won't be closed. */
    courses?: Array<{ collegeSlug: string; reason: string }>;
    /** Programs / degree-plan coverage gap — typically PDF-only catalogs
     *  or descriptive prose pages with no structured curriculum. */
    programs?: string;
  };
  /**
   * Build-time SSG priority. When true, this state's per-college pages
   * (and any other route opting into the same flag) are pre-rendered at
   * build time. When false/undefined, pages render on demand via ISR
   * on the first visit and cache for the route's `revalidate` window.
   *
   * Tier this against actual Search Console traffic, not population —
   * see #702 for the analysis. Promote a state when its `/[state]/college/`
   * clicks consistently land in the top quartile across 90-day windows.
   * Demoting is fine too if a previously hot state's traffic drops; the
   * route remains functional under ISR.
   */
  prerenderAtBuild?: boolean;
}

// ---------------------------------------------------------------------------
// Registry — static imports so this module is safe on the edge runtime.
// `require()` only works on Node; static `import` gets statically analyzed
// and bundled by Turbopack/Next for both Node and edge.
// ---------------------------------------------------------------------------

import vaConfig from "./va/config";
import ncConfig from "./nc/config";
import scConfig from "./sc/config";
import dcConfig from "./dc/config";
import mdConfig from "./md/config";
import gaConfig from "./ga/config";
import deConfig from "./de/config";
import tnConfig from "./tn/config";
import nyConfig from "./ny/config";
import riConfig from "./ri/config";
import vtConfig from "./vt/config";
import ctConfig from "./ct/config";
import meConfig from "./me/config";
import paConfig from "./pa/config";
import njConfig from "./nj/config";
import nhConfig from "./nh/config";
import maConfig from "./ma/config";
import wvConfig from "./wv/config";
import flConfig from "./fl/config";
import kyConfig from "./ky/config";
import alConfig from "./al/config";
import msConfig from "./ms/config";
import ohConfig from "./oh/config";
import miConfig from "./mi/config";
import iaConfig from "./ia/config";
import moConfig from "./mo/config";
import txConfig from "./tx/config";
import ilConfig from "./il/config";
import hiConfig from "./hi/config";
import mtConfig from "./mt/config";
import orConfig from "./or/config";
import caConfig from "./ca/config";
import nvConfig from "./nv/config";
import azConfig from "./az/config";
import arConfig from "./ar/config";
import mnConfig from "./mn/config";
import laConfig from "./la/config";
import nmConfig from "./nm/config";
import sdConfig from "./sd/config";
import utConfig from "./ut/config";
import waConfig from "./wa/config";
import ndConfig from "./nd/config";
import wyConfig from "./wy/config";
import akConfig from "./ak/config";

const ALL_CONFIGS: StateConfig[] = [
  vaConfig,
  ncConfig,
  scConfig,
  dcConfig,
  mdConfig,
  gaConfig,
  deConfig,
  tnConfig,
  nyConfig,
  riConfig,
  vtConfig,
  ctConfig,
  meConfig,
  paConfig,
  njConfig,
  nhConfig,
  maConfig,
  wvConfig,
  flConfig,
  kyConfig,
  alConfig,
  msConfig,
  ohConfig,
  miConfig,
  iaConfig,
  moConfig,
  txConfig,
  ilConfig,
  hiConfig,
  mtConfig,
  orConfig,
  caConfig,
  nvConfig,
  azConfig,
  arConfig,
  mnConfig,
  laConfig,
  nmConfig,
  sdConfig,
  utConfig,
  waConfig,
  ndConfig,
  wyConfig,
  akConfig,
];

const configs: Record<string, StateConfig> = Object.fromEntries(
  ALL_CONFIGS.map((c) => [c.slug, c])
);

/** Get the config for a specific state. Throws if unknown. */
export function getStateConfig(slug: string): StateConfig {
  const cfg = configs[slug];
  if (!cfg) {
    throw new Error(`Unknown state: "${slug}". Available: ${Object.keys(configs).join(", ")}`);
  }
  return cfg;
}

/** Get all registered state configs. */
export function getAllStates(): StateConfig[] {
  return ALL_CONFIGS;
}

/** Check if a state slug is valid. */
export function isValidState(slug: string): boolean {
  return slug in configs;
}

/** Get the default state slug (used for redirects / single-state mode). */
export function getDefaultState(): string {
  return "va";
}

/**
 * Whether a state has prereq coverage (drives Plan-link visibility in the
 * header). Reads from the registry's declared scraper coverage instead of
 * an `fs.existsSync` check on the prereqs.json path at request time.
 *
 * The registry is the source of truth: a state has prereqs if it declares
 * any prereq scraper job (dedicated or `aggregate-from-courses`). Using
 * the registry keeps the layout free of `fs` calls, which means the
 * prereqs JSON files no longer need to be force-bundled into every state
 * route function — only the API routes that actually parse them. That
 * cut the per-function bundle size by enough to clear Vercel's 250 MB
 * serverless limit.
 */
export function hasPrereqsCoverage(slug: string): boolean {
  const cfg = configs[slug];
  if (!cfg?.scrapers?.prereqs) return false;
  const p = cfg.scrapers.prereqs;
  // Either a list of scrape jobs OR the aggregate-from-courses sentinel.
  return Array.isArray(p) ? p.length > 0 : p.source === "aggregate-from-courses";
}

export function hasProgramsCoverage(slug: string): boolean {
  const cfg = configs[slug];
  return (cfg?.scrapers?.programs ?? []).length > 0;
}

/**
 * Returns the slugs whose pages should be pre-rendered at build time
 * (`prerenderAtBuild: true` in the StateConfig). All other states' pages
 * defer to ISR-on-demand rendering.
 *
 * Tracked separately from `getAllStates()` so build-time iteration
 * (`generateStaticParams`) doesn't have to re-check the flag at every
 * call site. See #702 for the SSG-priority rationale.
 */
export function getPrerenderStates(): StateConfig[] {
  return ALL_CONFIGS.filter((c) => c.prerenderAtBuild === true);
}
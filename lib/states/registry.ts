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
}

// ---------------------------------------------------------------------------
// Registry — import each state's config lazily
// ---------------------------------------------------------------------------

const configs: Record<string, StateConfig> = {};

function ensureLoaded(): void {
  if (Object.keys(configs).length > 0) return;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const va = require("./va/config").default as StateConfig;
  configs[va.slug] = va;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nc = require("./nc/config").default as StateConfig;
  configs[nc.slug] = nc;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sc = require("./sc/config").default as StateConfig;
  configs[sc.slug] = sc;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const dc = require("./dc/config").default as StateConfig;
  configs[dc.slug] = dc;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const md = require("./md/config").default as StateConfig;
  configs[md.slug] = md;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ga = require("./ga/config").default as StateConfig;
  configs[ga.slug] = ga;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const de = require("./de/config").default as StateConfig;
  configs[de.slug] = de;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const tn = require("./tn/config").default as StateConfig;
  configs[tn.slug] = tn;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ny = require("./ny/config").default as StateConfig;
  configs[ny.slug] = ny;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ri = require("./ri/config").default as StateConfig;
  configs[ri.slug] = ri;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const vt = require("./vt/config").default as StateConfig;
  configs[vt.slug] = vt;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ct = require("./ct/config").default as StateConfig;
  configs[ct.slug] = ct;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const me = require("./me/config").default as StateConfig;
  configs[me.slug] = me;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pa = require("./pa/config").default as StateConfig;
  configs[pa.slug] = pa;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nj = require("./nj/config").default as StateConfig;
  configs[nj.slug] = nj;
}

/** Get the config for a specific state. Throws if unknown. */
export function getStateConfig(slug: string): StateConfig {
  ensureLoaded();
  const cfg = configs[slug];
  if (!cfg) {
    throw new Error(`Unknown state: "${slug}". Available: ${Object.keys(configs).join(", ")}`);
  }
  return cfg;
}

/** Get all registered state configs. */
export function getAllStates(): StateConfig[] {
  ensureLoaded();
  return Object.values(configs);
}

/** Check if a state slug is valid. */
export function isValidState(slug: string): boolean {
  ensureLoaded();
  return slug in configs;
}

/** Get the default state slug (used for redirects / single-state mode). */
export function getDefaultState(): string {
  return "va";
}

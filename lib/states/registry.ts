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

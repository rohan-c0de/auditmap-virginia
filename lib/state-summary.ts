/**
 * state-summary.ts — per-state precomputed page-summary manifests (#946).
 *
 * The state-landing page (`app/[state]/page.tsx`) renders a few *derived*
 * values that each require loading a state's full dataset (online-course
 * counts, qualifying program slugs, statewide insights). Computing those at
 * build time, for every state, is what pushed the Vercel build into OOM /
 * Supabase-pool-saturation (see next.config + #946).
 *
 * Instead, a precompute step (`scripts/build-state-summaries.ts`, run in the
 * scrape pipeline — NOT the deploy build) writes a tiny committed manifest per
 * state to `data/{state}/summary.json`. Pages read the manifest, so the build
 * does no heavy data loading and stays cheap regardless of state count.
 *
 * This first slice (#946 step 1) covers `showOnline` + `programSlugs`. The
 * heavier statewide-insights prose is migrated in a follow-up. Callers should
 * treat a missing manifest as "not precomputed yet" and fall back to the live
 * loaders, so behavior is never worse than before and brand-new states work
 * before the precompute has run.
 */

import * as fs from "fs";
import * as path from "path";

export interface StateSummary {
  /** Whether the state has enough online-course data to surface the online hub link. */
  showOnline: boolean;
  /** Online section count rendered in the hub callout (0 when showOnline is false). */
  onlineSections: number;
  /** Online-offering college count rendered in the hub callout. */
  onlineColleges: number;
  /** Slugs of programs that qualify for the programs hub (have a renderable plan). */
  programSlugs: string[];
  /** ISO timestamp the manifest was generated (provenance/freshness). */
  generatedAt: string;
}

/**
 * Read a state's precomputed summary manifest. Returns null when the file is
 * absent or unparseable — callers fall back to live loaders in that case.
 * Synchronous fs read: only invoked from server components at build / ISR time.
 */
export function loadStateSummary(state: string): StateSummary | null {
  try {
    const file = path.join(process.cwd(), "data", state, "summary.json");
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.showOnline === "boolean" &&
      Array.isArray(parsed.programSlugs)
    ) {
      return parsed as StateSummary;
    }
    return null;
  } catch {
    return null;
  }
}

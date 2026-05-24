/**
 * add-state.ts (orchestrator)
 *
 * Top-level orchestrator for the auto-add-state skill. Given a state slug,
 * runs the entire 6-phase workflow end-to-end:
 *
 *   Phase 1  Bootstrap (PR 6)        — institutions.json, zipcodes.json,
 *                                       config.ts skeleton, registry edits
 *   Phase 2a Fingerprint (PR 1)       — classify each college's SIS platform
 *   Phase 2b Course scraping          — instantiate the matching template:
 *                                       - banner-ssb-9 → PR 2's template
 *                                       - colleague    → PR 3's template
 *                                       - banner-8     → PR 4's template
 *                                       - other        → flag manual TODO
 *   Phase 3  Articulation (PR 5)      — lookup state in articulation-portals
 *                                       registry; run scripts if registered,
 *                                       else flag CollegeTransfer.Net fallback
 *   Phase 4  Prereqs aggregation      — call existing aggregate-prereqs.ts
 *                                       to roll inline prereq data into
 *                                       data/{state}/prereqs.json
 *   Phase 6  Programs discovery      — probe each college for a public catalog
 *                                       on a templated platform (acalog,
 *                                       courseleaf, smartcatalogiq, coursedog,
 *                                       cleancatalog) and emit a per-state
 *                                       scrape-programs.ts wrapper. Does NOT
 *                                       execute the scrape — operator validates
 *                                       URLs first and runs it manually.
 *   Phase 5  Scorecard ingest (#392)  — map each college to its IPEDS unitid,
 *                                       fetch federal cost/aid/completion
 *                                       data into data/{state}/scorecard/.
 *
 * Programs discovery is left as a manual TODO — IPEDS-driven program
 * discovery isn't templated yet, and the existing program-scraper
 * templates (Acalog/Coursedog/etc.) require per-college catalog URLs that
 * the orchestrator can't reliably auto-derive.
 *
 * Failure handling: every phase runs in a try/catch. A single college's
 * scraper failure or a single phase's API hiccup is recorded in
 * `manualTodos` and the orchestrator continues to the next phase. Only
 * bootstrap failure is fatal (without it there are no files to scrape into).
 *
 * This script does NOT touch git or open PRs. The auto-add-state skill
 * (PR 8) wraps this orchestrator with the commit/push/PR flow so the
 * scope of "what data was generated" is cleanly separated from "how was
 * it shipped." Run this script directly to generate files, then commit
 * them yourself; or invoke the skill for the full autonomous flow.
 *
 * CLI:
 *   npx tsx scripts/lib/add-state.ts --state oh
 *   npx tsx scripts/lib/add-state.ts --state oh --dry-run
 *   npx tsx scripts/lib/add-state.ts --state oh --skip-courses --skip-transfers
 *   npx tsx scripts/lib/add-state.ts --state oh --college-filter sinclair
 *
 * Library:
 *   import { addState } from "../lib/add-state";
 *   const result = await addState({ state: "oh" });
 */

import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { loadEnv } from "./load-env";
import {
  bootstrapState,
  type BootstrapStateResult,
} from "./bootstrap-state";
import {
  fingerprint,
  type FingerprintResult,
  type Platform,
} from "./fingerprint-college";
import {
  clusterFingerprints,
  type Cluster,
  type ClusterInput,
} from "./cluster-fingerprints";
import {
  discoverPublicCommunityColleges,
  type DiscoveredCollege,
} from "./discover-colleges";
import {
  scrapeBannerSsbState,
  type ScrapeStateResult as SsbStateResult,
} from "./scrape-banner-ssb";
import {
  scrapeColleagueState,
  type ScrapeStateResult as ColleagueStateResult,
} from "./scrape-colleague";
import {
  scrapeBanner8ByHost,
  type ScrapeStateResult as Banner8StateResult,
} from "./scrape-banner-8";
import {
  scrapeJenzabarState,
  type ScrapeStateResult as JenzabarStateResult,
} from "./scrape-jenzabar";
import {
  scrapeCoursedogCatalog,
  type ScrapeCoursedogResult,
} from "./scrape-coursedog";
import {
  discoverPrograms,
  renderProgramsWrapper,
  type ProgramCatalogHit,
  type ProgramCatalogMiss,
} from "./discover-programs";
import {
  lookupArticulationPortal,
  getFallbackPortal,
  type PortalEntry,
} from "./articulation-portals";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AddStateOptions {
  state: string;
  /** Plan everything but don't write files, don't run scrapers, don't import. */
  dryRun?: boolean;
  /** Skip Phase 1 (useful when re-running on an existing state). */
  skipBootstrap?: boolean;
  /** Skip Phase 2a (fingerprint). Phase 2b is auto-skipped if no fingerprint data. */
  skipFingerprint?: boolean;
  /** Skip Phase 2a.5 (multi-college-district cluster detection). */
  skipCluster?: boolean;
  /** Skip Phase 2b (course scraping). Useful for "fingerprint only" runs. */
  skipCourses?: boolean;
  /** Skip Phase 3 (transfers). */
  skipTransfers?: boolean;
  /** Skip Phase 4 (prereqs). */
  skipPrereqs?: boolean;
  /** Skip Phase 6 (programs discovery). */
  skipPrograms?: boolean;
  /** Skip Phase 5 (scorecard ingest). Useful when the API key isn't set. */
  skipScorecard?: boolean;
  /** Filter to a single college slug (debug aid). */
  collegeFilter?: string;
  /** Override IPEDS year. Default = latest known. */
  ipedsYear?: number;
}

export interface FingerprintedCollege {
  college: DiscoveredCollege;
  fingerprint: FingerprintResult;
}

export interface AddStateResult {
  state: string;
  startedAt: string;
  finishedAt: string;
  bootstrap: BootstrapStateResult | null;
  fingerprint: {
    byPlatform: Partial<Record<Platform, FingerprintedCollege[]>>;
    flagged: { slug: string; platform: Platform; note: string }[];
  };
  /** Phase 2a.5 — multi-college-district clustering of untemplated colleges. */
  clusters: {
    /** Clusters of 2+ colleges sharing a SIS host or registrable domain. */
    found: Cluster[];
    /** Untemplated colleges that didn't cluster with anyone. */
    singletons: { slug: string; primaryUrl: string }[];
    /** True if data/{state}/clusters.json was written. */
    written: boolean;
    error?: string;
  };
  courses: {
    bannerSsb?: SsbStateResult;
    colleague?: ColleagueStateResult;
    banner8?: Banner8StateResult;
    jenzabar?: JenzabarStateResult;
    /** Colleges whose platform has no scraper template yet. */
    skippedPlatforms: { slug: string; platform: Platform; reason: string }[];
  };
  catalog: {
    /** One result per college whose fingerprint matched a catalog platform. */
    coursedog?: ScrapeCoursedogResult[];
  };
  transfers: {
    portal: PortalEntry | null;
    scriptsRun: { script: string; ok: boolean; ms: number }[];
    fallbackSuggestion: string | null;
  };
  prereqs: {
    aggregated: boolean;
    error?: string;
  };
  scorecard: {
    /** Number of (state, college) pairs with a unitid after mapping. */
    mapped: number;
    /** Number of scorecard JSON files written under data/{state}/scorecard/. */
    ingested: number;
    /** True if the phase ran and produced data; false if skipped/failed. */
    ran: boolean;
    error?: string;
  };
  /** Phase 6 — catalog-platform discovery for the programs scraper.
   *  Does NOT execute the scrape; emits a per-state wrapper file the
   *  operator runs after validating the discovered URLs. */
  programs: {
    hits: ProgramCatalogHit[];
    misses: ProgramCatalogMiss[];
    /** Path of the per-state wrapper written under scripts/{state}/, or null. */
    wrapperPath: string | null;
    ran: boolean;
    error?: string;
  };
  manualTodos: string[];
  durations: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Platform → scraper-template dispatcher
// ---------------------------------------------------------------------------

/** Platforms we have course-scraper templates for in PRs 2–4. These are
 *  primary class-section platforms — return per-term schedule data. */
const TEMPLATED_COURSE_PLATFORMS: Platform[] = [
  "banner-ssb-9",
  "colleague",
  "banner-8",
  "jenzabar",
];

/** Catalog/curriculum platforms — return course definitions + prereqs but
 *  not class sections. Scraped in Phase 2c (separate from Phase 2b
 *  course-section scraping); the data feeds Phase 4 prereq aggregation. */
const CATALOG_PLATFORMS: Platform[] = ["coursedog"];

/** Platforms we KNOW are course-search platforms but don't have a template
 *  for. Marking them explicitly distinguishes "no template yet" from
 *  "platform unrecognized" in the final report. */
const UNTEMPLATED_COURSE_PLATFORMS: Platform[] = [
  "peoplesoft",
  "workday",
  "ellucian-experience",
  "webadvisor",
];

// ---------------------------------------------------------------------------
// Helper — run a child process and capture exit code + duration
// ---------------------------------------------------------------------------

function runSubprocess(
  command: string,
  args: string[],
  silent = false
): Promise<{ ok: boolean; ms: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: silent ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    if (silent) {
      child.stdout?.on("data", (d) => {
        stdout += d.toString();
      });
      child.stderr?.on("data", (d) => {
        stderr += d.toString();
      });
    }
    child.on("close", (code) => {
      resolve({ ok: code === 0, ms: Date.now() - start, stdout, stderr });
    });
    child.on("error", (err) => {
      resolve({ ok: false, ms: Date.now() - start, stdout, stderr: String(err) });
    });
  });
}

// ---------------------------------------------------------------------------
// Phase 1: Bootstrap
// ---------------------------------------------------------------------------

async function phaseBootstrap(
  state: string,
  opts: AddStateOptions,
  todos: string[]
): Promise<BootstrapStateResult | null> {
  if (opts.skipBootstrap) {
    console.log("Phase 1 (bootstrap): skipped (--skip-bootstrap).");
    return null;
  }
  console.log("\n=== Phase 1: Bootstrap ===");
  const r = await bootstrapState({
    state,
    dryRun: opts.dryRun,
    ipedsYear: opts.ipedsYear,
  });
  // Forward all bootstrap TODOs to the orchestrator's TODO list
  for (const t of r.manualTodos) todos.push(`[bootstrap] ${t}`);
  if (r.collegesDiscovered === 0) {
    todos.push(
      `[bootstrap] CRITICAL: 0 colleges discovered. The remaining phases will be no-ops.`
    );
  }
  return r;
}

// ---------------------------------------------------------------------------
// Phase 2a: Fingerprint every college
// ---------------------------------------------------------------------------

async function phaseFingerprint(
  state: string,
  opts: AddStateOptions,
  todos: string[]
): Promise<{
  byPlatform: Partial<Record<Platform, FingerprintedCollege[]>>;
  flagged: { slug: string; platform: Platform; note: string }[];
}> {
  if (opts.skipFingerprint) {
    console.log("Phase 2a (fingerprint): skipped (--skip-fingerprint).");
    return { byPlatform: {}, flagged: [] };
  }
  console.log("\n=== Phase 2a: Fingerprint ===");

  // Re-discover colleges (cheap; same IPEDS query as bootstrap). We could
  // pipe through bootstrap's result, but recomputing decouples the phase
  // and lets --skip-bootstrap still produce a fingerprint pass.
  const colleges = await discoverPublicCommunityColleges(state, {
    year: opts.ipedsYear,
  });
  const filtered = opts.collegeFilter
    ? colleges.filter((c) => c.slug === opts.collegeFilter)
    : colleges;

  if (filtered.length === 0) {
    console.log(`  No colleges to fingerprint (filter=${opts.collegeFilter ?? "(none)"}).`);
    return { byPlatform: {}, flagged: [] };
  }

  console.log(`  Probing ${filtered.length} college(s)...`);
  const byPlatform: Partial<Record<Platform, FingerprintedCollege[]>> = {};
  const flagged: { slug: string; platform: Platform; note: string }[] = [];

  for (let i = 0; i < filtered.length; i++) {
    const c = filtered[i];
    if (!c.primaryUrl) {
      console.log(`  [${i + 1}/${filtered.length}] ${c.slug} — IPEDS has no URL; skipping`);
      flagged.push({
        slug: c.slug,
        platform: "unknown",
        note: "IPEDS returned no primary URL — manual lookup needed",
      });
      todos.push(
        `[fingerprint] ${c.slug} (${c.name}): no website URL in IPEDS. Look up manually and re-run with the URL.`
      );
      continue;
    }
    const fp = await fingerprint(`https://${c.primaryUrl}`);
    process.stdout.write(
      `  [${i + 1}/${filtered.length}] ${c.slug.padEnd(36)} ${fp.platform} (${fp.confidence})\n`
    );
    const arr = byPlatform[fp.platform] ?? [];
    arr.push({ college: c, fingerprint: fp });
    byPlatform[fp.platform] = arr;
  }

  // Flag platforms that aren't templated for course scraping. Catalog
  // platforms (Coursedog, etc.) are NOT flagged here — they're handled
  // by Phase 2c instead, since they yield catalog/prereq data rather
  // than class sections.
  //
  // We only populate the `flagged` data here; the corresponding TODOs are
  // emitted by `phaseCluster` (Phase 2a.5), which groups multi-college-
  // district clusters into single TODOs instead of N per-college ones.
  for (const platform of Object.keys(byPlatform) as Platform[]) {
    const cohort = byPlatform[platform]!;
    if (TEMPLATED_COURSE_PLATFORMS.includes(platform)) continue;
    if (CATALOG_PLATFORMS.includes(platform)) continue;
    const reason = UNTEMPLATED_COURSE_PLATFORMS.includes(platform)
      ? `platform '${platform}' has no scraper template yet — manual scraper needed`
      : platform === "auth-gated"
        ? "auth-gated (SSO/SAML) — no public guest access; can't scrape"
        : platform === "custom"
          ? "custom HTML/SPA — no template fits; bespoke scraper needed"
          : platform === "unknown"
            ? "no SIS platform detected — verify the college's URL and re-fingerprint"
            : `platform '${platform}' is not a course-search system (catalog/programs only)`;
    for (const entry of cohort) {
      flagged.push({ slug: entry.college.slug, platform, note: reason });
    }
  }

  return { byPlatform, flagged };
}

// ---------------------------------------------------------------------------
// Phase 2a.5: Cluster detection for untemplated colleges (issue #497)
// ---------------------------------------------------------------------------
//
// `phaseFingerprint` returns `flagged[]` — one entry per college whose
// platform isn't templated for course scraping. Without clustering, the
// orchestrator would emit one TODO per flagged college, even when N of
// them share the same SIS (LACCD's 9, Los Rios' 4, State Center's 4, etc.).
//
// This phase:
//   1. Collects the flagged colleges (custom, unknown, peoplesoft, ellucian-
//      experience, webadvisor, auth-gated).
//   2. Calls clusterFingerprints() to group them by registrable domain +
//      shared SIS host (HTTP-probed from the home page).
//   3. Persists data/{state}/clusters.json for downstream scraper PRs.
//   4. Emits manualTodos[] as a small number of [fingerprint-cluster]
//      entries plus [fingerprint] entries for singletons.

async function phaseCluster(
  state: string,
  opts: AddStateOptions,
  fpResult: AddStateResult["fingerprint"],
  todos: string[],
): Promise<AddStateResult["clusters"]> {
  const out: AddStateResult["clusters"] = {
    found: [],
    singletons: [],
    written: false,
  };

  if (opts.skipCluster) {
    console.log("Phase 2a.5 (cluster): skipped (--skip-cluster).");
    // Fall back to per-college TODOs since we won't be grouping them.
    for (const f of fpResult.flagged) {
      todos.push(`[fingerprint] ${f.slug}: ${f.note}`);
    }
    return out;
  }

  console.log("\n=== Phase 2a.5: Cluster detection ===");

  // Build the input set: colleges whose platforms aren't templated and
  // aren't catalog-only. Pull primaryUrl from the fingerprint.input.
  const flaggedSlugs = new Set(fpResult.flagged.map((f) => f.slug));
  const inputs: ClusterInput[] = [];
  for (const platform of Object.keys(fpResult.byPlatform) as Platform[]) {
    if (TEMPLATED_COURSE_PLATFORMS.includes(platform)) continue;
    if (CATALOG_PLATFORMS.includes(platform)) continue;
    const cohort = fpResult.byPlatform[platform]!;
    for (const entry of cohort) {
      if (!flaggedSlugs.has(entry.college.slug)) continue;
      const host = entry.fingerprint.domain || entry.college.primaryUrl;
      if (!host) continue;
      inputs.push({
        slug: entry.college.slug,
        name: entry.college.name,
        primaryUrl: host,
        fingerprint: entry.fingerprint,
      });
    }
  }

  if (inputs.length === 0) {
    console.log("  No untemplated colleges — skipping clustering.");
    return out;
  }

  console.log(`  Clustering ${inputs.length} untemplated college(s)...`);
  let lastReport = 0;
  const clusterResult = await clusterFingerprints(inputs, {
    probeDeep: true,
    onProgress: (done, total) => {
      // Throttle progress logs to every 10 colleges
      if (done - lastReport >= 10 || done === total) {
        process.stdout.write(`\r  HTTP-probed ${done}/${total}`);
        lastReport = done;
      }
    },
  });
  process.stdout.write("\n");

  out.found = clusterResult.clusters;
  out.singletons = clusterResult.singletons.map((s) => ({
    slug: s.slug,
    primaryUrl: s.primaryUrl,
  }));

  console.log(
    `  ${clusterResult.clusters.length} cluster(s), ${clusterResult.summary.clusteredCount} clustered, ${clusterResult.summary.singletonCount} singletons.`,
  );

  // Persist clusters.json (skipped in dry-run)
  if (!opts.dryRun) {
    try {
      const fs = await import("fs");
      const path = await import("path");
      const stateDir = path.default.join(process.cwd(), "data", state);
      fs.default.mkdirSync(stateDir, { recursive: true });
      const filePath = path.default.join(stateDir, "clusters.json");
      const payload = {
        $comment: "Multi-college-district cluster detection output (issue #497). Each cluster represents N colleges that share a SIS host or registrable domain — a single bespoke scraper can cover all members.",
        state,
        generatedAt: new Date().toISOString(),
        summary: clusterResult.summary,
        clusters: clusterResult.clusters,
        singletons: out.singletons,
      };
      fs.default.writeFileSync(filePath, JSON.stringify(payload, null, 2) + "\n");
      out.written = true;
      console.log(`  → wrote ${filePath}`);
    } catch (e) {
      out.error = String(e);
      console.error(`  ⚠ failed to write clusters.json: ${e}`);
    }
  }

  // Emit grouped TODOs
  const clusteredSlugs = new Set<string>();
  for (const c of clusterResult.clusters) {
    for (const s of c.memberSlugs) clusteredSlugs.add(s);
  }

  for (const c of clusterResult.clusters) {
    const sortedSlugs = [...c.memberSlugs].sort();
    // Surface the public-access verdict prominently so reviewers don't waste
    // cycles trying to scrape an SSO-gated portal.
    const verdict =
      c.publicGuestAccess === "public-guest-ok"
        ? `PUBLIC at ${c.publicGuestUrl ?? c.sharedSignal} — adapt LACCD-pattern scraper`
        : c.publicGuestAccess === "sso-gated"
          ? `SSO-GATED at ${c.sharedSignal}${c.publicGuestEvidence ? ` (${c.publicGuestEvidence})` : ""} — DROP, no scraper will work without credentials`
          : `unknown access at ${c.sharedSignal} — investigate before authoring`;
    todos.push(
      `[fingerprint-cluster] ${c.id} (${c.memberSlugs.length} colleges, ${c.signalKind}: ${verdict}): ${sortedSlugs.join(", ")}.`,
    );
  }

  // Singletons keep their per-college TODOs
  for (const f of fpResult.flagged) {
    if (clusteredSlugs.has(f.slug)) continue;
    todos.push(`[fingerprint] ${f.slug}: ${f.note}`);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Phase 2b: Course scraping — dispatch by platform to the right template
// ---------------------------------------------------------------------------

async function phaseCourseScraping(
  state: string,
  opts: AddStateOptions,
  byPlatform: Partial<Record<Platform, FingerprintedCollege[]>>,
  todos: string[]
): Promise<AddStateResult["courses"]> {
  const courses: AddStateResult["courses"] = { skippedPlatforms: [] };
  if (opts.skipCourses) {
    console.log("\nPhase 2b (course scraping): skipped (--skip-courses).");
    return courses;
  }
  console.log("\n=== Phase 2b: Course scraping ===");

  // banner-ssb-9
  const ssbCohort = byPlatform["banner-ssb-9"];
  if (ssbCohort && ssbCohort.length > 0) {
    const hosts: Record<string, string> = {};
    for (const e of ssbCohort) {
      // Prefer the courseSearchUrl returned by the fingerprinter; fall
      // back to the bare domain if the fingerprinter found a marker
      // without a specific course-search URL.
      const url = e.fingerprint.courseSearchUrl;
      if (url) {
        // Strip the path back to the SSB base URL (everything before
        // /StudentRegistrationSsb/...). The scrape-banner-ssb template
        // appends the rest of the path itself.
        const stripped = url.replace(
          /\/StudentRegistrationSsb\/.*$/,
          ""
        );
        hosts[e.college.slug] = stripped;
      } else {
        hosts[e.college.slug] = `https://${e.college.primaryUrl}`;
      }
    }
    console.log(`  Banner SSB 9: ${Object.keys(hosts).length} college(s)`);
    if (!opts.dryRun) {
      try {
        courses.bannerSsb = await scrapeBannerSsbState({
          state,
          hosts,
          noImport: true, // orchestrator never auto-imports to Supabase
        });
      } catch (e) {
        const msg = `Banner SSB scraping failed: ${e}`;
        console.error(`  ${msg}`);
        todos.push(`[courses/banner-ssb-9] ${msg}`);
      }
    } else {
      console.log("  (dry-run; not running scraper)");
    }
  }

  // colleague
  const colleagueCohort = byPlatform["colleague"];
  if (colleagueCohort && colleagueCohort.length > 0) {
    const hosts: Record<string, string> = {};
    for (const e of colleagueCohort) {
      const url = e.fingerprint.courseSearchUrl;
      if (url) {
        const stripped = url.replace(/\/Student\/.*$/, "");
        hosts[e.college.slug] = stripped;
      } else {
        hosts[e.college.slug] = `https://${e.college.primaryUrl}`;
      }
    }
    console.log(`  Colleague: ${Object.keys(hosts).length} college(s)`);
    if (!opts.dryRun) {
      try {
        courses.colleague = await scrapeColleagueState({
          state,
          hosts,
          noImport: true,
        });
      } catch (e) {
        const msg = `Colleague scraping failed: ${e}`;
        console.error(`  ${msg}`);
        todos.push(`[courses/colleague] ${msg}`);
      }
    } else {
      console.log("  (dry-run; not running scraper)");
    }
  }

  // banner-8
  const banner8Cohort = byPlatform["banner-8"];
  if (banner8Cohort && banner8Cohort.length > 0) {
    const hosts: Record<string, string> = {};
    for (const e of banner8Cohort) {
      const url = e.fingerprint.courseSearchUrl;
      if (url) {
        // Banner 8 paths are like /pls/PROD/bwckschd... — strip back to
        // the prod-path root that our template expects.
        const stripped = url.replace(/\/bwck.*$/i, "").replace(/\/pls\/[^/]+/i, "$&");
        // Actually the cleanest base URL for our Banner 8 template is the
        // prefix up through the prod path. e.g.
        //   https://web.sjrstate.edu/pls/prod/bwckschd... → keep up through /pls/prod
        const m = url.match(/^(.*?\/pls\/[a-z0-9]+)/i);
        hosts[e.college.slug] = m ? m[1] : stripped;
      } else {
        hosts[e.college.slug] = `https://${e.college.primaryUrl}`;
      }
    }
    console.log(`  Banner 8: ${Object.keys(hosts).length} college(s)`);
    if (!opts.dryRun) {
      try {
        courses.banner8 = await scrapeBanner8ByHost({
          state,
          hosts,
          noImport: true,
        });
      } catch (e) {
        const msg = `Banner 8 scraping failed: ${e}`;
        console.error(`  ${msg}`);
        todos.push(`[courses/banner-8] ${msg}`);
      }
    } else {
      console.log("  (dry-run; not running scraper)");
    }
  }

  // jenzabar
  const jenzabarCohort = byPlatform["jenzabar"];
  if (jenzabarCohort && jenzabarCohort.length > 0) {
    const hosts: Record<string, string> = {};
    for (const e of jenzabarCohort) {
      // The Jenzabar scraper expects the full Course_Search.jnz portlet
      // URL; the fingerprinter only puts a candidate URL in
      // `courseSearchUrl` when it actually found one matching the
      // course-search portlet path. If the fingerprinter only saw
      // `/ICS/` (the bare portal root), skip this college — the
      // scraper would fail to find the term dropdown.
      const url = e.fingerprint.courseSearchUrl;
      if (url && /\/ICS\/Academics\//i.test(url)) {
        hosts[e.college.slug] = url;
      } else {
        todos.push(
          `[courses/jenzabar] ${e.college.slug}: no Course_Search.jnz portlet URL detected — skipping (manual config needed)`,
        );
      }
    }
    if (Object.keys(hosts).length > 0) {
      console.log(`  Jenzabar: ${Object.keys(hosts).length} college(s)`);
      if (!opts.dryRun) {
        try {
          courses.jenzabar = await scrapeJenzabarState({
            state,
            hosts,
            noImport: true,
          });
        } catch (e) {
          const msg = `Jenzabar scraping failed: ${e}`;
          console.error(`  ${msg}`);
          todos.push(`[courses/jenzabar] ${msg}`);
        }
      } else {
        console.log("  (dry-run; not running scraper)");
      }
    }
  }

  // Untemplated platforms — record as skipped (already in `todos` from
  // fingerprint phase, but record here for the structured result too).
  // Catalog platforms are NOT skipped: they're handled by Phase 2c.
  for (const platform of Object.keys(byPlatform) as Platform[]) {
    if (TEMPLATED_COURSE_PLATFORMS.includes(platform)) continue;
    if (CATALOG_PLATFORMS.includes(platform)) continue;
    const cohort = byPlatform[platform]!;
    for (const e of cohort) {
      courses.skippedPlatforms.push({
        slug: e.college.slug,
        platform,
        reason: `no scraper template for '${platform}'`,
      });
    }
  }

  return courses;
}

// ---------------------------------------------------------------------------
// Phase 2c: Catalog scraping (Coursedog and other catalog/curriculum
// platforms). Produces course-definition data + prereqs that Phase 4
// can merge into prereqs.json. Does not produce class sections.
// ---------------------------------------------------------------------------

async function phaseCatalog(
  opts: AddStateOptions,
  byPlatform: Partial<Record<Platform, FingerprintedCollege[]>>,
  todos: string[]
): Promise<AddStateResult["catalog"]> {
  const catalog: AddStateResult["catalog"] = {};
  // Phase 2c is intentionally NOT gated by --skip-courses. Catalog data
  // is independent from class sections — a user might skip the heavy
  // course-section scrape but still want catalog/prereq data.
  const coursedogCohort = byPlatform["coursedog"];
  if (!coursedogCohort || coursedogCohort.length === 0) return catalog;

  console.log("\n=== Phase 2c: Catalog scraping ===");
  console.log(`  Coursedog: ${coursedogCohort.length} college(s)`);

  if (opts.dryRun) {
    console.log("  (dry-run; not running scraper)");
    return catalog;
  }

  const results: ScrapeCoursedogResult[] = [];
  for (const entry of coursedogCohort) {
    // Extract catalog domain from the fingerprinter's courseSearchUrl
    // (e.g. "https://catalog.nwfsc.edu/courses" → "catalog.nwfsc.edu").
    const url = entry.fingerprint.courseSearchUrl;
    if (!url) {
      todos.push(
        `[catalog/coursedog] ${entry.college.slug}: fingerprinter found Coursedog but no URL — manual lookup needed.`
      );
      continue;
    }
    let domain: string;
    try {
      domain = new URL(url).hostname;
    } catch {
      todos.push(
        `[catalog/coursedog] ${entry.college.slug}: malformed Coursedog URL '${url}'.`
      );
      continue;
    }
    try {
      const r = await scrapeCoursedogCatalog({
        state: opts.state,
        slug: entry.college.slug,
        catalogDomain: domain,
      });
      results.push(r);
      if (r.error) {
        todos.push(`[catalog/coursedog] ${entry.college.slug}: ${r.error}`);
      } else if (r.coursesCount === 0) {
        todos.push(
          `[catalog/coursedog] ${entry.college.slug}: scraped 0 courses (tenant=${r.tenantId}). Verify the catalog URL is correct.`
        );
      }
    } catch (e) {
      const msg = `Coursedog scrape failed for ${entry.college.slug}: ${e}`;
      console.error(`  ${msg}`);
      todos.push(`[catalog/coursedog] ${msg}`);
    }
  }
  catalog.coursedog = results;
  return catalog;
}

// ---------------------------------------------------------------------------
// Phase 3: Articulation
// ---------------------------------------------------------------------------

async function phaseArticulation(
  state: string,
  opts: AddStateOptions,
  todos: string[]
): Promise<AddStateResult["transfers"]> {
  if (opts.skipTransfers) {
    console.log("\nPhase 3 (transfers): skipped (--skip-transfers).");
    return { portal: null, scriptsRun: [], fallbackSuggestion: null };
  }
  console.log("\n=== Phase 3: Articulation ===");

  const portal = lookupArticulationPortal(state);
  if (!portal) {
    const fb = getFallbackPortal();
    const note = `No registered articulation portal for ${state.toUpperCase()}. Fallback: ${fb.name}. Add an entry to data/articulation-portals.json once you've identified the state's portal, OR use the CollegeTransfer.Net library at ${fb.templateLib} (requires per-college SourceInstitutionIds — look up in CT.Net's institution search).`;
    console.log(`  ${note}`);
    todos.push(`[transfers] ${note}`);
    return { portal: null, scriptsRun: [], fallbackSuggestion: fb.name };
  }

  console.log(`  Portal: ${portal.name} (${portal.type})`);
  console.log(`  Scripts to run: ${portal.scripts.length}`);

  const scriptsRun: { script: string; ok: boolean; ms: number }[] = [];
  if (opts.dryRun) {
    console.log("  (dry-run; not running scripts)");
    for (const s of portal.scripts) scriptsRun.push({ script: s, ok: false, ms: 0 });
    return { portal, scriptsRun, fallbackSuggestion: null };
  }

  for (const script of portal.scripts) {
    console.log(`  Running ${script}...`);
    const result = await runSubprocess("npx", ["tsx", script, "--no-import"]);
    scriptsRun.push({ script, ok: result.ok, ms: result.ms });
    if (!result.ok) {
      todos.push(
        `[transfers] ${script} failed (exit non-zero, ${result.ms}ms). Check the script's logs and re-run.`
      );
    }
  }

  return { portal, scriptsRun, fallbackSuggestion: null };
}

// ---------------------------------------------------------------------------
// Phase 4: Aggregate prereqs from inline course data
// ---------------------------------------------------------------------------

async function phasePrereqs(
  state: string,
  opts: AddStateOptions,
  todos: string[]
): Promise<AddStateResult["prereqs"]> {
  if (opts.skipPrereqs || opts.dryRun) {
    if (opts.skipPrereqs) console.log("\nPhase 4 (prereqs): skipped (--skip-prereqs).");
    else console.log("\nPhase 4 (prereqs): skipped (--dry-run).");
    return { aggregated: false };
  }
  console.log("\n=== Phase 4: Aggregate prereqs ===");

  const result = await runSubprocess(
    "npx",
    ["tsx", "scripts/lib/aggregate-prereqs.ts", state],
    true
  );
  if (!result.ok) {
    const msg = `aggregate-prereqs failed: ${result.stderr || "(no stderr)"}`;
    console.error(`  ${msg}`);
    todos.push(`[prereqs] ${msg}`);
    return { aggregated: false, error: msg };
  }
  // Print the aggregator's stdout so the user sees the per-state line count
  process.stdout.write(result.stdout);
  return { aggregated: true };
}

// ---------------------------------------------------------------------------
// Phase 5: Scorecard — map IPEDS unitids + ingest per-college Scorecard data
// ---------------------------------------------------------------------------

async function phaseScorecard(
  state: string,
  opts: AddStateOptions,
  todos: string[]
): Promise<AddStateResult["scorecard"]> {
  if (opts.skipScorecard || opts.dryRun) {
    if (opts.skipScorecard)
      console.log("\nPhase 5 (scorecard): skipped (--skip-scorecard).");
    else console.log("\nPhase 5 (scorecard): skipped (--dry-run).");
    return { mapped: 0, ingested: 0, ran: false };
  }
  // Load .env.local so the API-key check below sees the key the same way
  // the subprocesses will. (Subprocesses load it on their own via the
  // college-scorecard module; this parent check would otherwise miss a
  // key that's only set via .env.local.)
  loadEnv();
  if (!process.env.COLLEGE_SCORECARD_API_KEY) {
    const msg =
      "COLLEGE_SCORECARD_API_KEY is not set; skipping scorecard ingest. Get a free key at https://api.data.gov/signup and add it to .env.local.";
    console.warn(`\nPhase 5 (scorecard): ${msg}`);
    todos.push(`[scorecard] ${msg}`);
    return { mapped: 0, ingested: 0, ran: false, error: "no API key" };
  }
  console.log("\n=== Phase 5: Scorecard ingest ===");

  // 5a — map every college in this state to its IPEDS unitid.
  const mapResult = await runSubprocess(
    "npx",
    ["tsx", "scripts/scorecard-map.ts", "--apply", "--state", state],
    true
  );
  if (!mapResult.ok) {
    const msg = `scorecard-map failed: ${mapResult.stderr || "(no stderr)"}`;
    console.error(`  ${msg}`);
    todos.push(`[scorecard] ${msg}`);
    return { mapped: 0, ingested: 0, ran: false, error: msg };
  }
  process.stdout.write(mapResult.stdout);

  // Count how many colleges in this state now have a unitid.
  const instsFile = `data/${state}/institutions.json`;
  let mapped = 0;
  try {
    const insts = JSON.parse(fs.readFileSync(instsFile, "utf-8")) as Array<{
      unitid?: number;
    }>;
    mapped = insts.filter((i) => typeof i.unitid === "number").length;
    const unmapped = insts.length - mapped;
    if (unmapped > 0) {
      todos.push(
        `[scorecard] ${unmapped} college(s) in ${state} have no Scorecard unitid — see data/scorecard-mapping-review.json for candidates and edit the file then re-run \`tsx scripts/scorecard-map.ts --apply --state ${state}\`.`
      );
    }
  } catch (e) {
    todos.push(`[scorecard] failed to count mapped colleges: ${e}`);
  }

  // 5b — fetch the Scorecard record for each mapped college.
  const ingestResult = await runSubprocess(
    "npx",
    ["tsx", "scripts/ingest-scorecard.ts", state],
    true
  );
  if (!ingestResult.ok) {
    const msg = `ingest-scorecard failed: ${ingestResult.stderr || "(no stderr)"}`;
    console.error(`  ${msg}`);
    todos.push(`[scorecard] ${msg}`);
    return { mapped, ingested: 0, ran: false, error: msg };
  }
  process.stdout.write(ingestResult.stdout);

  // Count ingested files on disk.
  let ingested = 0;
  const scoredir = `data/${state}/scorecard`;
  if (fs.existsSync(scoredir)) {
    ingested = fs
      .readdirSync(scoredir)
      .filter((f) => f.endsWith(".json")).length;
  }

  return { mapped, ingested, ran: true };
}

// ---------------------------------------------------------------------------
// Phase 6: Programs — discover catalog platform per college + emit wrapper
// ---------------------------------------------------------------------------

async function phasePrograms(
  state: string,
  opts: AddStateOptions,
  todos: string[],
): Promise<AddStateResult["programs"]> {
  if (opts.skipPrograms || opts.dryRun) {
    const flag = opts.skipPrograms ? "--skip-programs" : "--dry-run";
    console.log(`\nPhase 6 (programs): skipped (${flag}).`);
    return { hits: [], misses: [], wrapperPath: null, ran: false };
  }

  console.log("\n=== Phase 6: Programs catalog discovery ===");

  const instPath = `data/${state}/institutions.json`;
  if (!fs.existsSync(instPath)) {
    const msg = `${instPath} missing — bootstrap must run first.`;
    console.warn(`  ${msg}`);
    return { hits: [], misses: [], wrapperPath: null, ran: false, error: msg };
  }

  let institutions: Array<{ college_slug?: string; id?: string; campuses?: Array<{ address?: string }> }>;
  try {
    institutions = JSON.parse(fs.readFileSync(instPath, "utf-8"));
  } catch (e) {
    const msg = `failed to read ${instPath}: ${e}`;
    return { hits: [], misses: [], wrapperPath: null, ran: false, error: msg };
  }

  // Derive each college's primary web domain. Try a `homepage_url` field
  // first (some bootstraps populate it), then fall back to `{slug}.edu` —
  // not perfect, but the discoverer probes 5 URL patterns so a wrong
  // guess produces a benign miss rather than a wrong hit.
  const colleges = institutions
    .filter((i) => i.college_slug || i.id)
    .map((i) => {
      const slug = (i.college_slug || i.id) as string;
      const home = (i as { homepage_url?: string }).homepage_url || "";
      let domain = "";
      if (home) {
        try { domain = new URL(home).host.replace(/^www\./, ""); } catch { /* fallthrough */ }
      }
      if (!domain) domain = `${slug.split("-")[0]}.edu`;
      return { slug, primaryDomain: domain };
    });

  if (colleges.length === 0) {
    return { hits: [], misses: [], wrapperPath: null, ran: false, error: "no colleges in institutions.json" };
  }

  const { hits, misses } = await discoverPrograms(colleges);
  console.log(`  Probed ${colleges.length} colleges: ${hits.length} hits, ${misses.length} misses`);
  for (const h of hits) console.log(`    + ${h.collegeSlug} → ${h.platform} @ ${h.catalogUrl}`);

  let wrapperPath: string | null = null;
  if (hits.length > 0) {
    const wrapper = renderProgramsWrapper(state, hits);
    if (wrapper) {
      const outDir = path.join(process.cwd(), "scripts", state);
      fs.mkdirSync(outDir, { recursive: true });
      wrapperPath = path.join(outDir, "scrape-programs.ts");
      // Don't clobber an existing hand-written wrapper.
      if (fs.existsSync(wrapperPath)) {
        console.log(`  ${wrapperPath} already exists — leaving it alone`);
        todos.push(
          `[programs] ${wrapperPath} already exists; reconcile the ${hits.length} discovered colleges with the hand-written wrapper.`,
        );
      } else {
        fs.writeFileSync(wrapperPath, wrapper);
        console.log(`  ✓ Wrote ${wrapperPath}`);
        todos.push(
          `[programs] Validate URLs in ${wrapperPath} and run \`npx tsx ${wrapperPath}\` to populate data/${state}/programs/. Then declare the scraper in lib/states/${state}/config.ts under \`scrapers.programs\`.`,
        );
      }
    }
  }

  for (const m of misses) {
    todos.push(
      `[programs] ${m.collegeSlug}: ${m.reason} (probed ${m.triedUrls.length} URLs).`,
    );
  }

  return { hits, misses, wrapperPath, ran: true };
}

// ---------------------------------------------------------------------------
// Reporter — pretty-prints the result for end-of-run consumption
// ---------------------------------------------------------------------------

export function formatReport(r: AddStateResult): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("=".repeat(72));
  lines.push(`  Auto-add-state report: ${r.state}`);
  lines.push("=".repeat(72));

  // Phase 1
  if (r.bootstrap) {
    lines.push(
      `Phase 1 — Bootstrap:        ${r.bootstrap.collegesDiscovered} colleges, ${r.bootstrap.filesCreated.length} files, ${r.bootstrap.registryEdits.length} registry edits`
    );
  } else {
    lines.push(`Phase 1 — Bootstrap:        skipped`);
  }

  // Phase 2a
  const platformCounts = Object.entries(r.fingerprint.byPlatform).map(
    ([p, c]) => `${p}=${c?.length ?? 0}`
  );
  lines.push(
    `Phase 2a — Fingerprint:     ${platformCounts.length > 0 ? platformCounts.join(", ") : "no colleges fingerprinted"}`
  );

  // Phase 2a.5 (cluster)
  if (r.clusters.found.length > 0 || r.clusters.singletons.length > 0) {
    const totalClustered = r.clusters.found.reduce(
      (n, c) => n + c.memberSlugs.length,
      0,
    );
    lines.push(
      `Phase 2a.5 — Cluster:       ${r.clusters.found.length} cluster(s), ${totalClustered} colleges clustered, ${r.clusters.singletons.length} singletons${r.clusters.written ? " (clusters.json written)" : ""}`,
    );
  }

  // Phase 2b
  let totalSections = 0;
  if (r.courses.bannerSsb) totalSections += r.courses.bannerSsb.grandTotal;
  if (r.courses.colleague) totalSections += r.courses.colleague.grandTotal;
  if (r.courses.banner8) totalSections += r.courses.banner8.grandTotal;
  if (r.courses.jenzabar) totalSections += r.courses.jenzabar.grandTotal;
  lines.push(
    `Phase 2b — Course scraping: ${totalSections.toLocaleString()} sections${r.courses.skippedPlatforms.length > 0 ? `, ${r.courses.skippedPlatforms.length} colleges skipped (untemplated platforms)` : ""}`
  );

  // Phase 2c (catalog)
  if (r.catalog.coursedog && r.catalog.coursedog.length > 0) {
    const total = r.catalog.coursedog.reduce((n, c) => n + c.coursesCount, 0);
    const totalPrereqs = r.catalog.coursedog.reduce(
      (n, c) => n + c.withPrereqs,
      0
    );
    lines.push(
      `Phase 2c — Catalog (Coursedog): ${total.toLocaleString()} courses across ${r.catalog.coursedog.length} college(s), ${totalPrereqs} with prereqs`
    );
  }

  // Phase 3
  if (r.transfers.portal) {
    const ok = r.transfers.scriptsRun.filter((s) => s.ok).length;
    const total = r.transfers.scriptsRun.length;
    lines.push(
      `Phase 3 — Articulation:     ${r.transfers.portal.name} (${ok}/${total} scripts ran clean)`
    );
  } else {
    lines.push(
      `Phase 3 — Articulation:     no portal registered${r.transfers.fallbackSuggestion ? `; suggested fallback: ${r.transfers.fallbackSuggestion}` : ""}`
    );
  }

  // Phase 4
  lines.push(
    `Phase 4 — Prereqs:          ${r.prereqs.aggregated ? "aggregated from inline data" : `not aggregated${r.prereqs.error ? ` (${r.prereqs.error})` : ""}`}`
  );

  // Phase 5
  if (r.scorecard.ran) {
    lines.push(
      `Phase 5 — Scorecard:        ${r.scorecard.mapped} unitid(s) mapped, ${r.scorecard.ingested} record(s) ingested`
    );
  } else {
    lines.push(
      `Phase 5 — Scorecard:        not run${r.scorecard.error ? ` (${r.scorecard.error})` : ""}`
    );
  }

  // Phase 6
  if (r.programs.ran) {
    lines.push(
      `Phase 6 — Programs:         ${r.programs.hits.length} catalog(s) discovered, ${r.programs.misses.length} miss(es)${r.programs.wrapperPath ? `; wrapper written to ${r.programs.wrapperPath}` : ""}`
    );
  } else {
    lines.push(
      `Phase 6 — Programs:         not run${r.programs.error ? ` (${r.programs.error})` : ""}`
    );
  }

  // Manual TODOs
  if (r.manualTodos.length > 0) {
    lines.push("");
    lines.push(`⚠ Manual TODOs (${r.manualTodos.length}):`);
    for (const t of r.manualTodos) lines.push(`  - ${t}`);
  } else {
    lines.push("");
    lines.push("✅ No manual TODOs surfaced.");
  }

  // Duration summary
  if (Object.keys(r.durations).length > 0) {
    lines.push("");
    lines.push("Phase durations:");
    for (const [phase, ms] of Object.entries(r.durations)) {
      lines.push(`  ${phase.padEnd(20)} ${(ms / 1000).toFixed(1)}s`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export async function addState(
  opts: AddStateOptions
): Promise<AddStateResult> {
  const state = opts.state.toLowerCase();
  const startedAt = new Date().toISOString();
  const result: AddStateResult = {
    state,
    startedAt,
    finishedAt: "",
    bootstrap: null,
    fingerprint: { byPlatform: {}, flagged: [] },
    clusters: { found: [], singletons: [], written: false },
    courses: { skippedPlatforms: [] },
    catalog: {},
    transfers: { portal: null, scriptsRun: [], fallbackSuggestion: null },
    prereqs: { aggregated: false },
    scorecard: { mapped: 0, ingested: 0, ran: false },
    programs: { hits: [], misses: [], wrapperPath: null, ran: false },
    manualTodos: [],
    durations: {},
  };

  console.log(`\n🚀 auto-add-state: ${state.toUpperCase()}`);
  if (opts.dryRun) console.log("    (--dry-run; no files will be written)");

  // Phase 1
  const t1 = Date.now();
  try {
    result.bootstrap = await phaseBootstrap(state, opts, result.manualTodos);
  } catch (e) {
    const msg = `bootstrap aborted: ${e}`;
    console.error(`\n❌ ${msg}`);
    result.manualTodos.push(`[bootstrap] FATAL: ${msg}`);
    result.finishedAt = new Date().toISOString();
    return result;
  }
  result.durations["1-bootstrap"] = Date.now() - t1;

  // Phase 2a (fingerprint)
  const t2a = Date.now();
  try {
    result.fingerprint = await phaseFingerprint(
      state,
      opts,
      result.manualTodos
    );
  } catch (e) {
    result.manualTodos.push(`[fingerprint] failed: ${e}`);
  }
  result.durations["2a-fingerprint"] = Date.now() - t2a;

  // Phase 2a.5 (cluster detection for untemplated colleges)
  const t2a5 = Date.now();
  try {
    result.clusters = await phaseCluster(
      state,
      opts,
      result.fingerprint,
      result.manualTodos,
    );
  } catch (e) {
    result.manualTodos.push(`[cluster] failed: ${e}`);
    // Fall back to per-college TODOs so we don't silently drop fingerprint info
    for (const f of result.fingerprint.flagged) {
      result.manualTodos.push(`[fingerprint] ${f.slug}: ${f.note}`);
    }
  }
  result.durations["2a5-cluster"] = Date.now() - t2a5;

  // Phase 2b (course scraping)
  const t2b = Date.now();
  try {
    result.courses = await phaseCourseScraping(
      state,
      opts,
      result.fingerprint.byPlatform,
      result.manualTodos
    );
  } catch (e) {
    result.manualTodos.push(`[courses] failed: ${e}`);
  }
  result.durations["2b-courses"] = Date.now() - t2b;

  // Phase 2c (catalog scraping — Coursedog and other catalog platforms)
  const t2c = Date.now();
  try {
    result.catalog = await phaseCatalog(
      opts,
      result.fingerprint.byPlatform,
      result.manualTodos
    );
  } catch (e) {
    result.manualTodos.push(`[catalog] failed: ${e}`);
  }
  result.durations["2c-catalog"] = Date.now() - t2c;

  // Phase 3 (articulation)
  const t3 = Date.now();
  try {
    result.transfers = await phaseArticulation(state, opts, result.manualTodos);
  } catch (e) {
    result.manualTodos.push(`[transfers] failed: ${e}`);
  }
  result.durations["3-transfers"] = Date.now() - t3;

  // Phase 4 (prereqs)
  const t4 = Date.now();
  try {
    result.prereqs = await phasePrereqs(state, opts, result.manualTodos);
  } catch (e) {
    result.manualTodos.push(`[prereqs] failed: ${e}`);
  }
  result.durations["4-prereqs"] = Date.now() - t4;

  // Phase 5 (scorecard ingest — federal cost/aid/completion data)
  const t5 = Date.now();
  try {
    result.scorecard = await phaseScorecard(state, opts, result.manualTodos);
  } catch (e) {
    result.manualTodos.push(`[scorecard] failed: ${e}`);
  }
  result.durations["5-scorecard"] = Date.now() - t5;

  // Phase 6 (programs — catalog discovery + wrapper emission, no scrape)
  const t6 = Date.now();
  try {
    result.programs = await phasePrograms(state, opts, result.manualTodos);
  } catch (e) {
    result.manualTodos.push(`[programs] failed: ${e}`);
  }
  result.durations["6-programs"] = Date.now() - t6;

  result.finishedAt = new Date().toISOString();
  return result;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliArgs extends AddStateOptions {
  json: boolean;
  help: boolean;
  err?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { state: "", json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--state") out.state = argv[++i];
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--skip-bootstrap") out.skipBootstrap = true;
    else if (a === "--skip-fingerprint") out.skipFingerprint = true;
    else if (a === "--skip-cluster") out.skipCluster = true;
    else if (a === "--skip-courses") out.skipCourses = true;
    else if (a === "--skip-transfers") out.skipTransfers = true;
    else if (a === "--skip-prereqs") out.skipPrereqs = true;
    else if (a === "--skip-scorecard") out.skipScorecard = true;
    else if (a === "--skip-programs") out.skipPrograms = true;
    else if (a === "--college-filter") out.collegeFilter = argv[++i];
    else if (a === "--ipeds-year") out.ipedsYear = parseInt(argv[++i], 10);
    else if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else out.err = `Unknown argument: ${a}`;
  }
  return out;
}

function printHelp() {
  console.log(`Usage:
  npx tsx scripts/lib/add-state.ts --state <slug> [options]

Top-level orchestrator for the auto-add-state skill. Runs all 6 phases:
bootstrap → fingerprint → course scraping → articulation → prereqs → scorecard.

Options:
  --state <slug>          Required. Lowercase 2-letter state slug.
  --dry-run               Plan only; don't write files or run scrapers.
  --skip-bootstrap        Skip Phase 1 (re-running on existing state).
  --skip-fingerprint      Skip Phase 2a.
  --skip-cluster          Skip Phase 2a.5 (multi-college-district clustering).
  --skip-courses          Skip Phase 2b.
  --skip-transfers        Skip Phase 3.
  --skip-prereqs          Skip Phase 4.
  --skip-scorecard        Skip Phase 5 (auto-skipped if COLLEGE_SCORECARD_API_KEY unset).
  --college-filter <slug> Only fingerprint+scrape this one college.
  --ipeds-year <YYYY>     Override IPEDS data year (default: latest).
  --json                  Print structured JSON result instead of report.

Examples:
  npx tsx scripts/lib/add-state.ts --state oh
  npx tsx scripts/lib/add-state.ts --state oh --dry-run
  npx tsx scripts/lib/add-state.ts --state oh --skip-courses --skip-transfers
  npx tsx scripts/lib/add-state.ts --state oh --college-filter sinclair
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.err || !args.state) {
    if (args.err) console.error(`Error: ${args.err}`);
    if (!args.state && !args.help && !args.err)
      console.error("Error: --state is required");
    printHelp();
    process.exit(args.err || !args.state ? 1 : 0);
  }

  const result = await addState(args);
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(formatReport(result));
}

const isMain =
  import.meta.url.startsWith("file:") &&
  process.argv[1] &&
  import.meta.url === `file://${path.resolve(process.argv[1])}`;

if (isMain) {
  main().catch((e) => {
    console.error("Fatal:", e);
    process.exit(1);
  });
}

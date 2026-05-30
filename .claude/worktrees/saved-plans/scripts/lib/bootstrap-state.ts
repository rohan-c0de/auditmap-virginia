/**
 * bootstrap-state.ts
 *
 * Generates Phase 1 files for a new US state — the boilerplate that
 * historically had to be written by hand following the add-new-state
 * skill's checklist. Driven by the auto-add-state orchestrator (PR 7).
 *
 * Strictly additive — no existing state's files are modified. Calling this
 * for a state that already has Phase 1 data is a no-op (with a warning).
 *
 * Generates:
 *   - data/{state}/institutions.json (from IPEDS via discover-colleges)
 *   - data/{state}/zipcodes.json     (from GeoNames via fetch-zipcodes)
 *   - data/{state}/transfer-equiv.json (empty stub — Phase 3 fills it)
 *   - lib/states/{state}/config.ts   (StateConfig skeleton, transferSupported: false)
 *
 * Edits (additive, idempotent):
 *   - lib/states/registry.ts   — add config import + ALL_CONFIGS entry
 *   - lib/institutions.ts      — add JSON import + REGISTRY entry
 *   - lib/geo.ts               — add JSON import + ZIP_REGISTRY entry
 *
 * Returns a summary listing every file created/edited and every manual
 * TODO surfaced (audit policy verification, missing senior-waiver citation
 * for unfamiliar states, etc.). The orchestrator surfaces these in its
 * final report.
 *
 * Library:
 *   import { bootstrapState } from "../lib/bootstrap-state";
 *   const result = await bootstrapState({ state: "oh" });
 *
 * CLI:
 *   npx tsx scripts/lib/bootstrap-state.ts --state oh
 *   npx tsx scripts/lib/bootstrap-state.ts --state oh --dry-run
 */

import fs from "fs";
import path from "path";
import {
  discoverPublicCommunityColleges,
  type DiscoveredCollege,
} from "./discover-colleges";
import { fetchZipcodesForState } from "./fetch-zipcodes";

// ---------------------------------------------------------------------------
// State metadata
// ---------------------------------------------------------------------------

interface SeniorWaiver {
  ageThreshold: number;
  legalCitation: string;
  description: string;
  bannerTitle: string;
  bannerSummary: string;
  bannerDetail: string;
}

interface StateMetadataEntry {
  fullName: string;
  fipsCode: string;
  systemName: string;
  systemFullName: string;
  systemUrl: string;
  defaultZip: string;
  defaultZipCity: string;
  seniorWaiver: SeniorWaiver | null;
}

interface StateMetadataFile {
  states: Record<string, StateMetadataEntry>;
  fipsCodes: Record<string, string>;
}

function loadStateMetadata(state: string): {
  metadata: StateMetadataEntry | null;
  fipsCode: string;
} {
  const file = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), "data", "state-metadata.json"),
      "utf-8"
    )
  ) as StateMetadataFile;
  const fipsCode = file.fipsCodes[state.toLowerCase()];
  if (!fipsCode) {
    throw new Error(
      `Unknown state slug '${state}'. Add it to data/state-metadata.json fipsCodes map.`
    );
  }
  const metadata = file.states[state.toLowerCase()] ?? null;
  return { metadata, fipsCode };
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BootstrapStateOptions {
  /** Lowercase state slug (e.g. "oh"). */
  state: string;
  /** When true, plan everything but don't write any files or edit registry. */
  dryRun?: boolean;
  /**
   * Override the IPEDS year (default = latest known, currently 2023).
   * Useful if a future year is missing some institutions.
   */
  ipedsYear?: number;
}

export interface BootstrapStateResult {
  state: string;
  collegesDiscovered: number;
  filesCreated: string[];
  filesSkipped: string[];
  registryEdits: string[];
  manualTodos: string[];
}

// ---------------------------------------------------------------------------
// File generators
// ---------------------------------------------------------------------------

interface InstitutionEntry {
  id: string;
  name: string;
  system: string;
  college_slug: string;
  campuses: Array<{ name: string; lat: number; lng: number; address: string }>;
  audit_policy: AuditPolicy;
}

interface AuditPolicy {
  allowed: boolean;
  cost_model: string;
  cost_note: string;
  eligibility: {
    minimum_age: number;
    residency_required: boolean;
    senior_discount: {
      available: boolean;
      age_threshold: number | null;
      cost: string;
      notes: string;
      source_url: string;
    };
  };
  application_process: {
    steps: string[];
    timing: string;
    form_url: string;
    contact_email: string;
    contact_phone: string;
  };
  restrictions: string[];
  last_verified: string;
  source_url: string;
}

function buildAuditPolicy(
  metadata: StateMetadataEntry | null,
  collegeName: string,
  primaryUrl: string
): AuditPolicy {
  const today = new Date().toISOString().slice(0, 10);
  const sw = metadata?.seniorWaiver;
  return {
    allowed: true,
    cost_model: sw ? "free_for_seniors" : "varies",
    cost_note: sw
      ? sw.description
      : `Audit-policy details for ${collegeName} have not yet been verified — confirm with the registrar before relying on this entry.`,
    eligibility: {
      minimum_age: 18,
      residency_required: false,
      senior_discount: sw
        ? {
            available: true,
            age_threshold: sw.ageThreshold,
            cost: "free",
            notes: sw.description,
            source_url: primaryUrl ? `https://${primaryUrl}` : "",
          }
        : {
            available: false,
            age_threshold: null,
            cost: "",
            notes:
              "Senior-waiver policy not yet researched for this state. Verify with the college's registrar.",
            source_url: "",
          },
    },
    application_process: {
      steps: [
        primaryUrl
          ? `Apply online at ${primaryUrl}`
          : "Apply through the college's admissions office",
        "Register as a non-degree / audit student",
        "Register for courses during open enrollment",
      ],
      timing: "Register during the normal enrollment period",
      form_url: "",
      contact_email: "",
      contact_phone: "",
    },
    restrictions: sw
      ? ["Space-available basis only", "Credit hours earned do not apply toward graduation"]
      : ["Verify all restrictions with the college before enrolling"],
    last_verified: today,
    source_url: primaryUrl ? `https://${primaryUrl}` : "",
  };
}

function buildInstitutionsJson(
  colleges: DiscoveredCollege[],
  metadata: StateMetadataEntry | null
): InstitutionEntry[] {
  const systemName = metadata?.systemName ?? "Public 2-year";
  return colleges.map((c) => ({
    id: c.slug,
    name: c.name,
    system: systemName,
    college_slug: c.slug,
    campuses: [
      {
        name: c.name + (c.city ? ` (${c.city})` : ""),
        lat: c.lat,
        lng: c.lng,
        address: [c.address, c.city, `${c.stateAbbr} ${c.zip}`]
          .filter(Boolean)
          .join(", "),
      },
    ],
    audit_policy: buildAuditPolicy(metadata, c.name, c.primaryUrl),
  }));
}

function buildConfigSkeleton(
  state: string,
  metadata: StateMetadataEntry | null,
  collegeCount: number
): string {
  const slug = state.toLowerCase();
  const fullName = metadata?.fullName ?? capitalize(slug);
  const systemName = metadata?.systemName ?? "Public 2-year";
  const systemFullName =
    metadata?.systemFullName ?? `${fullName} Public 2-year Colleges`;
  const systemUrl = metadata?.systemUrl ?? "";
  const defaultZip = metadata?.defaultZip ?? "";
  const defaultZipCity = metadata?.defaultZipCity ?? "";

  const seniorWaiverBlock = metadata?.seniorWaiver
    ? `
  seniorWaiver: {
    ageThreshold: ${metadata.seniorWaiver.ageThreshold},
    legalCitation: ${JSON.stringify(metadata.seniorWaiver.legalCitation)},
    description: ${JSON.stringify(metadata.seniorWaiver.description)},
    bannerTitle: ${JSON.stringify(metadata.seniorWaiver.bannerTitle)},
    bannerSummary: ${JSON.stringify(metadata.seniorWaiver.bannerSummary)},
    bannerDetail: ${JSON.stringify(metadata.seniorWaiver.bannerDetail)},
  },`
    : `
  // TODO: research senior-waiver statute for ${fullName}.
  // Set to null if no waiver exists, or fill in per the SeniorWaiverConfig shape.
  seniorWaiver: null,`;

  return `import type { StateConfig } from "../registry";

const ${slug}Config: StateConfig = {
  slug: ${JSON.stringify(slug)},
  name: ${JSON.stringify(fullName)},
  systemName: ${JSON.stringify(systemName)},
  systemFullName: ${JSON.stringify(systemFullName)},
  systemUrl: ${JSON.stringify(systemUrl)},
  collegeCount: ${collegeCount},
${seniorWaiverBlock}

  transferSupported: false,
  popularCourses: [],
  defaultZip: ${JSON.stringify(defaultZip)},
  defaultZipCity: ${JSON.stringify(defaultZipCity)},

  courseDiscoveryUrl: (_collegeSlug: string, _prefix: string, _number: string) =>
    ${JSON.stringify(systemUrl || "https://www.example.edu/")},

  collegeCoursesUrl: (_collegeSlug: string) =>
    ${JSON.stringify(systemUrl || "https://www.example.edu/")},

  branding: {
    siteName: ${JSON.stringify(`Community College Path ${fullName}`)},
    tagline: ${JSON.stringify(
      `Search ${systemName} courses across all ${collegeCount} colleges.`
    )},
    footerText: ${JSON.stringify(
      `Community College Path ${fullName} — Find courses across all ${collegeCount} ${systemName} colleges.`
    )},
    disclaimer: ${JSON.stringify(
      `This is an independent project and is not affiliated with, endorsed by, or sponsored by ${systemFullName}.`
    )},
    metaKeywords: [
      ${JSON.stringify(`${fullName} community college courses`)},
      ${JSON.stringify(`${systemName} course search`)},
      ${JSON.stringify(systemFullName)},
    ],
  },
  scrapers: {
    // manual-only: courses — Phase 2 (course scraper) not yet wired up.
    // manual-only: transfers — Phase 3 (transfer-equiv) not yet wired up.
    // manual-only: prereqs — Phase 4.
    // manual-only: programs — Phase 5+.
  },
};

export default ${slug}Config;
`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Registry edits — additive, idempotent
//
// Each edit is "if the state isn't already registered, append the import
// and the entry". We don't care about ordering; the existing files have
// alphabetical-ish but non-strict ordering so simple append is safe.
// ---------------------------------------------------------------------------

export function applyRegistryEdit(
  filePath: string,
  importLine: string,
  importAnchor: RegExp,
  registryLine: string,
  registryEntryAnchor: RegExp,
  /**
   * Pattern that matches *any* existing registry entry in this file, used
   * as the anchor for "append my entry after the last matching one." Must
   * be per-file because the three files use two different shapes:
   *   - registry.ts ALL_CONFIGS is a `StateConfig[]` array → entries look
   *     like `  vaConfig,`
   *   - institutions.ts REGISTRY and geo.ts ZIP_REGISTRY are
   *     `Record<string, …>` objects → entries look like `  va: vaInstitutions as ...,`
   * A single hardcoded pattern can't catch both. (See PRs #285 #286 — KY
   * and AL bootstrap runs both required hand-fixes because the previous
   * one-pattern-fits-all approach failed silently in registry.ts.)
   */
  registryAnchorPattern: RegExp,
  dryRun: boolean
): { applied: boolean; reason: string } {
  if (!fs.existsSync(filePath)) {
    return { applied: false, reason: `${filePath} does not exist` };
  }
  const content = fs.readFileSync(filePath, "utf-8");

  // Idempotency check — both the import and the registry line.
  if (content.includes(importLine.trim()) && registryEntryAnchor.test(content)) {
    return { applied: false, reason: "already present" };
  }

  // Insert the import after the last matching import line; insert the
  // registry entry after the last matching registry entry line.
  let updated = content;
  if (!updated.includes(importLine.trim())) {
    updated = appendAfterLastMatch(updated, importAnchor, importLine);
  }
  if (!registryEntryAnchor.test(updated)) {
    updated = appendAfterLastMatch(updated, registryAnchorPattern, registryLine);
  }

  if (!dryRun) fs.writeFileSync(filePath, updated);
  return { applied: true, reason: "ok" };
}

function appendAfterLastMatch(content: string, regex: RegExp, line: string): string {
  let lastIndex = -1;
  const re = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
  let m;
  while ((m = re.exec(content)) !== null) {
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex === -1) {
    // No match — append before the next blank line + closing }
    return content + "\n" + line;
  }
  return content.slice(0, lastIndex) + "\n" + line + content.slice(lastIndex);
}

// ---------------------------------------------------------------------------
// Main bootstrap function
// ---------------------------------------------------------------------------

export async function bootstrapState(
  opts: BootstrapStateOptions
): Promise<BootstrapStateResult> {
  const slug = opts.state.toLowerCase();
  const result: BootstrapStateResult = {
    state: slug,
    collegesDiscovered: 0,
    filesCreated: [],
    filesSkipped: [],
    registryEdits: [],
    manualTodos: [],
  };

  // --- Look up state metadata + FIPS ---
  const { metadata, fipsCode } = loadStateMetadata(slug);
  if (!metadata) {
    result.manualTodos.push(
      `data/state-metadata.json has no curated entry for '${slug}'. The bootstrap proceeded with placeholder values; populate fullName/systemName/systemFullName/systemUrl/seniorWaiver in state-metadata.json before merging.`
    );
  }
  void fipsCode;

  // --- Discover colleges via IPEDS ---
  console.log(`\nDiscovering ${slug.toUpperCase()} community colleges via IPEDS...`);
  const colleges = await discoverPublicCommunityColleges(slug, {
    year: opts.ipedsYear,
  });
  result.collegesDiscovered = colleges.length;
  console.log(`  Found ${colleges.length} institutions.`);

  if (colleges.length === 0) {
    result.manualTodos.push(
      `IPEDS returned 0 community colleges for ${slug.toUpperCase()}. Verify the FIPS code and the inst_category filter (3 or 4). Bootstrap aborted before writing files.`
    );
    return result;
  }

  // Flag likely-branch entries for manual review
  for (const c of colleges) {
    if (c.hasParent) {
      result.manualTodos.push(
        `${c.slug} (${c.name}) is flagged as a branch campus by IPEDS; review whether it belongs in this list.`
      );
    }
  }

  // --- Build files ---
  const dataDir = path.join(process.cwd(), "data", slug);
  const institutionsPath = path.join(dataDir, "institutions.json");
  const transferEquivPath = path.join(dataDir, "transfer-equiv.json");
  const configPath = path.join(process.cwd(), "lib", "states", slug, "config.ts");

  if (!opts.dryRun) fs.mkdirSync(dataDir, { recursive: true });

  // institutions.json
  if (fs.existsSync(institutionsPath)) {
    result.filesSkipped.push(`${institutionsPath} (already exists; not overwriting)`);
  } else {
    const institutions = buildInstitutionsJson(colleges, metadata);
    if (!opts.dryRun) {
      fs.writeFileSync(institutionsPath, JSON.stringify(institutions, null, 2));
    }
    result.filesCreated.push(institutionsPath);
  }

  // transfer-equiv.json (empty stub)
  if (fs.existsSync(transferEquivPath)) {
    result.filesSkipped.push(`${transferEquivPath} (already exists)`);
  } else {
    if (!opts.dryRun) fs.writeFileSync(transferEquivPath, "[]\n");
    result.filesCreated.push(transferEquivPath);
  }

  // zipcodes.json — delegate to fetch-zipcodes
  const zipPath = path.join(dataDir, "zipcodes.json");
  if (fs.existsSync(zipPath)) {
    result.filesSkipped.push(`${zipPath} (already exists; pass --refresh-zipcodes to redownload)`);
  } else {
    if (!opts.dryRun) {
      await fetchZipcodesForState({ state: slug });
    }
    result.filesCreated.push(zipPath);
  }

  // config.ts
  const configDir = path.dirname(configPath);
  if (fs.existsSync(configPath)) {
    result.filesSkipped.push(`${configPath} (already exists)`);
  } else {
    if (!opts.dryRun) {
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        configPath,
        buildConfigSkeleton(slug, metadata, colleges.length)
      );
    }
    result.filesCreated.push(configPath);
  }

  // --- Registry edits (idempotent) ---

  // lib/states/registry.ts: ALL_CONFIGS is `StateConfig[]` — entries are
  // bare values (`  vaConfig,`), no `slug:` key prefix. The anchor pattern
  // matches existing array entries; the registry line must match the
  // same array shape.
  const regEdit = applyRegistryEdit(
    path.join(process.cwd(), "lib", "states", "registry.ts"),
    `import ${slug}Config from "./${slug}/config";`,
    /^import [a-z]{2}Config from "\.\/[a-z]{2}\/config";$/gm,
    `  ${slug}Config,`,
    new RegExp(`^\\s+${slug}Config,$`, "m"),
    /^\s+[a-z]{2}Config,$/gm,
    opts.dryRun ?? false
  );
  if (regEdit.applied) result.registryEdits.push("lib/states/registry.ts");
  else if (regEdit.reason !== "already present")
    result.manualTodos.push(`registry.ts: ${regEdit.reason}`);

  // lib/institutions.ts: REGISTRY is `Record<string, Institution[]>` —
  // every entry uses an `as unknown as Institution[]` double-cast to
  // appease TS's structural comparison of the JSON-inferred narrow
  // null-types vs. the stricter Institution interface. Bootstrap output
  // MUST include the cast or the build fails with TS2322.
  const instEdit = applyRegistryEdit(
    path.join(process.cwd(), "lib", "institutions.ts"),
    `import ${slug}Institutions from "@/data/${slug}/institutions.json";`,
    /^import [a-z]{2}Institutions from "@\/data\/[a-z]{2}\/institutions\.json";$/gm,
    `  ${slug}: ${slug}Institutions as unknown as Institution[],`,
    new RegExp(`^\\s+${slug}:\\s+${slug}Institutions\\s+as\\s+unknown\\s+as\\s+Institution\\[\\],$`, "m"),
    /^\s+[a-z]{2}:\s+[a-z]{2}Institutions\s+as\s+unknown\s+as\s+Institution\[\],$/gm,
    opts.dryRun ?? false
  );
  if (instEdit.applied) result.registryEdits.push("lib/institutions.ts");
  else if (instEdit.reason !== "already present")
    result.manualTodos.push(`institutions.ts: ${instEdit.reason}`);

  // lib/geo.ts: ZIP_REGISTRY is `Record<string, Record<string, ZipEntry>>`
  // — every entry uses `as Record<string, ZipEntry>` cast.
  const geoEdit = applyRegistryEdit(
    path.join(process.cwd(), "lib", "geo.ts"),
    `import ${slug}Zipcodes from "@/data/${slug}/zipcodes.json";`,
    /^import [a-z]{2}Zipcodes from "@\/data\/[a-z]{2}\/zipcodes\.json";$/gm,
    `  ${slug}: ${slug}Zipcodes as Record<string, ZipEntry>,`,
    new RegExp(`^\\s+${slug}:\\s+${slug}Zipcodes`, "m"),
    /^\s+[a-z]{2}:\s+[a-z]{2}Zipcodes\s+as\s+Record<string,\s+ZipEntry>,$/gm,
    opts.dryRun ?? false
  );
  if (geoEdit.applied) result.registryEdits.push("lib/geo.ts");
  else if (geoEdit.reason !== "already present")
    result.manualTodos.push(`geo.ts: ${geoEdit.reason}`);

  // --- Audit-policy reminder (always) ---
  if (!metadata?.seniorWaiver) {
    result.manualTodos.push(
      `Senior-waiver citation for ${slug.toUpperCase()} is null in state-metadata.json. The generated audit_policy entries flag this; verify the state's actual senior-waiver statute and update both data/state-metadata.json and the institutions.json audit_policy fields before merging.`
    );
  }
  result.manualTodos.push(
    `Each generated audit_policy.last_verified is set to today's date as a placeholder. Sample-check 2-3 colleges (registrar website or phone) and update if the policy differs from the senior-waiver default.`
  );

  return result;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliArgs {
  state?: string;
  dryRun: boolean;
  ipedsYear?: number;
  help: boolean;
  err?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { dryRun: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--state") out.state = argv[++i];
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--ipeds-year") out.ipedsYear = parseInt(argv[++i], 10);
    else if (a === "--help" || a === "-h") out.help = true;
    else out.err = `Unknown argument: ${a}`;
  }
  return out;
}

function printHelp() {
  console.log(`Usage:
  npx tsx scripts/lib/bootstrap-state.ts --state <slug> [--dry-run] [--ipeds-year YYYY]

Bootstraps Phase 1 files for a new state — institutions.json, zipcodes.json,
transfer-equiv.json (empty), config.ts skeleton, plus the three registry edits.

Idempotent: if a file already exists, it's skipped (not overwritten).

Examples:
  npx tsx scripts/lib/bootstrap-state.ts --state oh
  npx tsx scripts/lib/bootstrap-state.ts --state oh --dry-run
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

  const result = await bootstrapState({
    state: args.state,
    dryRun: args.dryRun,
    ipedsYear: args.ipedsYear,
  });

  console.log("\n=== Bootstrap result ===");
  console.log(`State:                 ${result.state}`);
  console.log(`Colleges discovered:   ${result.collegesDiscovered}`);
  if (result.filesCreated.length > 0) {
    console.log(`\nFiles created:`);
    for (const f of result.filesCreated) console.log(`  ${f}`);
  }
  if (result.filesSkipped.length > 0) {
    console.log(`\nFiles skipped (already present):`);
    for (const f of result.filesSkipped) console.log(`  ${f}`);
  }
  if (result.registryEdits.length > 0) {
    console.log(`\nRegistry edits applied:`);
    for (const f of result.registryEdits) console.log(`  ${f}`);
  }
  if (result.manualTodos.length > 0) {
    console.log(`\n⚠ Manual TODOs (review before merging):`);
    for (const t of result.manualTodos) console.log(`  - ${t}`);
  }
  if (args.dryRun) console.log("\n(--dry-run; no files written, no registry edits applied.)");
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

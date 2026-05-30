/**
 * articulation-portals.ts
 *
 * Loader and types for `data/articulation-portals.json` — the registry of
 * known state-run transfer-articulation portals. Read by the auto-add-state
 * orchestrator (PR 7) to decide how to scrape transfer data for a given
 * state.
 *
 * For a known state, the orchestrator looks up the entry, reads `scripts`,
 * and runs each one against the registry's existing per-state scrapers.
 * For an unknown state, the orchestrator falls back to CollegeTransfer.Net
 * via the `fallback` entry — which depends on the caller having (or
 * discovering) per-college SourceInstitutionIds.
 *
 * This PR is purely additive: the registry + loader + types ship as a
 * new file pair. No existing scrapers are modified. The orchestrator
 * (PR 7) will be the first consumer.
 *
 * Usage as a library:
 *
 *   import {
 *     loadArticulationPortals,
 *     lookupArticulationPortal,
 *     getFallbackPortal,
 *   } from "../lib/articulation-portals";
 *
 *   const portal = lookupArticulationPortal("oh");
 *   if (portal) {
 *     for (const script of portal.scripts) await runScript(script);
 *   } else {
 *     const fb = getFallbackPortal();
 *     console.log(`No registered portal for oh; fall back to ${fb.name}.`);
 *   }
 *
 * CLI smoke (read-only):
 *
 *   npx tsx scripts/lib/articulation-portals.ts --list
 *   npx tsx scripts/lib/articulation-portals.ts --lookup fl
 *   npx tsx scripts/lib/articulation-portals.ts --validate
 */

import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Portal classification. Drives orchestrator decisions about how to
 * interpret the entry's `scripts` field and whether to expect high vs
 * sparse coverage.
 */
export type PortalType =
  /** Single-file dump from a state DOE site. Highest leverage; one
   *  scrape covers every public institution in the state. Example: FL SCNS. */
  | "state-portal-flatfile"
  /** A state-mandated articulation app or system that aggregates per-pair
   *  data. Example: MA MassTransfer, MD ARTSYS, NJ NJTransfer, CUNY T-Rex. */
  | "state-portal"
  /** State articulation goes through CollegeTransfer.Net's OData API
   *  (state-branded or generic). Example: PA TRAC, ME, VT. */
  | "collegetransfer-net"
  /** TES (Transfer Evaluation System) Public View pattern — receiver
   *  university publishes a TES-backed equivalency search. Example: RI. */
  | "tes-public-view"
  /** No state-level portal; one scraper per receiving university.
   *  Example: VA, SC, TN, CT. */
  | "per-receiver"
  /** Combination — a state portal exists but covers only some destinations
   *  and per-receiver scripts handle the rest. Example: NC, NH, GA, DE. */
  | "mixed";

export interface PortalEntry {
  type: PortalType;
  name: string;
  url?: string;
  scripts: string[];
  notes?: string;
}

export interface FallbackPortal {
  type: PortalType;
  name: string;
  url?: string;
  templateLib: string;
  notes?: string;
}

interface ArticulationRegistry {
  $schema?: string;
  $comment?: string;
  portals: Record<string, PortalEntry>;
  fallback: FallbackPortal;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

const REGISTRY_PATH = path.join(
  process.cwd(),
  "data",
  "articulation-portals.json"
);

let cached: ArticulationRegistry | null = null;

/**
 * Load and validate `data/articulation-portals.json`. Cached after first
 * call. Throws on missing file or schema violation — fail loudly so the
 * orchestrator never silently proceeds with a corrupt registry.
 */
export function loadArticulationPortals(): ArticulationRegistry {
  if (cached) return cached;

  if (!fs.existsSync(REGISTRY_PATH)) {
    throw new Error(`articulation-portals.json not found at ${REGISTRY_PATH}`);
  }

  const raw = fs.readFileSync(REGISTRY_PATH, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `articulation-portals.json failed to parse as JSON: ${(e as Error).message}`
    );
  }

  validate(parsed);
  cached = parsed as ArticulationRegistry;
  return cached;
}

/**
 * Look up the registered articulation portal for a state slug. Returns
 * null when the state has no entry — caller should consult the fallback.
 */
export function lookupArticulationPortal(
  state: string
): PortalEntry | null {
  const registry = loadArticulationPortals();
  return registry.portals[state.toLowerCase()] ?? null;
}

/** Return the universal fallback (CollegeTransfer.Net by default). */
export function getFallbackPortal(): FallbackPortal {
  return loadArticulationPortals().fallback;
}

/** Slugs of all states with a registered portal. */
export function listRegisteredStates(): string[] {
  return Object.keys(loadArticulationPortals().portals).sort();
}

// ---------------------------------------------------------------------------
// Validation — enforce shape + that referenced scripts actually exist on
// disk. Catches typos in the registry before the orchestrator tries to
// `tsx` a bad path. (We don't typecheck the scripts; just check the path
// resolves to a regular file.)
// ---------------------------------------------------------------------------

const ALLOWED_TYPES: PortalType[] = [
  "state-portal-flatfile",
  "state-portal",
  "collegetransfer-net",
  "tes-public-view",
  "per-receiver",
  "mixed",
];

function validate(parsed: unknown): asserts parsed is ArticulationRegistry {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("articulation-portals.json must be an object");
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.portals !== "object" || obj.portals === null) {
    throw new Error("articulation-portals.json: missing or invalid 'portals'");
  }
  if (typeof obj.fallback !== "object" || obj.fallback === null) {
    throw new Error("articulation-portals.json: missing or invalid 'fallback'");
  }

  for (const [slug, entry] of Object.entries(obj.portals as Record<string, unknown>)) {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`portals['${slug}'] is not an object`);
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.type !== "string" || !ALLOWED_TYPES.includes(e.type as PortalType)) {
      throw new Error(
        `portals['${slug}'].type must be one of ${ALLOWED_TYPES.join(", ")}`
      );
    }
    if (typeof e.name !== "string" || !e.name) {
      throw new Error(`portals['${slug}'].name must be a non-empty string`);
    }
    if (!Array.isArray(e.scripts) || e.scripts.length === 0) {
      throw new Error(`portals['${slug}'].scripts must be a non-empty array`);
    }
    for (const s of e.scripts as unknown[]) {
      if (typeof s !== "string") {
        throw new Error(`portals['${slug}'].scripts must contain strings`);
      }
      const fullPath = path.join(process.cwd(), s);
      if (!fs.existsSync(fullPath)) {
        throw new Error(
          `portals['${slug}']: script '${s}' does not exist on disk`
        );
      }
    }
    if (e.url !== undefined && typeof e.url !== "string") {
      throw new Error(`portals['${slug}'].url must be a string`);
    }
    if (e.notes !== undefined && typeof e.notes !== "string") {
      throw new Error(`portals['${slug}'].notes must be a string`);
    }
  }

  const fb = obj.fallback as Record<string, unknown>;
  if (
    typeof fb.type !== "string" ||
    !ALLOWED_TYPES.includes(fb.type as PortalType)
  ) {
    throw new Error(`fallback.type must be one of ${ALLOWED_TYPES.join(", ")}`);
  }
  if (typeof fb.name !== "string" || !fb.name) {
    throw new Error("fallback.name must be a non-empty string");
  }
  if (typeof fb.templateLib !== "string" || !fb.templateLib) {
    throw new Error("fallback.templateLib must be a non-empty string");
  }
  if (!fs.existsSync(path.join(process.cwd(), fb.templateLib as string))) {
    throw new Error(
      `fallback.templateLib '${fb.templateLib}' does not exist on disk`
    );
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`Usage:
  npx tsx scripts/lib/articulation-portals.ts --list
  npx tsx scripts/lib/articulation-portals.ts --lookup <state>
  npx tsx scripts/lib/articulation-portals.ts --validate

Operations on data/articulation-portals.json:
  --list      Print all registered states + portal name + type
  --lookup    Print the registry entry for a single state slug
  --validate  Re-load + re-validate (verifies all referenced scripts exist
              on disk). Exits 1 if validation fails.

Examples:
  npx tsx scripts/lib/articulation-portals.ts --list
  npx tsx scripts/lib/articulation-portals.ts --lookup fl
`);
}

interface CliArgs {
  list: boolean;
  lookup?: string;
  validate: boolean;
  help: boolean;
  err?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { list: false, validate: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--list") out.list = true;
    else if (a === "--validate") out.validate = true;
    else if (a === "--lookup") out.lookup = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
    else out.err = `Unknown argument: ${a}`;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.err || (!args.list && !args.lookup && !args.validate)) {
    if (args.err) console.error(`Error: ${args.err}`);
    printHelp();
    process.exit(args.err ? 1 : 0);
  }

  try {
    const registry = loadArticulationPortals();

    if (args.validate) {
      const states = listRegisteredStates();
      console.log(
        `✓ Registry valid: ${states.length} states + 1 fallback. ${
          Object.values(registry.portals).reduce((n, e) => n + e.scripts.length, 0)
        } total script references — all exist on disk.`
      );
      return;
    }

    if (args.list) {
      const states = listRegisteredStates();
      console.log(`Registered states: ${states.length}\n`);
      const byType = new Map<PortalType, string[]>();
      for (const slug of states) {
        const e = registry.portals[slug];
        const arr = byType.get(e.type) ?? [];
        arr.push(slug);
        byType.set(e.type, arr);
        console.log(
          `  ${slug.padEnd(4)} ${e.type.padEnd(24)} ${e.name}`
        );
      }
      console.log(`\nBy type:`);
      for (const [type, slugs] of [...byType.entries()].sort()) {
        console.log(`  ${type.padEnd(24)} ${slugs.length}: ${slugs.join(", ")}`);
      }
      console.log(`\nFallback: ${registry.fallback.name} → ${registry.fallback.templateLib}`);
      return;
    }

    if (args.lookup) {
      const e = lookupArticulationPortal(args.lookup);
      if (!e) {
        console.log(
          `No registered portal for '${args.lookup}'. Fallback: ${registry.fallback.name}.`
        );
        process.exit(0);
      }
      console.log(JSON.stringify({ state: args.lookup, ...e }, null, 2));
      return;
    }
  } catch (e) {
    console.error(`Error: ${(e as Error).message}`);
    process.exit(1);
  }
}

const isMain =
  import.meta.url.startsWith("file:") &&
  process.argv[1] &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMain) main();

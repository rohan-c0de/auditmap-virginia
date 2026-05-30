/**
 * One-shot script that maps every institution in `data/{state}/institutions.json`
 * to its IPEDS unitid using the College Scorecard search endpoint, then writes
 * the chosen unitid back into the institutions file.
 *
 * Two-mode contract:
 *   tsx scripts/scorecard-map.ts            # dry run — writes mapping JSON only
 *   tsx scripts/scorecard-map.ts --apply    # apply high-confidence mappings
 *
 * Confidence tiers (the script auto-picks tiers 1–2 and writes the rest to a
 * review file the human edits manually):
 *
 *   tier 1 (exact-public-CC):
 *     - exactly one candidate matches the search
 *     - candidate.ownership === 1 (public)
 *     - candidate has non-null in-state tuition
 *
 *   tier 2 (dominant-public-CC):
 *     - multiple candidates returned, but exactly one is a public 2-year with
 *       non-null in-state tuition and enrollment ≥ 500
 *     - the next-largest candidate is < 10% of its enrollment (so it's
 *       unambiguously the right one)
 *
 *   tier 3 (review):
 *     - any other case — multiple plausible CCs, fuzzy name, zero matches,
 *       or matches but no obvious winner. Writes to
 *       `data/scorecard-mapping-review.json` for human disambiguation.
 *
 * The mapping file is read on subsequent runs so the API isn't re-hit for
 * colleges already resolved.
 */

import fs from "fs";
import {
  searchScorecardByName,
  type ScorecardRecord,
} from "@/scripts/lib/college-scorecard";

interface Institution {
  id: string;
  name: string;
  system?: string;
  college_slug?: string;
  unitid?: number;
  [k: string]: unknown;
}

interface MappingRow {
  state: string;
  id: string;
  name: string;
  /** Chosen unitid for tier-1/tier-2 picks; null until human resolves tier 3. */
  unitid: number | null;
  /** "tier1" | "tier2" | "review" | "manual" — "manual" is what humans set. */
  tier: string;
  candidates: Array<{
    unitid: number;
    name: string;
    ownership: number | null;
    predominantDegree: number | null;
    inStateTuition: number | null;
    size: number | null;
  }>;
  note?: string;
}

const MAPPING_FILE = "data/scorecard-mapping.json";
const REVIEW_FILE = "data/scorecard-mapping-review.json";

function loadMapping(): MappingRow[] {
  if (!fs.existsSync(MAPPING_FILE)) return [];
  return JSON.parse(fs.readFileSync(MAPPING_FILE, "utf-8")) as MappingRow[];
}

function saveMapping(rows: MappingRow[]): void {
  fs.writeFileSync(MAPPING_FILE, JSON.stringify(rows, null, 2) + "\n");
}

function summarizeCandidate(c: ScorecardRecord) {
  return {
    unitid: c.unitid,
    name: c.schoolName,
    ownership: c.ownership,
    predominantDegree: c.predominantDegree,
    inStateTuition: c.cost.tuitionInState,
    size: c.size,
  };
}

/**
 * Pick the best Scorecard candidate for a given institution. Returns the
 * candidate plus a tier label so the caller can decide whether to auto-apply.
 *
 * Rules in order:
 *   - drop candidates without non-null in-state tuition (eliminates schools
 *     that aren't Title IV degree-granting, e.g. some massage schools)
 *   - among the remaining, prefer ownership=1 (public) over private
 *   - if exactly one survives: tier 1
 *   - if multiple but one's enrollment dominates (>10x next): tier 2
 *   - otherwise: tier 3 (review)
 */
function pickBest(candidates: ScorecardRecord[]): {
  pick: ScorecardRecord | null;
  tier: "tier1" | "tier2" | "review";
  note?: string;
} {
  if (candidates.length === 0) {
    return { pick: null, tier: "review", note: "no candidates returned by Scorecard" };
  }

  const ccs = candidates.filter(
    (c) => c.cost.tuitionInState != null && c.ownership === 1
  );

  if (ccs.length === 1) {
    return { pick: ccs[0], tier: "tier1" };
  }

  if (ccs.length === 0) {
    return {
      pick: null,
      tier: "review",
      note: "no candidate is a public institution with non-null in-state tuition",
    };
  }

  // Multiple plausible CCs — check for dominant enrollment.
  const sortedBySize = [...ccs].sort(
    (a, b) => (b.size ?? 0) - (a.size ?? 0)
  );
  const largest = sortedBySize[0];
  const second = sortedBySize[1];
  if (
    (largest.size ?? 0) >= 500 &&
    (second.size ?? 0) * 10 < (largest.size ?? 0)
  ) {
    return {
      pick: largest,
      tier: "tier2",
      note: `chose by dominant enrollment over ${sortedBySize.length - 1} others`,
    };
  }

  return {
    pick: null,
    tier: "review",
    note: `${ccs.length} plausible public CCs returned — needs human disambiguation`,
  };
}

async function mapOne(
  state: string,
  inst: Institution,
  existing: Map<string, MappingRow>
): Promise<MappingRow> {
  const key = `${state}:${inst.id}`;
  const prior = existing.get(key);
  // Don't re-hit the API if we already resolved this (tier1/2/manual).
  // Only re-fetch for things that are still in review.
  if (prior && prior.unitid != null) return prior;

  let candidates: ScorecardRecord[] = [];
  try {
    candidates = await searchScorecardByName(inst.name, state);
  } catch (e) {
    return {
      state,
      id: inst.id,
      name: inst.name,
      unitid: null,
      tier: "review",
      candidates: [],
      note: `Scorecard fetch failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const { pick, tier, note } = pickBest(candidates);
  return {
    state,
    id: inst.id,
    name: inst.name,
    unitid: pick?.unitid ?? null,
    tier,
    candidates: candidates.map(summarizeCandidate),
    ...(note && { note }),
  };
}

async function runMapping(stateFilter: string[] = []): Promise<MappingRow[]> {
  // Load existing mapping. When running with a state filter, rows for
  // other states must be preserved on disk; this map carries them forward.
  const existingRows = loadMapping();
  const existing = new Map<string, MappingRow>(
    existingRows.map((r) => [`${r.state}:${r.id}`, r])
  );

  const allStateDirs = fs
    .readdirSync("data", { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((s) => fs.existsSync(`data/${s}/institutions.json`));
  const stateDirs =
    stateFilter.length > 0
      ? allStateDirs.filter((s) => stateFilter.includes(s))
      : allStateDirs;

  // Track which (state, id) we touch this run and the fresh row for each.
  // We preserve original row order — when we re-run for a subset of states,
  // rows for that subset are updated in place, others stay untouched.
  // Brand-new rows (a college not present in the existing mapping yet)
  // get appended at the end.
  const freshByKey = new Map<string, MappingRow>();

  for (const state of stateDirs) {
    const insts = JSON.parse(
      fs.readFileSync(`data/${state}/institutions.json`, "utf-8")
    ) as Institution[];
    process.stdout.write(`${state} (${insts.length}): `);
    for (const inst of insts) {
      const key = `${state}:${inst.id}`;
      const row = await mapOne(state, inst, existing);
      freshByKey.set(key, row);
      process.stdout.write(
        row.unitid != null ? "·" : row.tier === "review" ? "?" : "x"
      );
      // Save after each step so a crash mid-run preserves progress.
      saveMapping(mergeOrdered(existingRows, freshByKey));
    }
    process.stdout.write("\n");
  }

  return mergeOrdered(existingRows, freshByKey);
}

/**
 * Preserve original-file row order. Any (state, id) present in existingRows
 * is updated in place if it appears in freshByKey; rows not in
 * existingRows yet (brand-new colleges) are appended at the end.
 */
function mergeOrdered(
  existingRows: MappingRow[],
  freshByKey: Map<string, MappingRow>
): MappingRow[] {
  const seen = new Set<string>();
  const out: MappingRow[] = [];
  for (const r of existingRows) {
    const key = `${r.state}:${r.id}`;
    seen.add(key);
    out.push(freshByKey.get(key) ?? r);
  }
  for (const [key, r] of freshByKey) {
    if (!seen.has(key)) out.push(r);
  }
  return out;
}

function summarize(rows: MappingRow[]): void {
  const t1 = rows.filter((r) => r.tier === "tier1").length;
  const t2 = rows.filter((r) => r.tier === "tier2").length;
  const manual = rows.filter((r) => r.tier === "manual").length;
  const review = rows.filter((r) => r.tier === "review").length;
  const resolved = rows.filter((r) => r.unitid != null).length;
  console.log("");
  console.log(`Total colleges:        ${rows.length}`);
  console.log(`  tier 1 (auto):       ${t1}`);
  console.log(`  tier 2 (auto):       ${t2}`);
  console.log(`  manual (resolved):   ${manual}`);
  console.log(`  review (unresolved): ${review}`);
  console.log(`  resolved:            ${resolved} (${((resolved / rows.length) * 100).toFixed(1)}%)`);
}

function writeReviewFile(rows: MappingRow[]): void {
  const review = rows.filter(
    (r) => r.tier === "review" || r.unitid == null
  );
  if (review.length === 0) {
    if (fs.existsSync(REVIEW_FILE)) fs.unlinkSync(REVIEW_FILE);
    return;
  }
  fs.writeFileSync(REVIEW_FILE, JSON.stringify(review, null, 2) + "\n");
  console.log(
    `\nWrote ${review.length} unresolved row${review.length === 1 ? "" : "s"} to ${REVIEW_FILE}.`
  );
  console.log(
    "Edit that file: set `unitid` to the correct value from `candidates`, change `tier` to 'manual', then re-run with --apply."
  );
}

function applyMappings(rows: MappingRow[]): void {
  // Group by state
  const byState = new Map<string, MappingRow[]>();
  for (const r of rows) {
    if (r.unitid == null) continue;
    if (!byState.has(r.state)) byState.set(r.state, []);
    byState.get(r.state)!.push(r);
  }
  let totalWritten = 0;
  for (const [state, stateRows] of byState) {
    const file = `data/${state}/institutions.json`;
    const insts = JSON.parse(fs.readFileSync(file, "utf-8")) as Institution[];
    let changed = 0;
    for (const r of stateRows) {
      const inst = insts.find((i) => i.id === r.id);
      if (!inst) continue;
      if (inst.unitid === r.unitid) continue;
      // r.unitid is non-null here because we filtered above.
      inst.unitid = r.unitid as number;
      changed++;
    }
    if (changed > 0) {
      fs.writeFileSync(file, JSON.stringify(insts, null, 2) + "\n");
      console.log(`  ${state}: wrote unitid for ${changed} colleges`);
      totalWritten += changed;
    }
  }
  console.log(`\nApplied ${totalWritten} unitids across ${byState.size} states.`);
}

function parseStateFilter(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--state") {
      const v = argv[i + 1];
      if (v && !v.startsWith("--")) out.push(v.toLowerCase());
    } else if (argv[i].startsWith("--state=")) {
      out.push(argv[i].slice("--state=".length).toLowerCase());
    }
  }
  return out;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const stateFilter = parseStateFilter(process.argv.slice(2));

  const scopeLabel =
    stateFilter.length > 0 ? ` (state${stateFilter.length > 1 ? "s" : ""}: ${stateFilter.join(", ")})` : "";
  console.log(
    apply
      ? `Running scorecard-map with --apply${scopeLabel} (will write unitid to institutions.json)\n`
      : `Running scorecard-map dry-run${scopeLabel} (mapping JSON only)\n`
  );

  // Skip the API run if a fresh mapping already exists AND we're in apply
  // mode AND no state filter was passed. This makes a bare `--apply` act on
  // whatever's in the mapping file (so a human can edit it and re-apply
  // without re-hitting the API). When a --state filter is passed, we DO
  // re-run the API for that state so new colleges get fresh candidates.
  let rows: MappingRow[];
  if (apply && stateFilter.length === 0 && fs.existsSync(MAPPING_FILE)) {
    const existing = loadMapping();
    if (existing.length > 0) {
      console.log(`Loading existing mapping (${existing.length} rows) from ${MAPPING_FILE}.\n`);
      rows = existing;
    } else {
      rows = await runMapping();
    }
  } else {
    rows = await runMapping(stateFilter);
  }

  summarize(rows);
  writeReviewFile(rows);

  if (apply) {
    console.log("");
    applyMappings(rows.filter((r) => stateFilter.length === 0 || stateFilter.includes(r.state)));
  } else {
    console.log(
      `\nDry run complete. Inspect ${MAPPING_FILE}, edit ${REVIEW_FILE} for any 'review' rows, then re-run with --apply.`
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

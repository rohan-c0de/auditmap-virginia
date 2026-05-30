/**
 * Sweep stale term data from Supabase + disk.
 *
 * Retention policy (see scripts/lib/sweep-stale-terms.md):
 *   - Keep all terms ≥ current term (current + future).
 *   - Keep up to 2 terms prior to current.
 *   - Delete everything older.
 *
 * Only operates on term codes matching the canonical `YYYY{SP|SU|FA}`
 * pattern. Non-standard codes (e.g. `2026-FL`, `CE26SP`) are reported as
 * warnings and left untouched — they need manual cleanup or scraper fix.
 *
 * Usage:
 *   tsx scripts/lib/sweep-stale-terms.ts                # all states, real delete
 *   tsx scripts/lib/sweep-stale-terms.ts --dry-run      # show what would happen
 *   tsx scripts/lib/sweep-stale-terms.ts --state va     # one state only
 *   tsx scripts/lib/sweep-stale-terms.ts --state va --dry-run
 */

import * as fs from "fs";
import * as path from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "./load-env";
import { getAllStates } from "../../lib/states/registry";
import { termSortKey } from "../../lib/term-label";

const CANONICAL_TERM_RE = /^(\d{4})(SP|SU|FA)$/;
const KEEP_PRIOR_COUNT = 2;

interface SweepPlan {
  state: string;
  currentTerm: string;
  keep: string[];
  deleteTerms: string[];
  nonStandardTerms: string[];
  diskFilesToDelete: string[];
}

function getSupabase(): SupabaseClient {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local"
    );
  }
  return createClient(url, key);
}

/**
 * Get the current term for a state from Supabase — defined as the term
 * with the broadest college coverage, breaking ties by recency. Mirrors
 * lib/terms.ts but reimplemented here so this script doesn't need to
 * pull the full server-side cache machinery.
 */
async function getCurrentTerm(sb: SupabaseClient, state: string): Promise<string | null> {
  const { data, error } = await sb.rpc("get_term_college_counts", {
    p_state: state,
  });
  if (error || !data || data.length === 0) return null;

  let bestTerm = data[0].term as string;
  let bestCount = Number(data[0].college_count);
  let bestSort = termSortKey(bestTerm);

  for (const row of data) {
    const term = row.term as string;
    const count = Number(row.college_count);
    const sort = termSortKey(term);
    if (count > bestCount || (count === bestCount && sort > bestSort)) {
      bestTerm = term;
      bestCount = count;
      bestSort = sort;
    }
  }
  return bestTerm;
}

/**
 * Distinct terms present in Supabase for this state.
 */
async function getDbTerms(sb: SupabaseClient, state: string): Promise<string[]> {
  const seen = new Set<string>();
  const PAGE_SIZE = 1000;
  let page = 0;
  while (true) {
    const start = page * PAGE_SIZE;
    const { data: rows, error } = await sb
      .from("courses")
      .select("term")
      .eq("state", state)
      .range(start, start + PAGE_SIZE - 1);
    if (error) throw error;
    if (!rows || rows.length === 0) break;
    for (const r of rows) if (r.term) seen.add(r.term);
    if (rows.length < PAGE_SIZE) break;
    page++;
  }
  return Array.from(seen);
}

/**
 * JSON term files on disk for a state — returns `{term, fullPath}` pairs.
 */
function getDiskTerms(state: string): { term: string; fullPath: string }[] {
  const dir = path.join(process.cwd(), "data", state, "courses");
  if (!fs.existsSync(dir)) return [];
  const out: { term: string; fullPath: string }[] = [];
  for (const college of fs.readdirSync(dir)) {
    const collegeDir = path.join(dir, college);
    if (!fs.statSync(collegeDir).isDirectory()) continue;
    for (const file of fs.readdirSync(collegeDir)) {
      if (!file.endsWith(".json")) continue;
      const term = file.replace(/\.json$/, "");
      out.push({ term, fullPath: path.join(collegeDir, file) });
    }
  }
  return out;
}

/**
 * Compute the sweep plan for one state without touching anything.
 */
async function planState(sb: SupabaseClient, state: string): Promise<SweepPlan> {
  const currentTerm = await getCurrentTerm(sb, state);
  if (!currentTerm) {
    return {
      state,
      currentTerm: "",
      keep: [],
      deleteTerms: [],
      nonStandardTerms: [],
      diskFilesToDelete: [],
    };
  }

  const currentSort = termSortKey(currentTerm);
  if (currentSort === 0) {
    // Current term itself is non-standard — refuse to sweep. Surface as
    // a warning and let a human investigate.
    return {
      state,
      currentTerm,
      keep: [],
      deleteTerms: [],
      nonStandardTerms: [currentTerm],
      diskFilesToDelete: [],
    };
  }

  const dbTerms = await getDbTerms(sb, state);
  const diskTerms = getDiskTerms(state);
  const allTerms = new Set<string>([
    ...dbTerms,
    ...diskTerms.map((d) => d.term),
  ]);

  // Standard codes only — non-standard get surfaced separately.
  const standard: string[] = [];
  const nonStandard: string[] = [];
  for (const t of allTerms) {
    if (CANONICAL_TERM_RE.test(t)) standard.push(t);
    else nonStandard.push(t);
  }

  // Sort standard terms newest-first.
  standard.sort((a, b) => termSortKey(b) - termSortKey(a));

  // Determine the floor: 2 standard terms prior to current.
  // "Prior" = terms strictly older than current. Take the 2 newest of those.
  const olderThanCurrent = standard.filter(
    (t) => termSortKey(t) < currentSort
  );
  const keepPrior = olderThanCurrent.slice(0, KEEP_PRIOR_COUNT);
  const floorSort = keepPrior.length > 0
    ? termSortKey(keepPrior[keepPrior.length - 1])
    : currentSort; // no priors? floor = current term itself

  const keep = standard.filter((t) => termSortKey(t) >= floorSort);
  const deleteTerms = standard.filter((t) => termSortKey(t) < floorSort);

  const diskFilesToDelete = diskTerms
    .filter((d) => deleteTerms.includes(d.term))
    .map((d) => d.fullPath);

  return {
    state,
    currentTerm,
    keep,
    deleteTerms,
    nonStandardTerms: nonStandard,
    diskFilesToDelete,
  };
}

/**
 * Execute a sweep plan — DELETE from Supabase, unlink JSON files.
 */
async function executePlan(sb: SupabaseClient, plan: SweepPlan): Promise<void> {
  for (const term of plan.deleteTerms) {
    const { error } = await sb
      .from("courses")
      .delete()
      .eq("state", plan.state)
      .eq("term", term);
    if (error) {
      console.error(`  ✗ ${plan.state}/${term}: ${error.message}`);
      continue;
    }
    console.log(`  ✓ deleted Supabase rows for ${plan.state}/${term}`);
  }
  for (const file of plan.diskFilesToDelete) {
    try {
      fs.unlinkSync(file);
      console.log(`  ✓ removed ${path.relative(process.cwd(), file)}`);
    } catch (err) {
      console.error(`  ✗ unlink ${file}: ${(err as Error).message}`);
    }
  }
}

function printPlan(plan: SweepPlan, dryRun: boolean): void {
  const prefix = dryRun ? "[dry-run]" : "[sweep]";
  console.log(`\n${prefix} ${plan.state.toUpperCase()}`);
  if (!plan.currentTerm) {
    console.log("  (no data in Supabase — skipping)");
    return;
  }
  console.log(`  current term: ${plan.currentTerm}`);
  console.log(`  keep (${plan.keep.length}): ${plan.keep.join(", ") || "—"}`);
  if (plan.deleteTerms.length > 0) {
    console.log(`  DELETE (${plan.deleteTerms.length}): ${plan.deleteTerms.join(", ")}`);
    console.log(`  disk files affected: ${plan.diskFilesToDelete.length}`);
  } else {
    console.log("  nothing to delete");
  }
  if (plan.nonStandardTerms.length > 0) {
    console.log(
      `  ⚠ non-standard terms (skipped, manual cleanup): ${plan.nonStandardTerms.join(", ")}`
    );
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const stateIdx = args.indexOf("--state");
  const targetState = stateIdx >= 0 ? args[stateIdx + 1] : null;

  const sb = getSupabase();
  const states = getAllStates()
    .map((s) => s.slug)
    .filter((s) => !targetState || s === targetState);

  if (states.length === 0) {
    console.error(`No states match. Available: ${getAllStates().map((s) => s.slug).join(", ")}`);
    process.exit(1);
  }

  console.log(
    `Sweep-stale-terms: ${dryRun ? "DRY RUN" : "LIVE"} | states: ${states.join(", ")}`
  );
  console.log(
    `Policy: keep current term + all future terms + ${KEEP_PRIOR_COUNT} prior. Delete the rest.`
  );

  let totalDeletes = 0;
  let totalNonStandard = 0;
  for (const state of states) {
    const plan = await planState(sb, state);
    printPlan(plan, dryRun);
    totalDeletes += plan.deleteTerms.length;
    totalNonStandard += plan.nonStandardTerms.length;
    if (!dryRun && plan.deleteTerms.length > 0) {
      await executePlan(sb, plan);
    }
  }

  console.log(
    `\nDone. ${dryRun ? "(would have)" : ""} deleted ${totalDeletes} (state,term) pair${totalDeletes === 1 ? "" : "s"}.`
  );
  if (totalNonStandard > 0) {
    console.log(
      `⚠ ${totalNonStandard} non-standard term codes need manual review (see warnings above).`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

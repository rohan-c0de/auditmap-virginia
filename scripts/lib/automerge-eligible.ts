/**
 * automerge-eligible.ts — decide which open scheduled-scrape PRs are safe to
 * auto-merge.
 *
 * This is the cheap *metadata* filter behind the auto-merge sweeper
 * (.github/workflows/auto-merge-scraper-prs.yml). It never merges anything; it
 * classifies open PRs so the workflow can (a) REPORT what it *would* merge in
 * dry-run mode, or (b) hand the eligible set to the per-PR validation +
 * `gh pr merge` step in live mode.
 *
 * Why a separate, pure, unit-tested module: the eligibility rules ARE the
 * security boundary of this feature, so they live in one place with tests
 * rather than smeared across bash. The expensive checks stay in the workflow —
 * checking out each PR's data onto *current* main and re-running
 * `npm run check:data` + `scripts/lib/scrape-diff.ts` — to catch data that
 * passes metadata but regressed because main moved since the PR opened.
 *
 * Eligibility is two-tiered, on purpose:
 *   - SAFE      = provenance + path-allowlist + single-state + labels + not
 *                 draft + mergeable + soak + file-cap + state-not-unhealthy.
 *                 A PR a human would never need to think twice about.
 *   - ELIGIBLE  = SAFE && state ∈ ALLOWLIST. The allowlist is the staged-rollout
 *                 scope knob. Report mode surfaces "safe but not yet
 *                 allowlisted" separately so you can watch the sweeper's
 *                 judgement on states before widening scope to them.
 *
 * The dangerous failure mode (bad data replacing good data) is already blocked
 * three times elsewhere — scrape-diff's 50% gate at PR-creation, and
 * supabase-import.ts's 50% change-detection + schema validation at import. This
 * module does not relax any of those; it only replaces the human "skim the
 * diff" step, and adds the check:data gate that today never runs on these PRs
 * (bot-token PRs don't trigger pull_request CI).
 *
 * Usage (CLI):
 *   npx tsx scripts/lib/automerge-eligible.ts \
 *     --allowlist nc,id,ny --max-files 25 --soak-hours 4 \
 *     --history data/state-health/history.jsonl --window-days 14 \
 *     --out /tmp/eligible.json
 *
 * Output JSON: { generatedAt, config, healthError, candidates,
 *                safeNotAllowlisted, skipped, markdown }
 */

import * as fs from "node:fs";
import * as os from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Constants — the eligibility rules
// ---------------------------------------------------------------------------

/**
 * The only two file shapes a phase-1 scrape PR may touch. Anchored: a single
 * stray path (a lib/ edit, a config change, a migration) fails the whole PR and
 * leaves it for a human. State slug is `[a-z]{2}` — verified against the
 * registry: all 51 slugs (50 states + dc) are exactly two chars.
 */
const COURSES_RE = /^data\/([a-z]{2})\/courses\/[^/]+\/[^/]+\.json$/;
const PREREQS_RE = /^data\/([a-z]{2})\/prereqs\.json$/;

/** Branch the scrape workflow opens PRs on: scheduled-scrape/{state}-{datatype}. */
const BRANCH_RE =
  /^scheduled-scrape\/([a-z]{2})-(courses|transfers|prereqs|programs)$/;

const BOT_LOGIN = "app/github-actions";
const REQUIRED_LABELS = ["scraper-output", "automated"];
const DENY_LABEL = "do-not-automerge";

/** Triage classifications that exclude a state from auto-merge this run. */
const UNHEALTHY_CLASSIFICATIONS = new Set([
  "persistent-broken",
  "regression",
  "partial-coverage-degraded",
]);

const HOUR_MS = 3_600_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The subset of `gh pr list --json …` fields this module reads. */
export interface PrFacts {
  number: number;
  author: { login: string; is_bot: boolean };
  headRefName: string;
  labels: Array<{ name: string }>;
  files: Array<{ path: string }>;
  mergeable: string; // "MERGEABLE" | "CONFLICTING" | "UNKNOWN"
  createdAt: string; // ISO 8601
  isDraft: boolean;
}

export interface EligibilityConfig {
  /** State slugs cleared for live auto-merge. Empty ⇒ nothing is eligible. */
  allowlist: string[];
  /** States currently classified unhealthy by triage — excluded. */
  healthFlagged: Set<string>;
  maxFiles: number;
  soakHours: number;
  /** Injected for deterministic tests; the CLI passes Date.now(). */
  nowMs: number;
}

export interface EligibilityResult {
  number: number;
  state: string | null;
  datatype: string | null;
  fileCount: number;
  /** True when every safety guard passes (allowlist NOT considered). */
  safe: boolean;
  inAllowlist: boolean;
  /** safe && inAllowlist — the set the workflow may actually merge. */
  eligible: boolean;
  /** Human-readable reasons the PR is not SAFE (empty when safe). */
  reasons: string[];
}

// ---------------------------------------------------------------------------
// Pure evaluation — the unit-tested core
// ---------------------------------------------------------------------------

function statesFromFiles(files: Array<{ path: string }>): {
  states: Set<string>;
  nonData: string[];
} {
  const states = new Set<string>();
  const nonData: string[] = [];
  for (const f of files) {
    const m = COURSES_RE.exec(f.path) ?? PREREQS_RE.exec(f.path);
    if (m) states.add(m[1]);
    else nonData.push(f.path);
  }
  return { states, nonData };
}

/**
 * Classify one PR. Pure: same inputs ⇒ same output, no I/O. This is the
 * function the unit tests exercise and the function that gatekeeps every
 * auto-merge.
 */
export function evaluatePr(
  pr: PrFacts,
  cfg: EligibilityConfig
): EligibilityResult {
  const reasons: string[] = [];
  const files = pr.files ?? [];

  // 1. Provenance — must be the scrape bot, not a human or another bot.
  if (!pr.author?.is_bot || pr.author.login !== BOT_LOGIN) {
    reasons.push(`author '${pr.author?.login ?? "?"}' is not the scrape bot`);
  }

  // 2. Branch — scheduled-scrape/{state}-{datatype}.
  const branchMatch = BRANCH_RE.exec(pr.headRefName);
  if (!branchMatch) {
    reasons.push(`branch '${pr.headRefName}' is not scheduled-scrape/{state}-{datatype}`);
  }
  const branchState = branchMatch?.[1] ?? null;
  const datatype = branchMatch?.[2] ?? null;

  // 3. Labels — both required present, deny-label absent.
  const labelNames = new Set((pr.labels ?? []).map((l) => l.name));
  for (const req of REQUIRED_LABELS) {
    if (!labelNames.has(req)) reasons.push(`missing label '${req}'`);
  }
  if (labelNames.has(DENY_LABEL)) reasons.push(`has '${DENY_LABEL}' label`);

  // 4. Draft PRs are never auto-merged.
  if (pr.isDraft) reasons.push("draft PR");

  // 5. Path allowlist + exactly one state across all changed files.
  const { states, nonData } = statesFromFiles(files);
  if (nonData.length > 0) {
    const shown = nonData.slice(0, 3).join(", ");
    const more = nonData.length > 3 ? ` (+${nonData.length - 3} more)` : "";
    reasons.push(`touches non-data path(s): ${shown}${more}`);
  }
  let state: string | null = null;
  if (files.length === 0) {
    reasons.push("no changed files");
  } else if (states.size > 1) {
    reasons.push(`touches multiple states: ${[...states].sort().join(", ")}`);
  } else if (states.size === 1) {
    state = [...states][0];
    if (branchState && branchState !== state) {
      reasons.push(`branch state '${branchState}' != path state '${state}'`);
    }
  }

  // 6. File-count cap.
  if (files.length > cfg.maxFiles) {
    reasons.push(`${files.length} files > cap ${cfg.maxFiles}`);
  }

  // 7. Mergeable — skip conflicts; treat not-yet-computed as a retry, not a
  //    pass. GitHub computes mergeability lazily, so UNKNOWN is common on a
  //    fresh listing and simply means "look again next run".
  if (pr.mergeable === "CONFLICTING") {
    reasons.push("has merge conflicts");
  } else if (pr.mergeable !== "MERGEABLE") {
    reasons.push(`mergeability '${pr.mergeable}' not yet known (retry next run)`);
  }

  // 8. Health exclusion — never auto-merge a state whose scraper triage is
  //    currently flagging trouble.
  if (state && cfg.healthFlagged.has(state)) {
    reasons.push(`state '${state}' flagged unhealthy by scraper triage`);
  }

  // 9. Soak — give a human a window to intervene before the sweeper acts.
  const ageMs = cfg.nowMs - new Date(pr.createdAt).getTime();
  if (Number.isNaN(ageMs)) {
    reasons.push(`unparseable createdAt '${pr.createdAt}'`);
  } else if (ageMs < cfg.soakHours * HOUR_MS) {
    reasons.push(
      `too new (${(ageMs / HOUR_MS).toFixed(1)}h < soak ${cfg.soakHours}h)`
    );
  }

  const safe = reasons.length === 0;
  const inAllowlist = state != null && cfg.allowlist.includes(state);
  return {
    number: pr.number,
    state,
    datatype,
    fileCount: files.length,
    safe,
    inAllowlist,
    eligible: safe && inAllowlist,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// Health — derive the excluded-states set from triage
// ---------------------------------------------------------------------------

export function computeHealthFlagged(
  historyPath: string,
  windowDays: number
): { flagged: Set<string>; error: string | null } {
  const flagged = new Set<string>();
  // Shell out to the existing triage classifier rather than import it: its
  // module body runs main() on load (it's a CLI), so importing it would run
  // the triage CLI against our argv. The scheduled-scrape workflow invokes it
  // the same way. Resolve the script path from __dirname so cwd doesn't matter.
  const triageScript = join(__dirname, "triage-scraper-health.ts");
  const tmp = join(os.tmpdir(), `automerge-triage-${process.pid}.json`);
  try {
    execFileSync(
      "npx",
      [
        "tsx",
        triageScript,
        "--history",
        historyPath,
        "--window-days",
        String(windowDays),
        "--out",
        tmp,
      ],
      { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"], maxBuffer: 64 * 1024 * 1024 }
    );
    const parsed = JSON.parse(fs.readFileSync(tmp, "utf8")) as {
      results: Array<{ state: string; classification: string }>;
    };
    for (const r of parsed.results ?? []) {
      if (UNHEALTHY_CLASSIFICATIONS.has(r.classification)) flagged.add(r.state);
    }
    return { flagged, error: null };
  } catch (e) {
    // Surface the error. The workflow treats a non-null healthError as
    // "can't verify health → do not merge this run" (report only), rather
    // than silently merging without the health gate.
    return { flagged, error: (e as Error).message };
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* best-effort cleanup */
    }
  }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function table(rows: EligibilityResult[], withReasons: boolean): string {
  if (rows.length === 0) return "_none_\n";
  const head = withReasons
    ? "| PR | State | Type | Files | Why skipped |\n|---:|---|---|---:|---|"
    : "| PR | State | Type | Files |\n|---:|---|---|---:|";
  const body = rows
    .map((r) => {
      const base = `| #${r.number} | ${r.state ?? "—"} | ${r.datatype ?? "—"} | ${r.fileCount}`;
      return withReasons ? `${base} | ${r.reasons.join("; ")} |` : `${base} |`;
    })
    .join("\n");
  return `${head}\n${body}\n`;
}

export function buildMarkdown(
  candidates: EligibilityResult[],
  safeNotAllowlisted: EligibilityResult[],
  skipped: EligibilityResult[],
  meta: {
    allowlist: string[];
    maxFiles: number;
    soakHours: number;
    healthError: string | null;
  }
): string {
  const lines: string[] = [];
  lines.push("## Auto-merge sweeper — eligibility report");
  lines.push("");
  lines.push(
    `allowlist: \`${meta.allowlist.join(", ") || "(empty)"}\` · max-files: ${meta.maxFiles} · soak: ${meta.soakHours}h`
  );
  if (meta.healthError) {
    lines.push("");
    lines.push(
      `> ⚠️ scraper-health triage failed (\`${meta.healthError}\`) — **no merges this run**; health exclusion could not be verified.`
    );
  }
  lines.push("");
  lines.push(`### ✅ Eligible (safe + allowlisted) — ${candidates.length}`);
  lines.push(table(candidates, false));
  lines.push(`### 🟡 Safe but not allowlisted — ${safeNotAllowlisted.length}`);
  lines.push(table(safeNotAllowlisted, false));
  lines.push(`### ⛔ Skipped — ${skipped.length}`);
  lines.push(table(skipped, true));
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// PR fetch
// ---------------------------------------------------------------------------

function fetchOpenPrs(limit: number): PrFacts[] {
  const out = execFileSync(
    "gh",
    [
      "pr",
      "list",
      "--state",
      "open",
      "--limit",
      String(limit),
      "--json",
      "number,author,headRefName,labels,files,mergeable,createdAt,isDraft",
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  return JSON.parse(out) as PrFacts[];
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function arg(args: string[], flag: string): string | null {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] ?? null : null;
}

function main(): void {
  const args = process.argv.slice(2);
  const allowlist = (arg(args, "--allowlist") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const maxFiles = parseInt(arg(args, "--max-files") ?? "25", 10);
  const soakHours = parseFloat(arg(args, "--soak-hours") ?? "4");
  const historyPath =
    arg(args, "--history") ?? "data/state-health/history.jsonl";
  const windowDays = parseInt(arg(args, "--window-days") ?? "14", 10);
  const limit = parseInt(arg(args, "--limit") ?? "100", 10);
  const outPath = arg(args, "--out");
  const nowMs = Date.now();

  const { flagged: healthFlagged, error: healthError } = computeHealthFlagged(
    historyPath,
    windowDays
  );

  const prs = fetchOpenPrs(limit);
  const cfg: EligibilityConfig = {
    allowlist,
    healthFlagged,
    maxFiles,
    soakHours,
    nowMs,
  };
  const evaluated = prs.map((p) => evaluatePr(p, cfg));

  const candidates = evaluated.filter((r) => r.eligible);
  const safeNotAllowlisted = evaluated.filter((r) => r.safe && !r.inAllowlist);
  const skipped = evaluated.filter((r) => !r.safe);

  const markdown = buildMarkdown(candidates, safeNotAllowlisted, skipped, {
    allowlist,
    maxFiles,
    soakHours,
    healthError,
  });

  const output = {
    generatedAt: new Date(nowMs).toISOString(),
    config: { allowlist, maxFiles, soakHours, windowDays },
    healthError,
    candidates,
    safeNotAllowlisted,
    skipped,
    markdown,
  };

  const json = JSON.stringify(output, null, 2);
  if (outPath) {
    fs.writeFileSync(outPath, json);
    console.error(`Wrote ${outPath}`);
  }
  console.log(json);
  console.error("\n" + markdown);
}

// Only run the CLI when invoked directly (not when imported by tests).
if (process.argv[1]?.includes("automerge-eligible")) {
  main();
}

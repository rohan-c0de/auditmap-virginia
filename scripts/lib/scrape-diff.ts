/**
 * scrape-diff.ts — generalized row-count diff against `HEAD`.
 *
 * Used by the unified scheduled-scrape workflow (issue #59) to decide
 * whether to open a PR with fresh scraper output or open an issue
 * because the scraper looks broken. Replaces `scripts/va/weekly-scrape-diff.ts`.
 *
 * Same abort threshold (50%) as `scripts/lib/supabase-import.ts`'s
 * change-detection preflight — the workflow and the import agree on what
 * "scraper looks broken" means.
 *
 * For prereqs.json files the check additionally groups entries by their
 * `source` tag and applies the 50% threshold per group. A prereqs.json is
 * a merge of independent inputs (section-derived aggregation + one entry
 * set per catalog scraper); one input vanishing entirely can leave the
 * total just above 50% — MA's 2026-06 cron run deleted all 926
 * gcc/middlesex entries yet kept 52.4% of rows, sailing through the
 * file-level gate.
 *
 * Usage:
 *   npx tsx scripts/lib/scrape-diff.ts --path data/ --format json
 *   npx tsx scripts/lib/scrape-diff.ts --path data/va/courses --format markdown
 *
 * Output formats:
 *   json:     { broken, changed, regressions: [...], summary }
 *   markdown: human-readable PR/issue body with tables
 */

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export const ABORT_RATIO = 0.5;
// `typeof` guard: vitest imports this module as ESM (no __dirname) to test
// the pure helpers; only the CLI path below ever reads ROOT.
const ROOT =
  typeof __dirname !== "undefined" ? resolve(__dirname, "..", "..") : process.cwd();

interface Regression {
  file: string;
  before: number;
  after: number;
  ratio: string;
}

interface ChangedFile {
  file: string;
  before: number;
  after: number;
  delta: number;
}

function sh(cmd: string): string {
  // 64 MB buffer — a single VA (college, term) JSON can exceed the
  // Node default 1 MB limit once a few hundred sections land.
  return execSync(cmd, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

export function countRows(text: string): number {
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.length;
    // prereqs.json is an object keyed by "PREFIX NUMBER" — row-count
    // means top-level keys.
    if (parsed && typeof parsed === "object") return Object.keys(parsed).length;
    return 0;
  } catch {
    return 0;
  }
}

/**
 * Entry counts per `source` tag for a prereqs.json payload. Entries
 * without a tag (section-derived aggregation) group under "aggregate".
 */
export function countBySource(text: string): Record<string, number> {
  const counts: Record<string, number> = {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return counts;
    }
    for (const entry of Object.values(parsed)) {
      const source =
        entry && typeof entry === "object" && typeof (entry as { source?: unknown }).source === "string"
          ? (entry as { source: string }).source
          : "aggregate";
      counts[source] = (counts[source] ?? 0) + 1;
    }
  } catch {
    /* unparseable — treated as no groups */
  }
  return counts;
}

/**
 * Row counts per value of `field` for an array payload (e.g.
 * transfer-equiv.json rows grouped by their `university`). Rows missing
 * the field group under "(none)".
 */
export function countByField(
  text: string,
  field: string,
): Record<string, number> {
  const counts: Record<string, number> = {};
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return counts;
    for (const row of parsed) {
      const value =
        row && typeof row === "object" && typeof row[field] === "string"
          ? (row[field] as string)
          : "(none)";
      counts[value] = (counts[value] ?? 0) + 1;
    }
  } catch {
    /* unparseable — treated as no groups */
  }
  return counts;
}

/**
 * Apply a retention threshold per group. A group that had at least
 * `minGroup` entries before and retains under `abortRatio` of them is a
 * regression — its scraper (or input) broke, regardless of what the
 * file-level total says. Tiny groups are skipped: a 4→1 blip shouldn't
 * abort a whole state's cron tick.
 */
function groupRegressions(
  file: string,
  label: string,
  before: Record<string, number>,
  after: Record<string, number>,
  minGroup: number,
  abortRatio: number,
): Regression[] {
  const out: Regression[] = [];
  for (const [group, b] of Object.entries(before)) {
    if (b < minGroup) continue;
    const a = after[group] ?? 0;
    const ratio = a / b;
    if (ratio < abortRatio) {
      out.push({
        file: `${file} [${label}: ${group}]`,
        before: b,
        after: a,
        ratio: `${(ratio * 100).toFixed(1)}%`,
      });
    }
  }
  return out;
}

/** Per-source regressions between two prereqs.json payloads. */
export function sourceRegressions(
  file: string,
  beforeText: string,
  afterText: string,
  minGroup = 20,
): Regression[] {
  return groupRegressions(
    file,
    "source",
    countBySource(beforeText),
    countBySource(afterText),
    minGroup,
    ABORT_RATIO,
  );
}

/**
 * Per-receiving-university regressions between two transfer-equiv.json
 * payloads. One receiver's scrape dying mid-pagination can hide inside a
 * passing file total — RI's 2026-06 cron run shipped RIC at 546 of 840
 * rows while the file-level ratio passed easily (PR #1261).
 *
 * The threshold here is 75%, deliberately tighter than the file-level
 * ABORT_RATIO: articulation agreements are near-static between runs
 * (healthy receivers in the same incident moved by ±0.2%), so retaining
 * only 65% of one receiver — which sails past a 50% gate — is a partial
 * scrape, not churn. A genuine large prune trips this and takes the
 * manual-run escape hatch, same as any file-level abort.
 */
export const UNIVERSITY_ABORT_RATIO = 0.75;

export function universityRegressions(
  file: string,
  beforeText: string,
  afterText: string,
  minGroup = 20,
): Regression[] {
  return groupRegressions(
    file,
    "university",
    countByField(beforeText, "university"),
    countByField(afterText, "university"),
    minGroup,
    UNIVERSITY_ABORT_RATIO,
  );
}

function main(): void {
  const args = process.argv.slice(2);
  const pathIdx = args.indexOf("--path");
  const fmtIdx = args.indexOf("--format");
  const pathPrefix = pathIdx >= 0 ? args[pathIdx + 1] : "data/";
  const format = (fmtIdx >= 0 ? args[fmtIdx + 1] : "json") as "json" | "markdown";

  function beforeText(file: string): string {
    try {
      return sh(`git show HEAD:${file}`);
    } catch {
      return "";
    }
  }

  function afterText(file: string): string {
    const abs = resolve(ROOT, file);
    if (!existsSync(abs)) return "";
    return readFileSync(abs, "utf8");
  }

  const tracked = sh(`git ls-files ${pathPrefix}`)
    .trim()
    .split("\n")
    .filter((f) => f.endsWith(".json"));

  const untracked = sh(`git ls-files --others --exclude-standard ${pathPrefix}`)
    .trim()
    .split("\n")
    .filter((f) => f.endsWith(".json"));

  const files = Array.from(new Set([...tracked, ...untracked])).filter(Boolean);

  const regressions: Regression[] = [];
  const changedFiles: ChangedFile[] = [];

  for (const file of files) {
    const beforeRaw = beforeText(file);
    const afterRaw = afterText(file);
    const before = countRows(beforeRaw);
    const after = countRows(afterRaw);
    if (before === after && beforeRaw === afterRaw) continue;

    if (before !== after) {
      changedFiles.push({ file, before, after, delta: after - before });
    }

    // First-time-added file (before = 0) cannot regress.
    if (before === 0) continue;

    const ratio = after / before;
    if (ratio < ABORT_RATIO) {
      regressions.push({
        file,
        before,
        after,
        ratio: `${(ratio * 100).toFixed(1)}%`,
      });
    } else if (file.endsWith("prereqs.json")) {
      regressions.push(...sourceRegressions(file, beforeRaw, afterRaw));
    } else if (file.endsWith("transfer-equiv.json")) {
      regressions.push(...universityRegressions(file, beforeRaw, afterRaw));
    }
  }

  const broken = regressions.length > 0;
  const summary = broken
    ? `ABORT: ${regressions.length} file(s) dropped below ${(ABORT_RATIO * 100).toFixed(0)}% of prior row count.`
    : changedFiles.length === 0
      ? "No changes — scraper output identical to main."
      : `${changedFiles.length} file(s) changed; all within acceptable range.`;

  if (format === "markdown") {
    const lines: string[] = [];
    lines.push(`**${summary}**`, "");
    if (broken) {
      lines.push("## Regressions");
      lines.push("| File | Before | After | Ratio |");
      lines.push("|---|---:|---:|---:|");
      for (const r of regressions) {
        lines.push(`| \`${r.file}\` | ${r.before} | ${r.after} | ${r.ratio} |`);
      }
      lines.push("");
    }
    if (changedFiles.length > 0 && !broken) {
      lines.push("## Changes");
      lines.push("| File | Before | After | Δ |");
      lines.push("|---|---:|---:|---:|");
      for (const c of changedFiles.slice(0, 50)) {
        const d = c.delta >= 0 ? `+${c.delta}` : `${c.delta}`;
        lines.push(`| \`${c.file}\` | ${c.before} | ${c.after} | ${d} |`);
      }
      if (changedFiles.length > 50) {
        lines.push(`| …and ${changedFiles.length - 50} more | | | |`);
      }
    }
    console.log(lines.join("\n"));
  } else {
    console.log(
      JSON.stringify(
        { broken, changed: changedFiles.length, regressions, summary },
        null,
        2
      )
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

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

const ABORT_RATIO = 0.5;
const ROOT = resolve(__dirname, "..", "..");

const args = process.argv.slice(2);
const pathIdx = args.indexOf("--path");
const fmtIdx = args.indexOf("--format");
const pathPrefix = pathIdx >= 0 ? args[pathIdx + 1] : "data/";
const format = (fmtIdx >= 0 ? args[fmtIdx + 1] : "json") as "json" | "markdown";

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

function countRows(text: string): number {
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

function beforeCount(file: string): number {
  try {
    return countRows(sh(`git show HEAD:${file}`));
  } catch {
    return 0;
  }
}

function afterCount(file: string): number {
  const abs = resolve(ROOT, file);
  if (!existsSync(abs)) return 0;
  return countRows(readFileSync(abs, "utf8"));
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
  const before = beforeCount(file);
  const after = afterCount(file);
  if (before === after) continue;

  changedFiles.push({ file, before, after, delta: after - before });

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

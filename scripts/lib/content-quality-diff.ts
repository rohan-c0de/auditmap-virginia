/**
 * content-quality-diff.ts — catch scraper output that is *semantically*
 * degraded even though row-count and schema look fine.
 *
 * scrape-diff.ts gates on row COUNT (a file dropping <50% of prior rows). The
 * import gates on per-row SCHEMA. Neither catches the middle ground: a refresh
 * that keeps ~the same number of well-typed rows but whose CONTENT regressed —
 * the source hid the instructor column (everything became "STAFF"), a parser
 * shift blanked the titles, or a `mode` label leaked (the exact failure that
 * silently dropped colleges before — import aborts a term at >5% invalid mode).
 *
 * This is the gate that narrows the "semantically wrong but plausible" gap the
 * auto-merge sweeper would otherwise inherit from a human skim. It runs in the
 * sweeper's per-PR re-validation, after scrape-diff + check:data, on the same
 * overlay (PR data in the working tree, current main at HEAD).
 *
 * Philosophy — false-positive-resistant by construction:
 *   - EXISTING files are judged only on REGRESSION FROM A HEALTHY BASELINE: a
 *     metric that was healthy on main and dropped materially now. A college
 *     whose data is chronically sparse never trips (it isn't a regression), so
 *     we don't flag the same college every week.
 *   - NEW files (no main baseline) are judged on absolute floors only, to catch
 *     a brand-new garbage file.
 *   - A false positive just means "merge it by hand" (status quo); a false
 *     negative is still backstopped by import-time schema + 50% checks. So we
 *     tune toward NOT crying wolf.
 *
 * Only `courses/**` files are analyzed (prereqs.json is a different shape and
 * is already gated by scrape-diff's key-count + check:data).
 *
 * Usage:
 *   npx tsx scripts/lib/content-quality-diff.ts --path data/nc --format json
 *   npx tsx scripts/lib/content-quality-diff.ts --path data/nc --format markdown
 *
 * Output JSON: { degraded, filesChecked, findings: [...], summary }
 */

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..");

// Valid values for the required `mode` enum (lib/schemas.ts CourseSectionSchema).
const VALID_MODES = new Set(["in-person", "online", "hybrid", "zoom"]);

// Instructor strings that mean "no real instructor yet" — legitimate, so only
// a *surge* relative to the prior file is suspicious, never the absolute level.
const INSTRUCTOR_PLACEHOLDERS = new Set([
  "",
  "staff",
  "tba",
  "tbd",
  "to be announced",
  "to be determined",
]);

// A metric counts as "healthy on main" at/above this; below the relative drop
// it's a regression. Tuned so normal refresh churn never trips.
const HEALTHY = { titleFill: 0.95, keyFill: 0.98, modeValid: 0.95 } as const;
const DROP = { titleFill: 0.1, keyFill: 0.05, modeValid: 0.05 } as const;
// Absolute floors applied to NEW files only (no baseline to regress against).
const NEW_FILE_FLOOR = { titleFill: 0.5, keyFill: 0.9, modeValid: 0.95 } as const;

// ---------------------------------------------------------------------------
// Pure core — unit-tested
// ---------------------------------------------------------------------------

export interface SectionLike {
  course_prefix?: string | null;
  course_number?: string | null;
  course_title?: string | null;
  mode?: string | null;
  instructor?: string | null;
}

export interface QualityMetrics {
  rows: number;
  titleFill: number; // fraction with a non-empty course_title
  keyFill: number; // fraction with both prefix AND number
  modeValid: number; // fraction with mode ∈ enum
  instructorPlaceholder: number; // fraction with placeholder/empty instructor
}

export interface QualityFinding {
  file: string;
  metric: string;
  before: number;
  after: number;
  reason: string;
}

function nonEmpty(s: unknown): boolean {
  return typeof s === "string" && s.trim().length > 0;
}

/** Compute content-quality metrics over a section array. */
export function measure(rows: SectionLike[]): QualityMetrics {
  const n = rows.length;
  // Empty file ⇒ neutral. A 100%-row-drop is scrape-diff's job, not ours.
  if (n === 0) {
    return { rows: 0, titleFill: 1, keyFill: 1, modeValid: 1, instructorPlaceholder: 0 };
  }
  let title = 0;
  let key = 0;
  let mode = 0;
  let placeholder = 0;
  for (const r of rows) {
    if (nonEmpty(r.course_title)) title++;
    if (nonEmpty(r.course_prefix) && nonEmpty(r.course_number)) key++;
    if (typeof r.mode === "string" && VALID_MODES.has(r.mode)) mode++;
    const instr = (r.instructor ?? "").trim().toLowerCase();
    if (INSTRUCTOR_PLACEHOLDERS.has(instr)) placeholder++;
  }
  return {
    rows: n,
    titleFill: title / n,
    keyFill: key / n,
    modeValid: mode / n,
    instructorPlaceholder: placeholder / n,
  };
}

/**
 * Compare a file's before/after metrics and return regression findings. Empty
 * `findings` ⇒ the change is acceptable.
 */
export function compareQuality(
  file: string,
  before: QualityMetrics,
  after: QualityMetrics
): QualityFinding[] {
  const findings: QualityFinding[] = [];
  // An empty AFTER file is handled by scrape-diff's 50% gate; don't double-flag.
  if (after.rows === 0) return findings;

  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

  if (before.rows === 0) {
    // New file — no baseline. Absolute floors catch brand-new garbage.
    if (after.titleFill < NEW_FILE_FLOOR.titleFill) {
      findings.push({ file, metric: "titleFill", before: before.titleFill, after: after.titleFill, reason: `new file titleFill ${pct(after.titleFill)} < ${pct(NEW_FILE_FLOOR.titleFill)} floor` });
    }
    if (after.keyFill < NEW_FILE_FLOOR.keyFill) {
      findings.push({ file, metric: "keyFill", before: before.keyFill, after: after.keyFill, reason: `new file keyFill ${pct(after.keyFill)} < ${pct(NEW_FILE_FLOOR.keyFill)} floor` });
    }
    if (after.modeValid < NEW_FILE_FLOOR.modeValid) {
      findings.push({ file, metric: "modeValid", before: before.modeValid, after: after.modeValid, reason: `new file modeValid ${pct(after.modeValid)} < ${pct(NEW_FILE_FLOOR.modeValid)} (import aborts a term >5% invalid mode)` });
    }
    return findings;
  }

  // Existing file — flag only a regression from a healthy baseline.
  for (const m of ["titleFill", "keyFill", "modeValid"] as const) {
    const b = before[m];
    const a = after[m];
    if (b >= HEALTHY[m] && a < b - DROP[m]) {
      findings.push({ file, metric: m, before: b, after: a, reason: `${m} regressed ${pct(b)}→${pct(a)} (>${(DROP[m] * 100).toFixed(0)}pt drop from a healthy baseline)` });
    }
  }
  // Instructor column collapse: nearly everything became a placeholder AND it
  // jumped sharply. Specific to a lost column, not normal early-registration STAFF.
  if (after.instructorPlaceholder > 0.8 && after.instructorPlaceholder - before.instructorPlaceholder > 0.5) {
    findings.push({ file, metric: "instructorPlaceholder", before: before.instructorPlaceholder, after: after.instructorPlaceholder, reason: `instructor placeholder surged ${pct(before.instructorPlaceholder)}→${pct(after.instructorPlaceholder)} (column likely lost)` });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Git plumbing (mirrors scrape-diff.ts) + CLI
// ---------------------------------------------------------------------------

function sh(cmd: string): string {
  return execSync(cmd, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function parseRows(text: string): SectionLike[] {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as SectionLike[]) : [];
  } catch {
    return [];
  }
}

function beforeRows(file: string): SectionLike[] {
  try {
    return parseRows(sh(`git show HEAD:${file}`));
  } catch {
    return []; // not on main ⇒ new file
  }
}

function afterRows(file: string): SectionLike[] {
  const abs = resolve(ROOT, file);
  if (!existsSync(abs)) return [];
  return parseRows(readFileSync(abs, "utf8"));
}

function main(): void {
  const args = process.argv.slice(2);
  const pathIdx = args.indexOf("--path");
  const fmtIdx = args.indexOf("--format");
  const pathPrefix = pathIdx >= 0 ? args[pathIdx + 1] : "data/";
  const format = (fmtIdx >= 0 ? args[fmtIdx + 1] : "json") as "json" | "markdown";

  const tracked = sh(`git ls-files ${pathPrefix}`).trim().split("\n");
  const untracked = sh(`git ls-files --others --exclude-standard ${pathPrefix}`).trim().split("\n");
  // Only course section files carry the fields we measure.
  const files = Array.from(new Set([...tracked, ...untracked]))
    .filter(Boolean)
    .filter((f) => /\/courses\/.*\.json$/.test(f));

  const findings: QualityFinding[] = [];
  let filesChecked = 0;
  for (const file of files) {
    const before = measure(beforeRows(file));
    const after = measure(afterRows(file));
    // Skip files with no actual content change in the measured dimensions —
    // identical before/after produces no findings anyway, but counting only
    // meaningfully-evaluated files keeps the summary honest.
    if (before.rows === 0 && after.rows === 0) continue;
    filesChecked++;
    findings.push(...compareQuality(file, before, after));
  }

  const degraded = findings.length > 0;
  const summary = degraded
    ? `CONTENT DEGRADED: ${findings.length} finding(s) across ${filesChecked} file(s) checked.`
    : `Content quality OK across ${filesChecked} file(s) checked.`;

  if (format === "markdown") {
    const lines = [`**${summary}**`, ""];
    if (degraded) {
      lines.push("| File | Metric | Before | After | Why |", "|---|---|---:|---:|---|");
      for (const f of findings) {
        lines.push(`| \`${f.file}\` | ${f.metric} | ${(f.before * 100).toFixed(0)}% | ${(f.after * 100).toFixed(0)}% | ${f.reason} |`);
      }
    }
    console.log(lines.join("\n"));
  } else {
    console.log(JSON.stringify({ degraded, filesChecked, findings, summary }, null, 2));
  }
}

if (process.argv[1]?.includes("content-quality-diff")) {
  main();
}

/**
 * Term-hardcoding guard (issue #115 phase 3).
 *
 * Scans per-state scraper files (`scripts/{state}/**\/*.ts`) for the kinds of
 * hardcoded term references that put the cron at risk of silent staleness:
 *
 *   - Numeric term-code thresholds  (e.g. `code >= 202620`, `parseInt(t.code) >= 202610`)
 *   - Hardcoded year thresholds     (e.g. `parseInt(yearMatch[1]) >= 2026`)
 *   - Literal term-code arrays      (e.g. `{ code: "1262", ... }` of CUNY/PeopleSoft term codes)
 *
 * Each of these is calendar-relative work the scraper should derive from
 * `currentCalendarTerm()` / `pickRecentSsbTerms()` in `scripts/lib/resolve-terms.ts`,
 * not bake into the source. When a hardcoded value drifts past its real-world
 * meaning the scraper fails silently — it returns the wrong term's data with
 * no error, no alert, no change in CI status.
 *
 * Background: the original three offenders (CUNY in scripts/ny, the SSB
 * thresholds in scripts/{ct,dc,ga}, the Banner 8 thresholds in
 * scripts/{de,ri}) were cleaned up in PRs #116, #117, and #118. This guard
 * exists so the next contributor can't reintroduce the pattern by accident.
 *
 * Opt-out: add a `// term-hardcode-allowed: <reason>` marker on the same
 * line for legitimate one-off uses (e.g. school-specific code mappings that
 * really are deployment-pinned). The reason is required and shows up in the
 * git blame so future readers know why the exemption exists.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const SCRIPTS_DIR = join(ROOT, "scripts");
const ALLOW_MARKER = "term-hardcode-allowed:";

// State directories under scripts/ — anything else (lib/, top-level scripts/*.ts)
// is out of scope. State scrapers are where the staleness risk lives.
function listStateScraperFiles(): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(SCRIPTS_DIR)) {
    const full = join(SCRIPTS_DIR, entry);
    if (!statSync(full).isDirectory()) continue;
    if (entry === "lib") continue;
    walk(full, out);
  }
  return out;
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (entry.endsWith(".ts")) out.push(full);
  }
}

interface Finding {
  file: string;
  line: number;
  text: string;
  kind: string;
}

// Banner term codes are 6 digits starting with `20` (e.g. 202620, 202712).
// CUNY/PeopleSoft codes are 4 digits starting with `1` (e.g. 1262, 1269).
// Year thresholds are 4 digits starting with `20` (e.g. 2026).
const PATTERNS: { regex: RegExp; kind: string }[] = [
  // `code >= 202610`, `parseInt(t.code) >= 202620`, etc.
  { regex: /\bcode\s*\)?\s*>=\s*20\d{4}\b/, kind: "banner-term-code threshold" },
  // `>= 2026` in a comparison (year threshold). Constrained to digit forms
  // that look like academic years to avoid matching unrelated numerics.
  { regex: />=\s*20[2-9]\d\b/, kind: "year threshold" },
  // Literal term-code values in object/property form: `code: "1262"`,
  // `code: "202610"`, `termCode: "2262"`. Catches hardcoded term arrays
  // like the old CUNY_TERMS.
  { regex: /\b(?:code|termCode|term)\s*:\s*["'](?:1\d{3}|20\d{4}|2\d{3})["']/, kind: "literal term code" },
];

function scan(file: string): Finding[] {
  const found: Finding[] = [];
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];

    // Strip line comments before pattern matching so we don't flag examples
    // in JSDoc / `//` comments — but keep the original for the allow marker
    // check, which sits after the code.
    const codePart = raw.replace(/\/\/.*$/, "");
    if (raw.includes(ALLOW_MARKER)) continue;
    // Block-comment lines: skip if the line looks comment-only.
    if (/^\s*\*/.test(raw) || /^\s*\/\*/.test(raw)) continue;

    for (const { regex, kind } of PATTERNS) {
      if (regex.test(codePart)) {
        found.push({ file, line: i + 1, text: raw.trim(), kind });
        break;
      }
    }
  }
  return found;
}

const files = listStateScraperFiles();
const findings: Finding[] = [];
for (const file of files) findings.push(...scan(file));

if (findings.length > 0) {
  console.error(
    `\nFound ${findings.length} hardcoded term reference(s) in state scrapers.\n`
  );
  console.error(
    `These risk silent staleness at term rollover — the scraper succeeds`
  );
  console.error(
    `but returns last term's data, with no alert. Use the helpers in`
  );
  console.error(`scripts/lib/resolve-terms.ts (currentCalendarTerm,`);
  console.error(`nextTerm, pickRecentSsbTerms) instead.\n`);
  console.error(
    `If a hardcoded value is genuinely required (e.g. a school's`
  );
  console.error(
    `deployment-pinned code mapping), add a same-line marker:`
  );
  console.error(`  // term-hardcode-allowed: <reason>\n`);

  for (const f of findings) {
    const rel = relative(ROOT, f.file);
    console.error(`  ${rel}:${f.line}  [${f.kind}]`);
    console.error(`    ${f.text}`);
  }
  console.error("");
  process.exit(1);
}

console.log(`OK — no hardcoded term references in ${files.length} scraper files.`);

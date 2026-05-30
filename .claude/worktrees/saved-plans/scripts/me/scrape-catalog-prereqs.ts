/**
 * scrape-catalog-prereqs.ts
 *
 * Extracts prerequisite text from Maine Community College System (MCCS)
 * catalogs. All 7 MCCS colleges publish catalogs exclusively as PDFs —
 * there are no Acalog or CourseLeaf instances.
 *
 * Strategy: download each college's PDF catalog, run `pdftotext` (flow
 * mode) to get plain text, then parse course entries and extract
 * Prerequisite lines.
 *
 * Two main formats:
 *   SMCC/YCCC (own-line): "Prerequisite(s): ACCT-105, MATH-040"
 *   CMCC/EMCC/NMCC/KVCC (inline): "...description text. Prerequisite: ACC 120"
 *
 * Course codes vary by college:
 *   SMCC uses hyphens (ACCT-105), others use spaces (ACC 120/ACC120)
 *
 * Output: data/me/prereqs.json keyed by "${PREFIX} ${NUMBER}" with
 * normalized codes (hyphens → spaces).
 *
 * Usage:
 *   npx tsx scripts/me/scrape-catalog-prereqs.ts
 *   npx tsx scripts/me/scrape-catalog-prereqs.ts --college=smcc
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

interface CollegeCatalog {
  name: string;
  url: string;
  format: "own-line" | "inline";
}

const CATALOGS: Record<string, CollegeCatalog> = {
  smcc: {
    name: "Southern Maine CC",
    url: "https://www.smccme.edu/wp-content/uploads/2025/10/SMCC-Catalog-2025-2026.pdf",
    format: "own-line",
  },
  yccc: {
    name: "York County CC",
    url: "https://yccc.b-cdn.net/app/uploads/2025/12/YCCC-CourseCatalog_2025-26_12192025.pdf",
    format: "own-line",
  },
  cmcc: {
    name: "Central Maine CC",
    url: "https://www.cmcc.edu/wp-content/uploads/2023/05/FINAL-2026-2027-Academic-Catalog_041026-1.pdf",
    format: "inline",
  },
  emcc: {
    name: "Eastern Maine CC",
    url: "https://www.emcc.edu/wp-content/uploads/2026/01/2025-26-Catalog-20260106-Addendum-compressed.pdf",
    format: "inline",
  },
  kvcc: {
    name: "Kennebec Valley CC",
    url: "https://www.kvcc.me.edu/wp-content/uploads/2026/02/KVCC-2025-2026-CourseCatalog-v6.pdf",
    format: "inline",
  },
  nmcc: {
    name: "Northern Maine CC",
    url: "https://www.nmcc.edu/wp-content/uploads/CURRENT2024-2026-Course-Catalog-.pdf",
    format: "inline",
  },
};

// WCCC omitted — research found only ~5 prereq mentions with non-standard format

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PrereqEntry {
  text: string;
  courses: string[];
}

// ---------------------------------------------------------------------------
// PDF download + text extraction
// ---------------------------------------------------------------------------

async function downloadPdf(url: string, dest: string): Promise<void> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

function pdfToText(pdfPath: string): string {
  const txtPath = pdfPath.replace(/\.pdf$/, ".txt");
  execSync(`pdftotext "${pdfPath}" "${txtPath}"`, { timeout: 60000 });
  return fs.readFileSync(txtPath, "utf-8");
}

// ---------------------------------------------------------------------------
// Course code normalization
// ---------------------------------------------------------------------------

function normalizeCode(raw: string): string {
  // "ACCT-105" → "ACCT 105", "ACC120" → "ACC 120", "ACC 120" → "ACC 120"
  return raw
    .replace(/-/g, " ")
    .replace(/([A-Z]{2,5})\s*(\d{3,4}[A-Z]?)/, "$1 $2")
    .trim();
}

function extractCourseRefs(text: string): string[] {
  const codes = new Set<string>();
  // Match "PREFIX-NNN", "PREFIX NNN", "PREFIXNNN"
  const re = /\b([A-Z]{2,5})[-\s]?(\d{3,4}[A-Z]?)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const code = `${m[1]} ${m[2]}`;
    if (
      !code.startsWith("GPA ") &&
      !code.startsWith("SAT ")
    ) {
      codes.add(code);
    }
  }
  return Array.from(codes).sort();
}

// ---------------------------------------------------------------------------
// Own-line format parser (SMCC, YCCC)
//
// Course entries look like:
//   SUBJ NNN Title (or SUBJ NNN – Title)
//   N cr. (or N credits/N contact hours)
//   ...description...
//   Prerequisite(s): ...
//   Corequisite(s): ... (optional)
// ---------------------------------------------------------------------------

function parseOwnLineFormat(text: string): Map<string, PrereqEntry> {
  const results = new Map<string, PrereqEntry>();
  const lines = text.split("\n");

  // Find the course descriptions section
  let startIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^COURSE DESCRIPTIONS$/i.test(lines[i].trim())) {
      startIdx = i + 1;
      break;
    }
  }

  // Course header: "ACCT 105 Financial Accounting" or "ACC 111 – Accounting I"
  const headerRe = /^([A-Z]{2,5})\s+(\d{3}[A-Z]?)\s+[–\-]?\s*[A-Z]/;
  // Prereq line
  const prereqRe = /^Prerequisite\(s\):\s*(.*)/i;

  let currentCode: string | null = null;
  let prereqText = "";
  let collectingPrereq = false;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Page number lines (just a number alone)
    if (/^\d{1,3}$/.test(line)) continue;

    const headerMatch = line.match(headerRe);
    if (headerMatch) {
      // Save any collected prereq for the previous course
      if (currentCode && prereqText) {
        const cleaned = cleanPrereqText(prereqText, currentCode);
        if (cleaned) results.set(currentCode, cleaned);
      }
      currentCode = `${headerMatch[1]} ${headerMatch[2]}`;
      prereqText = "";
      collectingPrereq = false;
      continue;
    }

    const prereqMatch = line.match(prereqRe);
    if (prereqMatch && currentCode) {
      prereqText = prereqMatch[1];
      collectingPrereq = true;
      continue;
    }

    // If we're collecting a multiline prereq, check if the next line continues it
    if (collectingPrereq && currentCode) {
      if (/^(Corequisite|Core fulfilled|$)/i.test(line) || headerRe.test(line)) {
        collectingPrereq = false;
      } else if (/^[a-z]/.test(line) || /^(placement|permission|and |or )/i.test(line)) {
        prereqText += " " + line;
      } else {
        collectingPrereq = false;
      }
    }
  }

  // Don't forget the last course
  if (currentCode && prereqText) {
    const cleaned = cleanPrereqText(prereqText, currentCode);
    if (cleaned) results.set(currentCode, cleaned);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Inline format parser (CMCC, EMCC, NMCC, KVCC)
//
// Prereqs appear inline in description paragraphs:
//   "...description text. Prerequisite: ACC 120 with a grade of C or higher."
// ---------------------------------------------------------------------------

function parseInlineFormat(text: string): Map<string, PrereqEntry> {
  const results = new Map<string, PrereqEntry>();
  const lines = text.split("\n");

  // Course header with credits pattern:
  // "ACC 120 Principles of Financial\nAccounting\n3 Credits (3 Lecture 0 Lab 0 Shop)"
  // or "ACC 122 Managerial Accounting\n3 Credits"
  const headerRe = /^([A-Z]{2,5})\s+(\d{3}[A-Z]?)\s+[A-Z]/;
  const creditsRe = /^\d+\s+Credits?\b/i;

  let currentCode: string | null = null;
  let blockLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    const headerMatch = line.match(headerRe);
    if (headerMatch) {
      // Process the previous block
      if (currentCode && blockLines.length > 0) {
        const block = blockLines.join(" ");
        const entry = extractInlinePrereq(block, currentCode);
        if (entry) results.set(currentCode, entry);
      }
      currentCode = `${headerMatch[1]} ${headerMatch[2]}`;
      blockLines = [line];
      continue;
    }

    if (currentCode) {
      blockLines.push(line);
    }
  }

  // Last block
  if (currentCode && blockLines.length > 0) {
    const block = blockLines.join(" ");
    const entry = extractInlinePrereq(block, currentCode);
    if (entry) results.set(currentCode, entry);
  }

  return results;
}

function extractInlinePrereq(block: string, courseCode: string): PrereqEntry | null {
  // Match "Prerequisite:" or "Prerequisites:" followed by the prereq text
  const m = block.match(
    /Prerequisite(?:s|\(s\))?\s*:\s*(.*?)(?:\.|$)/i,
  );
  if (!m) return null;

  let text = m[1].trim();
  if (!text) return null;

  // Clean and check for boilerplate
  text = text.replace(/\s+/g, " ").trim();
  if (/^(none|n\/a|not applicable)\s*$/i.test(text)) return null;

  const refs = extractCourseRefs(text).filter(
    (c) => c !== courseCode,
  );

  return { text: normalizeCode(text), courses: refs };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function cleanPrereqText(raw: string, courseCode: string): PrereqEntry | null {
  let text = raw.replace(/\s+/g, " ").trim();
  // Remove trailing period
  text = text.replace(/[.;,]\s*$/, "").trim();

  if (!text) return null;
  if (/^(none|n\/a|not applicable|department permission)\s*$/i.test(text)) return null;

  // Normalize codes (ACCT-105 → ACCT 105)
  text = text.replace(/([A-Z]{2,5})-(\d{3,4}[A-Z]?)/g, "$1 $2");

  const refs = extractCourseRefs(text).filter(
    (c) => c !== courseCode,
  );

  return { text, courses: refs };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const collegeFilter = args.find((a) => a.startsWith("--college="))?.split("=")[1];

  console.log("Maine MCCS catalog prereq scraper (PDF-based)");

  const tmpDir = "/tmp/me-catalogs";
  fs.mkdirSync(tmpDir, { recursive: true });

  const slugs = collegeFilter ? [collegeFilter] : Object.keys(CATALOGS);

  const outDir = path.join(process.cwd(), "data", "me");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "prereqs.json");

  let merged: Record<string, PrereqEntry> = {};
  if (fs.existsSync(outPath) && !collegeFilter) {
    // Don't load existing when doing full run — start fresh
  } else if (fs.existsSync(outPath) && collegeFilter) {
    merged = JSON.parse(fs.readFileSync(outPath, "utf-8"));
    console.log(`  Loaded ${Object.keys(merged).length} existing prereqs`);
  }

  for (const slug of slugs) {
    const config = CATALOGS[slug];
    if (!config) {
      console.error(`Unknown college: ${slug}`);
      continue;
    }

    console.log(`\n--- ${config.name} (${slug}) ---`);
    const pdfPath = path.join(tmpDir, `${slug}-catalog.pdf`);

    try {
      // Download if not already cached
      if (!fs.existsSync(pdfPath)) {
        console.log(`  Downloading: ${config.url}`);
        await downloadPdf(config.url, pdfPath);
        console.log(`  Downloaded: ${(fs.statSync(pdfPath).size / 1024 / 1024).toFixed(1)} MB`);
      } else {
        console.log(`  Using cached PDF: ${pdfPath}`);
      }

      // Extract text
      console.log("  Extracting text with pdftotext...");
      const text = pdfToText(pdfPath);
      console.log(`  Extracted ${text.split("\n").length} lines`);

      // Parse
      let prereqs: Map<string, PrereqEntry>;
      if (config.format === "own-line") {
        prereqs = parseOwnLineFormat(text);
      } else {
        prereqs = parseInlineFormat(text);
      }

      let added = 0;
      for (const [key, entry] of prereqs) {
        if (!merged[key]) {
          merged[key] = entry;
          added++;
        }
      }
      console.log(`  ${prereqs.size} courses with prereqs (+${added} new)`);
    } catch (e) {
      console.error(`  ⚠ ${slug} failed: ${e}`);
    }
  }

  // Sort and write
  const sorted: Record<string, PrereqEntry> = {};
  for (const key of Object.keys(merged).sort()) {
    sorted[key] = merged[key];
  }

  // Safety net: refuse to clobber a non-empty existing prereqs.json with
  // an empty object. This catches the all-PDFs-failed mode (e.g. CI
  // missing pdftotext, or every WordPress catalog host returning 5xx
  // simultaneously) where the per-college try/catch silently swallows
  // every error and we'd otherwise overwrite hundreds of good entries
  // with `{}`. Per CLAUDE.md invariant — don't ship placeholder data.
  if (Object.keys(sorted).length === 0 && fs.existsSync(outPath)) {
    let existing: Record<string, PrereqEntry> = {};
    try {
      existing = JSON.parse(fs.readFileSync(outPath, "utf-8"));
    } catch {
      /* existing file is malformed — treat as empty */
    }
    if (Object.keys(existing).length > 0) {
      console.error(
        `\n✗ Refusing to overwrite ${Object.keys(existing).length}-entry ${outPath} with empty data.`,
      );
      console.error(
        `  Every college's PDF either failed to download or failed to parse — see ⚠ lines above.`,
      );
      console.error(
        `  Existing data left untouched. Investigate and re-run after fixing root cause.`,
      );
      process.exit(1);
    }
  }

  fs.writeFileSync(outPath, JSON.stringify(sorted, null, 2));
  console.log(`\n✓ Wrote ${Object.keys(sorted).length} prereqs to ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

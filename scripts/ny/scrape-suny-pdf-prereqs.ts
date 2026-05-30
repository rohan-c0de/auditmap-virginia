/**
 * NY/SUNY — PDF catalog → prereqs for FMCC, Schenectady, Sullivan
 *
 * Three SUNY CCs publish their catalog only as a PDF. Each has inline
 * prerequisite text in the course-descriptions section:
 *
 *   FMCC:        "Prerequisite: ACC 101." / "Prerequisites: CIS 105 and ACC 101."
 *   Sullivan:    "Prerequisite: ART 2610 Computer Graphics II"
 *   Schenectady: "PR or CR: ART 115, 122, 128, 133, 135, 211, and 226"
 *
 * Strategy: download PDF → pdftotext → regex-walk for course headings
 * followed by Prerequisite:/PR or CR: blocks → merge into prereqs.json.
 *
 * Requires: pdftotext (poppler) on PATH.  brew install poppler
 *
 * Usage:
 *   npx tsx scripts/ny/scrape-suny-pdf-prereqs.ts
 *   npx tsx scripts/ny/scrape-suny-pdf-prereqs.ts --college=fmcc
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFileSync } from "child_process";

const UA = "Mozilla/5.0 (compatible; CommunityCollegePathBot/1.0)";

interface CollegeConfig {
  slug: string;
  name: string;
  pdfUrl: string;
  courseHeadingRe: RegExp;
  prereqRe: RegExp;
}

const COLLEGES: CollegeConfig[] = [
  {
    slug: "fmcc",
    name: "Fulton-Montgomery CC",
    pdfUrl: "https://www.fmcc.edu/images/Downloads/SUNY%20FMCC%20Catalog.pdf",
    // "ACC 102 Managerial Accounting" — pdftotext puts the 4-0-4 on the next line
    courseHeadingRe: /^([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)\s+[A-Z][\w\s,&/'():;-]{3,}$/,
    // "Prerequisite: ACC 101." or "Prerequisites: CIS 105 and ACC 101."
    // Some prereqs appear mid-line: "...3 credits. Prerequisites: CIS 105..."
    prereqRe: /Prerequisites?\s*:\s*([A-Z][^.]*)/i,
  },
  {
    slug: "suny-sullivan",
    name: "SUNY Sullivan",
    pdfUrl: "https://sunysullivan.edu/wp-content/uploads/2025/10/REVISED-FINAL-SS-Catalog-10.14.2025.pdf.pdf",
    // "ART 1001 Drawing I" — Sullivan uses 4-digit course numbers
    courseHeadingRe: /^([A-Z]{2,5})\s+(\d{4}[A-Z]?)\s+[A-Z][\w\s,&/'()-]+/,
    prereqRe: /^Prerequisites?\s*:\s*(.+)/i,
  },
  {
    slug: "suny-schenectady",
    name: "SUNY Schenectady",
    pdfUrl: "https://www.sunysccc.edu/PDF/Publications/25-26_Catalog.pdf",
    // "ART 226    (3-0-3)" or "ACC 121    (4-0-4)"
    courseHeadingRe: /^([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)\s+\(\d+-\d+-\d+\)/,
    // "PR or CR: ART 115, 122, 128" — Schenectady uses "PR or CR:" and "PR:"
    prereqRe: /^(?:PR(?:\s+or\s+CR)?|Prerequisites?|Corequisites?)\s*:\s*(.+)/i,
  },
];

interface PrereqEntry { text: string; courses: string[]; }

const BOILERPLATE = /^(none|not applicable|n\/a|no prerequisites?)\s*\.?\s*$/i;

async function downloadPdf(url: string, dest: string): Promise<void> {
  console.log(`  Downloading ${url}...`);
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  console.log(`  Downloaded ${(buf.length / 1024 / 1024).toFixed(1)} MB`);
}

function pdfToText(pdfPath: string): string {
  return execFileSync("pdftotext", ["-layout", pdfPath, "-"], {
    maxBuffer: 50 * 1024 * 1024,
    encoding: "utf-8",
  });
}

function extractCourseRefs(text: string, currentPrefix: string): string[] {
  const codes = new Set<string>();
  // Full codes: "ACC 101", "ART 2610"
  const fullRe = /\b([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)\b/g;
  let m: RegExpExecArray | null;
  while ((m = fullRe.exec(text)) !== null) {
    codes.add(`${m[1]} ${m[2]}`);
  }
  // Bare numbers after comma in same-prefix lists: "ART 115, 122, 128"
  // Only applies when we have a prefix context
  if (currentPrefix) {
    const bareRe = /,\s*(\d{3,4}[A-Z]?)\b/g;
    while ((m = bareRe.exec(text)) !== null) {
      // Only add if no preceding alpha chars (to avoid matching credit numbers)
      const before = text.slice(Math.max(0, m.index - 5), m.index);
      if (!/[A-Z]{2,5}\s+\d/.test(before)) {
        codes.add(`${currentPrefix} ${m[1]}`);
      }
    }
  }
  return Array.from(codes);
}

function scrapeCollege(config: CollegeConfig, text: string): Map<string, PrereqEntry> {
  const lines = text.split("\n");
  const prereqs = new Map<string, PrereqEntry>();
  let currentCode: string | null = null;
  let currentPrefix = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Check for course heading
    const headingMatch = config.courseHeadingRe.exec(line);
    if (headingMatch) {
      currentCode = `${headingMatch[1]} ${headingMatch[2]}`;
      currentPrefix = headingMatch[1];
      continue;
    }

    // Check for prereq line
    if (currentCode) {
      const prereqMatch = config.prereqRe.exec(line);
      if (prereqMatch) {
        let prereqText = prereqMatch[1].trim();
        // Multi-line prereqs: concatenate following lines until blank or next course heading
        for (let j = i + 1; j < lines.length && j <= i + 3; j++) {
          const next = lines[j].trim();
          if (!next) break;
          if (config.courseHeadingRe.test(next)) break;
          if (config.prereqRe.test(next)) break;
          prereqText += " " + next;
        }
        prereqText = prereqText.replace(/\.\s*$/, "").trim();
        if (!prereqText || BOILERPLATE.test(prereqText)) {
          currentCode = null;
          continue;
        }

        const refs = extractCourseRefs(prereqText, currentPrefix);
        const filteredRefs = refs.filter((r) => r !== currentCode);
        prereqs.set(currentCode, {
          text: prereqText,
          courses: filteredRefs.sort(),
        });
        currentCode = null;
      }
    }
  }
  return prereqs;
}

async function main() {
  const args = process.argv.slice(2);
  const collegeFilter = args.find((a) => a.startsWith("--college="))?.split("=")[1];

  console.log("NY/SUNY PDF catalog prereq scraper\n");

  const outDir = path.join(process.cwd(), "data", "ny");
  const outPath = path.join(outDir, "prereqs.json");
  let merged: Record<string, PrereqEntry> = {};
  if (fs.existsSync(outPath)) {
    merged = JSON.parse(fs.readFileSync(outPath, "utf-8"));
    console.log(`Loaded ${Object.keys(merged).length} existing prereqs\n`);
  }

  const colleges = collegeFilter
    ? COLLEGES.filter((c) => c.slug === collegeFilter)
    : COLLEGES;

  for (const config of colleges) {
    console.log(`\n--- ${config.name} (${config.slug}) ---`);
    const tmpPdf = path.join(os.tmpdir(), `ny-${config.slug}.pdf`);
    try {
      if (!fs.existsSync(tmpPdf)) {
        await downloadPdf(config.pdfUrl, tmpPdf);
      } else {
        console.log(`  Using cached PDF: ${tmpPdf}`);
      }
      console.log(`  Converting to text...`);
      const text = pdfToText(tmpPdf);
      console.log(`  ${text.split("\n").length} lines`);

      const prereqs = scrapeCollege(config, text);
      let added = 0;
      for (const [key, entry] of prereqs) {
        if (!merged[key]) {
          merged[key] = entry;
          added++;
        }
      }
      console.log(`  ${prereqs.size} courses with prereqs, +${added} new`);
    } catch (e) {
      console.error(`  ERROR: ${(e as Error).message}`);
    }
  }

  const sorted: Record<string, PrereqEntry> = {};
  for (const k of Object.keys(merged).sort()) sorted[k] = merged[k];
  fs.writeFileSync(outPath, JSON.stringify(sorted, null, 2));
  console.log(`\n✓ Wrote ${Object.keys(sorted).length} total prereqs to ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

/**
 * scrape-transfer-gerta.ts — North Dakota gen-ed transfer equivalencies.
 *
 * NDUS does not publish a unified per-course articulation API. The
 * authoritative source for community-college → 4-year transfers is the
 * "General Education Requirement Transfer Agreement" (GERTA), an annual
 * PDF guide that lists every NDUS-approved general-education course at
 * each institution.
 *
 * Because GERTA + Common Course Numbering guarantee that a GEC course at
 * any sending NDUS institution satisfies the same gen-ed requirement
 * (and usually transfers under the same code) at every receiving NDUS
 * institution, we synthesize transfer records by:
 *
 *   1. Fetching the latest GERTA PDF from s3.cdn.ndus.edu
 *   2. Converting it to text with `pdftotext -layout`
 *   3. Extracting the per-college "general education courses" tables
 *   4. For each (sending CC × course × receiving 4-yr) tuple, emitting a
 *      1:1 articulation record (course code stays the same since NDUS
 *      enforces CCN across the system)
 *
 * Output: data/nd/transfer-equiv.json — same shape as other states.
 *
 * Coverage: ~80-100 GEC courses × 5 NDUS CCs × 6 NDUS 4-year universities
 * = ~2,000-3,000 articulation rows. This is the gen-ed "transferable as
 * itself" core; non-gen-ed major-specific equivalencies are out of scope
 * (would require TES scraping; deferred).
 *
 * Re-run annually when NDUS publishes a new GERTA guide.
 *
 * Usage:
 *   npx tsx scripts/nd/scrape-transfer-gerta.ts
 *   npx tsx scripts/nd/scrape-transfer-gerta.ts --pdf=/tmp/gerta.pdf  # use local copy
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import * as os from "os";
import * as https from "https";

const GERTA_URL = "https://s3.cdn.ndus.edu/ndus-web/media/gerta-guide-2025.pdf";

// ND community colleges → slug we use in data/nd/institutions.json
const CC_SENDERS: Array<{ ndusName: string; slug: string }> = [
  { ndusName: "Bismarck State College",                  slug: "bismarck-state-college" },
  // DCB's section header in the PDF uses "Dakota College-Bottineau" without
  // the "at" — register both spellings to be robust.
  { ndusName: "Dakota College-Bottineau",                slug: "dakota-college-at-bottineau" },
  { ndusName: "Dakota College at Bottineau",             slug: "dakota-college-at-bottineau" },
  { ndusName: "Lake Region State College",               slug: "lake-region-state-college" },
  { ndusName: "North Dakota State College of Science",   slug: "north-dakota-state-college-of-science" },
  { ndusName: "Williston State College",                 slug: "williston-state-college" },
];

// ND tribal colleges are also signatories (per GERTA appendix). Include if
// their sections are present in the PDF.
const CC_TRIBAL_SENDERS: Array<{ ndusName: string; slug: string }> = [
  { ndusName: "Cankdeska Cikana Community College",   slug: "cankdeska-cikana-community-college" },
  { ndusName: "Nueta Hidatsa Sahnish College",        slug: "nueta-hidatsa-sahnish-college" },
  { ndusName: "Sitting Bull College",                 slug: "sitting-bull-college" },
];

// Receiving 4-year universities in NDUS (all GERTA signatories).
// These slugs are what the UI uses to label receivers; they don't need
// matching institutions.json entries for transfer-equiv to render.
const RECEIVERS: Array<{ slug: string; name: string }> = [
  { slug: "dickinson-state-university",         name: "Dickinson State University" },
  { slug: "mayville-state-university",          name: "Mayville State University" },
  { slug: "minot-state-university",             name: "Minot State University" },
  { slug: "north-dakota-state-university",      name: "North Dakota State University" },
  { slug: "university-of-north-dakota",         name: "University of North Dakota" },
  { slug: "valley-city-state-university",       name: "Valley City State University" },
];

interface TransferRow {
  state: string;
  cc_prefix: string;
  cc_number: string;
  cc_course: string;
  cc_title: string;
  cc_credits: string;
  university: string;
  university_name: string;
  univ_course: string;
  univ_title: string;
  univ_credits: string;
  notes: string;
  no_credit: boolean;
  is_elective: boolean;
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

async function fetchPdf(url: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outPath);
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchPdf(res.headers.location, outPath).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on("finish", () => file.close(() => resolve()));
    }).on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

/**
 * Find each college's GEC section start line by matching the canonical
 * opening sentence "The following <Full College Name> courses have been
 * approved by the North Dakota University System". Returns a sorted list
 * of {college, startIdx} so we can later carve each section out by the
 * next section's start line (or EOF for the last college).
 */
function findCollegeSections(
  lines: string[],
  colleges: Array<{ ndusName: string; slug: string }>,
): Array<{ slug: string; ndusName: string; startIdx: number }> {
  const out: Array<{ slug: string; ndusName: string; startIdx: number }> = [];
  const seenSlugs = new Set<string>();
  for (const c of colleges) {
    const needle = `The following ${c.ndusName} courses have been approved`;
    const idx = lines.findIndex((l) => l.includes(needle));
    if (idx >= 0 && !seenSlugs.has(c.slug)) {
      out.push({ slug: c.slug, ndusName: c.ndusName, startIdx: idx });
      seenSlugs.add(c.slug);
    }
  }
  return out.sort((a, b) => a.startIdx - b.startIdx);
}

/**
 * Parse one course line from a GEC table.
 *
 * Format (pdftotext -layout preserves columns with variable spacing):
 *     PREFIX  NUMBER  Title  Credits
 * e.g.:
 *     ENGL          110               College Composition I                                   3
 *     HUMS          211               Integrated Cultural Excursion (HUM)                     1-4
 *
 * Returns null if the line doesn't match.
 */
function parseCourseLine(
  line: string,
): { prefix: string; number: string; title: string; credits: string } | null {
  // Strip leading whitespace; require: 2-5 letter prefix, then 3-4 digit
  // number (sometimes with letter suffix), then title text, then trailing
  // credits (digit, decimal, or range like "1-4").
  const m = line.match(
    /^\s*([A-Z]{2,5})\s+(\d{3}[A-Z]?)\s+(.+?)\s+(\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?)\s*$/,
  );
  if (!m) return null;
  return {
    prefix: m[1],
    number: m[2],
    title: m[3].trim(),
    credits: m[4],
  };
}

/**
 * Extract all GEC courses for one college from its section's lines.
 * Stops parsing at the next college's section start (or EOF).
 */
function extractGecCourses(
  lines: string[],
): Array<{ prefix: string; number: string; title: string; credits: string }> {
  const out: Array<{ prefix: string; number: string; title: string; credits: string }> = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const parsed = parseCourseLine(line);
    if (!parsed) continue;
    const key = `${parsed.prefix} ${parsed.number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(parsed);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const pdfArg = args.find((a) => a.startsWith("--pdf="))?.split("=")[1];

  const pdfPath = pdfArg || path.join(os.tmpdir(), "gerta.pdf");
  if (!pdfArg) {
    console.log(`Fetching ${GERTA_URL}...`);
    await fetchPdf(GERTA_URL, pdfPath);
    const stat = fs.statSync(pdfPath);
    console.log(`  ${stat.size} bytes → ${pdfPath}`);
  }

  const txtPath = pdfPath.replace(/\.pdf$/, ".txt");
  console.log(`Converting to text with pdftotext -layout...`);
  execSync(`pdftotext -layout "${pdfPath}" "${txtPath}"`);
  const lines = fs.readFileSync(txtPath, "utf-8").split("\n");
  console.log(`  ${lines.length} lines`);

  const allSenders = [...CC_SENDERS, ...CC_TRIBAL_SENDERS];
  const sections = findCollegeSections(lines, allSenders);
  console.log(`\nFound ${sections.length} CC sections:`);
  for (const s of sections) console.log(`  ${s.slug.padEnd(45)} line ${s.startIdx}`);

  // Carve each section by the next section's start (or EOF). Then also stop
  // at the first 4-year section so we don't pick up courses from non-CC
  // signatories. The 4-year sections aren't in our senders list so we
  // detect them by the same "The following ... courses have been approved"
  // sentinel with any other college name.
  const sentinelLine = /The following .+ courses have been approved by the North Dakota University/;
  function endOfSection(startIdx: number, nextIdx: number | null): number {
    const limit = nextIdx ?? lines.length;
    for (let i = startIdx + 1; i < limit; i++) {
      if (sentinelLine.test(lines[i])) return i;
    }
    return limit;
  }

  const rows: TransferRow[] = [];
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    const nextStart = i + 1 < sections.length ? sections[i + 1].startIdx : null;
    const end = endOfSection(sec.startIdx, nextStart);
    const slice = lines.slice(sec.startIdx, end);
    const courses = extractGecCourses(slice);
    console.log(`\n  ${sec.slug}: ${courses.length} GEC courses`);

    for (const c of courses) {
      for (const recv of RECEIVERS) {
        rows.push({
          state: "nd",
          cc_prefix: c.prefix,
          cc_number: c.number,
          cc_course: `${c.prefix} ${c.number}`,
          cc_title: c.title,
          cc_credits: c.credits,
          university: recv.slug,
          university_name: recv.name,
          univ_course: `${c.prefix} ${c.number}`,
          univ_title: c.title,
          univ_credits: c.credits,
          notes: `[${sec.slug}] GERTA gen-ed transfer`,
          no_credit: false,
          is_elective: false,
        });
      }
    }
  }

  const outPath = path.join(process.cwd(), "data", "nd", "transfer-equiv.json");
  fs.writeFileSync(outPath, JSON.stringify(rows, null, 2) + "\n");
  console.log(`\n✓ ${rows.length} articulation rows → ${outPath}`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});

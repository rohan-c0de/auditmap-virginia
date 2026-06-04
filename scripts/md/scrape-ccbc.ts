/**
 * scrape-ccbc.ts — bespoke scraper for CCBC's static "Programs and Courses Finder".
 *
 * Background: CCBC migrated off Banner 8 (the previous scrape-banner8.ts target,
 * simon.ccbcmd.edu/pls/PROD/bwck*, now 404s). The current public course finder is
 * a 6 MB static HTML page at https://www.ccbcmd.edu/Programs-and-Courses-Finder/
 * that embeds every course as a <li class="...{term} pc--card--course"
 * data-crns="..."> card, with one card per course and multiple CRNs per card.
 * Seat availability lives in a separate ccbcVolatileCourseData.json file keyed
 * by CRN — included here so a section's seat counts ride along when present.
 *
 * Usage:
 *   npx tsx scripts/md/scrape-ccbc.ts
 *   npx tsx scripts/md/scrape-ccbc.ts --term 2026FA   # default
 *   npx tsx scripts/md/scrape-ccbc.ts --term 2026SU
 *
 * Output: data/md/courses/ccbc/{term}.json — one record per (course × CRN).
 */
import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";
import { CourseSectionSchema } from "../../lib/schemas.js";
import type { CourseSection } from "../lib/scrape-jenzabar.js";

const INDEX_URL =
  "https://www.ccbcmd.edu/Programs-and-Courses-Finder/index.html";
const VOLATILE_URL =
  "https://cwcascadew1.ccbcmd.edu/bannerimport/ccbcVolatileCourseData.json";

// Class-name → standard term mapping. The card's class list carries one of
// "fall2026"/"spring2026"/"summer2026"/"continuingeducationsummer" plus
// format/campus hints. We only persist credit-track sections; "continuingeducation"
// cards are deliberately excluded (non-credit, different funding model).
const TERM_CLASS_MAP: Record<string, string> = {
  fall2026: "2026FA",
  spring2026: "2026SP",
  summer2026: "2026SU",
  fall2027: "2027FA",
  spring2027: "2027SP",
};

interface VolatileRecord {
  term: string;
  termCode: string;
  crn: string;
  tlm: string;
  seatsAvailable: string;
  recordRunTime: string;
}

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    },
  });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.text();
}

function pickTermFromClasses(classes: string[]): string | null {
  for (const c of classes) {
    if (TERM_CLASS_MAP[c]) return TERM_CLASS_MAP[c];
  }
  return null;
}

function pickModeFromClasses(classes: string[]): CourseSection["mode"] {
  const set = new Set(classes);
  if (set.has("blended")) return "hybrid";
  if (set.has("online") || set.has("onlinef")) return "online";
  if (set.has("inperson")) return "in-person";
  return "in-person";
}

function pickCampusFromClasses(classes: string[]): string {
  for (const c of ["catonsville", "dundalk", "essex", "owings", "online"]) {
    if (classes.includes(c)) return c.charAt(0).toUpperCase() + c.slice(1);
  }
  return "Main";
}

async function main() {
  const args = process.argv.slice(2);
  const termIdx = args.indexOf("--term");
  const targetTerm = termIdx >= 0 ? args[termIdx + 1] : "2026FA";
  console.log(`=== Scraping ccbc (CCBC course-finder SPA) — target term ${targetTerm} ===`);

  console.log(`  Fetching ${INDEX_URL}…`);
  const html = await fetchText(INDEX_URL);
  console.log(`  Fetched ${(html.length / 1024 / 1024).toFixed(2)} MB`);

  console.log(`  Fetching ${VOLATILE_URL}…`);
  const volatileByCrn: Map<string, VolatileRecord> = new Map();
  try {
    const vJson = JSON.parse(await fetchText(VOLATILE_URL));
    const rows: VolatileRecord[] = vJson.volatileCourseData2 || [];
    for (const r of rows) volatileByCrn.set(r.crn, r);
    console.log(`  Volatile records: ${rows.length}`);
  } catch (e) {
    console.warn(`  Volatile fetch failed (continuing without seats): ${e}`);
  }

  const $ = cheerio.load(html);
  const sections: CourseSection[] = [];
  let cardCount = 0;
  let termMismatch = 0;
  let noCrn = 0;
  let noCode = 0;

  // Selector matches BOTH the "pc--card--course" (course) and avoids the
  // plural "pc--card--courses" (the container). The class list also tells
  // us which term this section is for.
  $("li.pc--card--course").each((_, el) => {
    cardCount++;
    const $li = $(el);
    const classes = ($li.attr("class") || "").split(/\s+/);
    const term = pickTermFromClasses(classes);
    if (term !== targetTerm) {
      termMismatch++;
      return;
    }
    const codeRaw = $li.find(".program-card__coursecode").first().text().trim();
    const m = codeRaw.match(/^([A-Z]{2,5})\s*[- ]?\s*(\d{3,4}[A-Z]?)\s*$/);
    if (!m) {
      noCode++;
      return;
    }
    const prefix = m[1];
    const number = m[2];
    const title = $li.find(".program-card__title h3").first().text().trim();
    const crns = ($li.attr("data-crns") || "")
      .split(/[,\s]+/)
      .map((c) => c.trim())
      .filter((c) => /^\d{4,6}$/.test(c));
    if (crns.length === 0) {
      noCrn++;
      return;
    }
    const mode = pickModeFromClasses(classes);
    const campus = pickCampusFromClasses(classes);

    for (const crn of crns) {
      const vol = volatileByCrn.get(crn);
      const seatsAvailable = vol?.seatsAvailable;
      // -1 in the volatile feed means "unknown" — treat as null, not 0.
      const seatsOpen =
        seatsAvailable && seatsAvailable !== "-1" ? parseInt(seatsAvailable, 10) : null;
      sections.push({
        college_code: "ccbc",
        term: targetTerm,
        course_prefix: prefix,
        course_number: number,
        course_title: title || `${prefix} ${number}`, // schema requires non-empty
        credits: 3, // CCBC card carries cost-per-credit, not credit count
        crn,
        days: "",
        start_time: "",
        end_time: "",
        start_date: "",
        location: "",
        campus,
        mode,
        instructor: "To be Announced",
        seats_open: seatsOpen,
        seats_total: null,
        prerequisite_text: null,
        prerequisite_courses: [],
      });
    }
  });

  console.log(
    `  Cards scanned: ${cardCount}, term-match: ${cardCount - termMismatch}, no-code: ${noCode}, no-crn: ${noCrn}`,
  );
  console.log(`  Sections built: ${sections.length}`);

  // Self-check against the project zod schema before write. Anything that
  // fails here would also fail at import-on-merge.yml validation, so catching
  // it now keeps the diff clean.
  let invalid = 0;
  const validated: CourseSection[] = [];
  for (const s of sections) {
    const r = CourseSectionSchema.safeParse(s);
    if (r.success) validated.push(s);
    else invalid++;
  }
  const invalidRatio = sections.length ? invalid / sections.length : 0;
  console.log(
    `  Schema validation: ${validated.length} pass, ${invalid} fail (${(invalidRatio * 100).toFixed(1)}%)`,
  );
  // Same threshold the importer uses (supabase-import.ts:MAX_INVALID_RATIO=0.05).
  if (invalidRatio > 0.05) {
    console.error(
      `  ABORT: ${(invalidRatio * 100).toFixed(1)}% invalid > 5%. Fix the scraper before writing.`,
    );
    process.exit(1);
  }
  if (validated.length === 0) {
    console.error("No valid sections — aborting write.");
    process.exit(1);
  }

  const outDir = path.join(process.cwd(), "data", "md", "courses", "ccbc");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${targetTerm}.json`);
  fs.writeFileSync(outFile, JSON.stringify(validated, null, 2) + "\n");
  console.log(`  → ${validated.length} sections written to ${outFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

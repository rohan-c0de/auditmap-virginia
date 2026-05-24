/**
 * scrape-maricopa.ts — Maricopa Community Colleges District (10 colleges)
 *
 * All 10 Maricopa colleges publish their class schedule through one shared
 * public SPA at https://classes.sis.maricopa.edu/. The underlying PeopleSoft
 * SIS is SSO-only (no classsearchguest endpoint), but the SPA itself is
 * server-side rendered and exposes a stable search URL:
 *
 *   GET /?terms[]=<termCode>&institutions[]=<instCode>&credit_career=B&...
 *
 * The HTML response carries all class data inline — no pagination, no XHR
 * needed. We fetch one URL per (institution, term) pair, parse the `<div
 * class="course">` blocks (one per catalog course), and within each block
 * harvest every `<tr class="class-specs">` row as a section.
 *
 * Institution codes were discovered from the form on the home page:
 *   CGC08 Chandler-Gilbert · EMC10 Estrella Mountain · GWC03 GateWay
 *   GCC02 Glendale · MCC04 Mesa · PVC09 Paradise Valley · PCC01 Phoenix
 *   RSC06 Rio Salado · SCC05 Scottsdale · SMC07 South Mountain
 *
 * Term codes ARE NOT the standard PS `2YY{3,5,7}` pattern — Maricopa uses
 * its own internal IDs (4264 = Summer 2026, 4266 = Fall 2026 as of 2026-05).
 * Discovered at scrape-time from the home page so we don't hardcode codes
 * that expire each term.
 *
 * Usage:
 *   npx tsx scripts/az/scrape-maricopa.ts
 *   npx tsx scripts/az/scrape-maricopa.ts --college glendale-community-college
 *   npx tsx scripts/az/scrape-maricopa.ts --term "Fall 2026"
 *   npx tsx scripts/az/scrape-maricopa.ts --no-import
 */

import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";

const HOME_URL = "https://classes.sis.maricopa.edu/";
const SEARCH_BASE = "https://classes.sis.maricopa.edu/";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const DELAY_MS = 800; // be a polite citizen of their CDN

// Institution code → community-college-path slug. Codes from the form's
// `name="institutions[]"` checkboxes on https://classes.sis.maricopa.edu/.
const INSTITUTIONS: { code: string; slug: string; name: string }[] = [
  { code: "CGC08", slug: "chandler-gilbert-community-college", name: "Chandler-Gilbert" },
  { code: "EMC10", slug: "estrella-mountain-community-college", name: "Estrella Mountain" },
  { code: "GWC03", slug: "gateway-community-college", name: "GateWay" },
  { code: "GCC02", slug: "glendale-community-college", name: "Glendale" },
  { code: "MCC04", slug: "mesa-community-college", name: "Mesa" },
  { code: "PVC09", slug: "paradise-valley-community-college", name: "Paradise Valley" },
  { code: "PCC01", slug: "phoenix-college", name: "Phoenix" },
  { code: "RSC06", slug: "rio-salado-college", name: "Rio Salado" },
  { code: "SCC05", slug: "scottsdale-community-college", name: "Scottsdale" },
  { code: "SMC07", slug: "south-mountain-community-college", name: "South Mountain" },
];

interface MaricopaTerm {
  code: string;       // e.g. "4264"
  name: string;       // e.g. "Summer 2026"
  termCode: string;   // standardized — "2026SU"
}

interface CourseSection {
  college_code: string;
  term: string;
  course_prefix: string;
  course_number: string;
  course_title: string;
  credits: number;
  crn: string;
  days: string;
  start_time: string;
  end_time: string;
  start_date: string;
  location: string;
  campus: string;
  mode: "in-person" | "online" | "hybrid" | "zoom";
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function fetchHtml(url: string): Promise<string> {
  // Maricopa's CDN serves the unbounded (no-subject-filter) results in
  // 4-15s, with the rare slow response pushing 30s+. Be generous.
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return await res.text();
}

/** Pull the live term list from the home page so we don't ship stale codes. */
async function discoverTerms(): Promise<MaricopaTerm[]> {
  const html = await fetchHtml(HOME_URL);
  const $ = cheerio.load(html);
  const terms: MaricopaTerm[] = [];
  $('input[name="terms[]"]').each((_i, el) => {
    const code = $(el).attr("value") || "";
    const labelEl = $(el).parent().find(`label[for="${$(el).attr("id")}"]`);
    const name = labelEl.text().trim();
    if (!code || !name) return;
    terms.push({ code, name, termCode: standardizeTermName(name) });
  });
  return terms;
}

/** "Summer 2026" → "2026SU", "Fall 2026" → "2026FA", "Spring 2027" → "2027SP". */
function standardizeTermName(name: string): string {
  const m = name.match(/^(Spring|Summer|Fall|Winter)\s+(\d{4})$/i);
  if (!m) return name.replace(/\s+/g, "");
  const season =
    { spring: "SP", summer: "SU", fall: "FA", winter: "WI" }[
      m[1].toLowerCase()
    ] || "XX";
  return `${m[2]}${season}`;
}

/** Parse "ACC111" or "ACC 111" or "ENG101AA" → {prefix, number}. */
function parseCourseCode(raw: string): { prefix: string; number: string } | null {
  const m = raw.trim().match(/^([A-Z]{2,4})\s*(\d{3}[A-Z]{0,3})$/);
  if (!m) return null;
  return { prefix: m[1], number: m[2] };
}

/** "5/26 – 6/25\nSummer 2026" → "2026-05-26". Defaults month to current year if missing. */
function parseStartDate(raw: string, fallbackYear: number): string {
  const cleaned = raw.replace(/&ndash;/g, "–").replace(/\s+/g, " ").trim();
  const m = cleaned.match(/^(\d{1,2})\/(\d{1,2})/);
  if (!m) return "";
  const mo = m[1].padStart(2, "0");
  const da = m[2].padStart(2, "0");
  return `${fallbackYear}-${mo}-${da}`;
}

/** "9:10AM – 11:10AM" → {start: "09:10 am", end: "11:10 am"}. */
function parseTimes(raw: string): { start: string; end: string } {
  const cleaned = raw.replace(/&ndash;/g, "–").replace(/\s+/g, " ").trim();
  const m = cleaned.match(
    /^(\d{1,2}):(\d{2})\s*(AM|PM)\s*–\s*(\d{1,2}):(\d{2})\s*(AM|PM)$/i
  );
  if (!m) return { start: "", end: "" };
  return {
    start: `${m[1].padStart(2, "0")}:${m[2]} ${m[3].toLowerCase()}`,
    end: `${m[4].padStart(2, "0")}:${m[5]} ${m[6].toLowerCase()}`,
  };
}

/** "M,Tu,W,Th" → "M Tu W Th" (matches the convention used elsewhere). */
function normalizeDays(raw: string): string {
  const cleaned = raw.replace(/\s+/g, "").trim();
  if (!cleaned) return "";
  return cleaned.split(",").join(" ");
}

function determineMode(delivery: string): CourseSection["mode"] {
  const d = delivery.toLowerCase();
  if (d.includes("online") || d.includes("internet")) return "online";
  if (d.includes("hybrid") || d.includes("hyflex")) return "hybrid";
  if (d.includes("live online") || d.includes("zoom") || d.includes("remote")) return "zoom";
  return "in-person";
}

/** Extract one institution-term's worth of sections. */
async function scrapeInstitutionTerm(
  inst: { code: string; slug: string; name: string },
  term: MaricopaTerm,
): Promise<CourseSection[]> {
  const url =
    `${SEARCH_BASE}?keywords=&all_classes=false` +
    `&terms%5B%5D=${term.code}` +
    `&institutions%5B%5D=${inst.code}` +
    `&subject_code=&credit_career=B&credits_min=gte0&credits_max=lte9` +
    `&start_hour=&end_hour=`;

  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const year = parseInt(term.termCode.substring(0, 4), 10);

  const sections: CourseSection[] = [];

  $("div.course").each((_i, courseEl) => {
    const h3 = $(courseEl).find("h3").first();
    const titleText = h3.clone().children("span").remove().end().text().trim();
    // "ACC111: Accounting Principles I"
    // Most titles look like "ACC111: Accounting Principles I". A few
    // outliers carry suffix words before the colon (e.g. "EXS270 Lab:
    // Exercise Science Internship") — accept those by stopping at the
    // first colon then re-parsing the leading token as a course code.
    const colonIdx = titleText.indexOf(":");
    if (colonIdx < 0) return;
    const codePart = titleText.slice(0, colonIdx).trim();
    const courseTitle = titleText.slice(colonIdx + 1).trim();
    // The code may be "ACC111", "ENG101AA", or "EXS270 Lab" — take the
    // first whitespace-separated token.
    const codeToken = codePart.split(/\s+/)[0];
    const parsed = parseCourseCode(codeToken);
    if (!parsed) return;

    const creditsRaw = h3.find("span.credits").text();
    const creditsMatch = creditsRaw.match(/(\d+(?:\.\d+)?)\s*credits?/i);
    const credits = creditsMatch ? parseFloat(creditsMatch[1]) : 0;

    const description = $(courseEl).find("> p").first().text().trim();
    let prereqText: string | null = null;
    const prereqMatch = description.match(/Prerequisites?:\s*([^.]+(?:\.[^.]+)*?\.)/i);
    if (prereqMatch && !/none\.?$/i.test(prereqMatch[1].trim())) {
      prereqText = prereqMatch[1].trim();
    }
    const prereqCourses = prereqText
      ? Array.from(new Set(
          (prereqText.match(/\b[A-Z]{2,4}\s*\d{3}[A-Z]{0,3}\b/g) || []).map((c) => c.replace(/\s+/g, ""))
        ))
      : [];

    $(courseEl).find("tr.class-specs").each((_j, rowEl) => {
      const classNumber = $(rowEl).find("td.class-number .class-cell").text().trim();
      const locationRaw = $(rowEl).find("td.class-location .class-cell").text().trim().replace(/\s+/g, " ");
      const delivery = $(rowEl).find("td.class-delivery .class-cell").text().trim();
      const datesRaw = $(rowEl).find("td.class-dates .class-cell").text().trim();
      const daysRaw = $(rowEl).find("td.class-days .class-cell").text().trim();
      const timesRaw = $(rowEl).find("td.class-times .class-cell").text().trim();
      const instructorRaw = $(rowEl).find("td.class-instructors .class-cell").text().trim().replace(/\s+/g, " ");

      if (!classNumber) return;

      const { start, end } = parseTimes(timesRaw);
      const startDate = parseStartDate(datesRaw, year);

      sections.push({
        college_code: inst.slug,
        term: term.termCode,
        course_prefix: parsed.prefix,
        course_number: parsed.number,
        course_title: courseTitle,
        credits,
        crn: classNumber,
        days: normalizeDays(daysRaw),
        start_time: start,
        end_time: end,
        start_date: startDate,
        location: locationRaw,
        campus: inst.name,
        mode: determineMode(delivery),
        instructor: instructorRaw && instructorRaw !== "TBD" && instructorRaw !== "Staff" ? instructorRaw : null,
        seats_open: null, // not exposed in the public results page
        seats_total: null,
        prerequisite_text: prereqText,
        prerequisite_courses: prereqCourses,
      });
    });
  });

  return sections;
}

async function main() {
  const args = process.argv.slice(2);
  const collegeIdx = args.indexOf("--college");
  const collegeFilter = collegeIdx >= 0 ? args[collegeIdx + 1] : undefined;
  const termIdx = args.indexOf("--term");
  const termFilter = termIdx >= 0 ? args[termIdx + 1] : undefined;
  const noImport = args.includes("--no-import");

  console.log("AZ Maricopa District scraper");
  console.log(`  Source: ${HOME_URL}`);

  const allTerms = await discoverTerms();
  console.log(`  Live terms: ${allTerms.map((t) => `${t.name} (${t.code} → ${t.termCode})`).join(", ")}`);

  const targets = collegeFilter
    ? INSTITUTIONS.filter((i) => i.slug === collegeFilter)
    : INSTITUTIONS;
  if (targets.length === 0) {
    console.error(`Unknown college: ${collegeFilter}. Known: ${INSTITUTIONS.map((i) => i.slug).join(", ")}`);
    process.exit(1);
  }
  const termTargets = termFilter
    ? allTerms.filter((t) => t.name === termFilter)
    : allTerms;
  if (termTargets.length === 0) {
    console.error(`No matching term. Known: ${allTerms.map((t) => t.name).join(", ")}`);
    process.exit(1);
  }

  let grandTotal = 0;
  for (const inst of targets) {
    for (const term of termTargets) {
      try {
        const sections = await scrapeInstitutionTerm(inst, term);
        if (sections.length === 0) {
          console.log(`  ${inst.slug} / ${term.name}: 0 sections`);
          await sleep(DELAY_MS);
          continue;
        }
        const outDir = path.join(process.cwd(), "data", "az", "courses", inst.slug);
        fs.mkdirSync(outDir, { recursive: true });
        const outPath = path.join(outDir, `${term.termCode}.json`);
        fs.writeFileSync(outPath, JSON.stringify(sections, null, 2));
        console.log(`  ${inst.slug} / ${term.name}: ${sections.length} sections → ${outPath}`);
        grandTotal += sections.length;
      } catch (e) {
        console.error(`  ${inst.slug} / ${term.name}: FAILED — ${e}`);
      }
      await sleep(DELAY_MS);
    }
  }

  console.log(`\nTotal: ${grandTotal} sections across ${targets.length} colleges × ${termTargets.length} terms`);

  if (!noImport && grandTotal > 0) {
    try {
      const { importCoursesToSupabase } = await import("../lib/supabase-import");
      await importCoursesToSupabase("az");
    } catch (e) {
      console.log(`Supabase import skipped: ${(e as Error).message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

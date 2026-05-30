/**
 * scrape-custom.ts
 *
 * Scrapes course section data from Maryland community colleges that use
 * custom/proprietary registration systems (not Banner, Colleague, or Jenzabar).
 *
 * Covers:
 *   - AACC (Anne Arundel CC): TERMINALFOUR CMS with paginated HTML course search
 *   - Frederick CC: Angular SPA backed by JSON API at /webschedule
 *
 * Both are HTTP-only (no Playwright needed).
 *
 * Usage:
 *   npx tsx scripts/md/scrape-custom.ts --college aacc
 *   npx tsx scripts/md/scrape-custom.ts --college frederick
 *   npx tsx scripts/md/scrape-custom.ts --all
 *   npx tsx scripts/md/scrape-custom.ts --college frederick --term "Summer 2026"
 *   npx tsx scripts/md/scrape-custom.ts --no-import
 */

import fs from "fs";
import path from "path";
import * as cheerio from "cheerio";

type CourseMode = "in-person" | "online" | "hybrid" | "zoom";

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
  mode: CourseMode;
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function detectMode(text: string): CourseMode {
  const lower = text.toLowerCase();
  if (lower.includes("hybrid")) return "hybrid";
  if (
    lower.includes("online") ||
    lower.includes("virtual") ||
    lower.includes("distance")
  )
    return "online";
  if (lower.includes("zoom") || lower.includes("remote synchronous"))
    return "zoom";
  return "in-person";
}

function parseDayString(dayStr: string): string {
  const days: string[] = [];
  const clean = dayStr.toUpperCase().replace(/[/,\s]+/g, "");
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    const next = clean[i + 1];
    switch (ch) {
      case "M":
        days.push("M");
        break;
      case "T":
        if (next === "H" || next === "R") {
          days.push("Th");
          i++;
        } else if (next === "U") {
          days.push("Tu");
          i++;
        } else {
          days.push("Tu");
        }
        break;
      case "W":
        days.push("W");
        break;
      case "R":
        days.push("Th");
        break;
      case "F":
        days.push("F");
        break;
      case "S":
        if (next === "A") {
          days.push("Sa");
          i++;
        } else if (next === "U") {
          days.push("Su");
          i++;
        } else {
          days.push("Sa");
        }
        break;
    }
  }
  return days.join("");
}

function toStandardTerm(termDesc: string): string {
  const match = termDesc.match(/(spring|summer|fall|winter)\s*(\d{4})/i);
  if (!match) {
    // Try reversed: "2026 Fall"
    const rev = termDesc.match(/(\d{4})\s*(spring|summer|fall|winter)/i);
    if (!rev) return "";
    const year = rev[1];
    const season = rev[2].toLowerCase();
    if (season === "fall") return `${year}FA`;
    if (season === "spring") return `${year}SP`;
    if (season === "summer") return `${year}SU`;
    return `${year}SP`;
  }
  const season = match[1].toLowerCase();
  const year = match[2];
  if (season === "fall") return `${year}FA`;
  if (season === "spring") return `${year}SP`;
  if (season === "summer") return `${year}SU`;
  return `${year}SP`;
}

function extractPrereqCourses(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/[A-Z]{2,5}[\s-]\d{3,4}/g) || [];
  return [...new Set(matches.map((m) => m.replace("-", " ")))];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// AACC — Anne Arundel Community College
// TERMINALFOUR CMS with server-rendered paginated HTML course listings.
// URL: https://www.aacc.edu/course-search/?page=N
// ---------------------------------------------------------------------------

async function scrapeAACC(targetTerm: string): Promise<CourseSection[]> {
  const sections: CourseSection[] = [];
  const baseUrl = "https://www.aacc.edu/course-search/";
  const slug = "aacc";

  // First page to determine total pages
  console.log("  Fetching page 1 to determine total...");
  const firstPageHtml = await fetch(
    `${baseUrl}?isAvailable=Show+Available+Sections+Only&page=1`,
    { headers: HEADERS }
  ).then((r) => r.text());

  const $first = cheerio.load(firstPageHtml);

  // Extract total pages from pagination
  let totalPages = 1;
  const paginationLinks = $first("ul.cs-pagination a");
  paginationLinks.each((_, el) => {
    const href = $first(el).attr("href") || "";
    const pageMatch = href.match(/page=(\d+)/);
    if (pageMatch) {
      const p = parseInt(pageMatch[1]);
      if (p > totalPages) totalPages = p;
    }
  });

  // Extract total results count
  const resultsText = $first("p.results").text();
  const totalMatch = resultsText.match(/of\s+(\d+)/);
  const totalSections = totalMatch ? parseInt(totalMatch[1]) : 0;
  console.log(`  Found ${totalSections} sections across ${totalPages} pages`);

  // Determine which terms to target
  const targetStd = targetTerm ? toStandardTerm(targetTerm) : "";

  // Parse all pages
  for (let page = 1; page <= totalPages; page++) {
    if (page > 1) {
      await sleep(300); // Be polite
    }

    const url = `${baseUrl}?isAvailable=Show+Available+Sections+Only&page=${page}`;
    if (page % 10 === 0 || page === 1) {
      console.log(`  Fetching page ${page}/${totalPages}...`);
    }

    let html: string;
    try {
      const resp = await fetch(url, { headers: HEADERS });
      if (!resp.ok) {
        console.warn(`  Page ${page}: HTTP ${resp.status}`);
        continue;
      }
      html = await resp.text();
    } catch (e) {
      console.warn(`  Page ${page}: fetch error: ${(e as Error).message}`);
      continue;
    }

    const $ = cheerio.load(html);

    $("div.row.cs-section").each((_, el) => {
      const card = $(el);

      // Course code + title from the link
      const titleLink = card.find("a.result-title");
      const fullTitle = titleLink.text().trim();
      // Parse "ACA-100 Student Success Seminar" or "BIO-101L Biology Lab"
      const courseMatch = fullTitle.match(
        /^([A-Z]{2,5})-(\d{3,4}[A-Z]?)\s+(.+)$/
      );
      if (!courseMatch) return;

      const prefix = courseMatch[1];
      const number = courseMatch[2];
      const title = courseMatch[3].trim();

      // Parse fields from the card's paragraphs
      const getText = (label: string): string => {
        let val = "";
        card.find("p").each((_, p) => {
          const pText = $(p).text();
          if (pText.includes(label)) {
            val = pText.replace(new RegExp(`.*${label}:?\\s*`, "i"), "").trim();
          }
        });
        return val;
      };

      const termText = getText("Term");
      const termStd = toStandardTerm(termText);
      if (!termStd) return;

      // Filter to target term if specified
      if (targetStd && termStd !== targetStd) return;

      const creditText = getText("Course Type");
      const creditMatch = creditText.match(/(\d+)\s*Credit/i);
      const credits = creditMatch ? parseInt(creditMatch[1]) : 0;

      const section = getText("Section");
      const modeText = getText("Ways to take the class");
      const daysRaw = getText("Days");
      const timeText = getText("Time");
      const startDateRaw = getText("Start Date");
      const location = getText("Location");
      const instructor = getText("Instructor") || null;

      // Parse time "9:30AM to 10:15AM"
      let startTime = "";
      let endTime = "";
      const timeMatch = timeText.match(
        /(\d{1,2}:\d{2}\s*[AP]M)\s*to\s*(\d{1,2}:\d{2}\s*[AP]M)/i
      );
      if (timeMatch) {
        startTime = timeMatch[1].replace(/\s+/g, " ").trim();
        endTime = timeMatch[2].replace(/\s+/g, " ").trim();
      }

      // Parse start date "03/23/2026" → "2026-03-23"
      let startDate = "";
      const dateMatch = startDateRaw.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      if (dateMatch) {
        startDate = `${dateMatch[3]}-${dateMatch[1]}-${dateMatch[2]}`;
      }

      // CRN: AACC doesn't show CRN on listing; use section as identifier
      const crn = section;

      sections.push({
        college_code: slug,
        term: termStd,
        course_prefix: prefix,
        course_number: number,
        course_title: title,
        credits,
        crn,
        days: parseDayString(daysRaw),
        start_time: startTime,
        end_time: endTime,
        start_date: startDate,
        location: location || "",
        campus: location || "Arnold Campus",
        mode: detectMode(modeText || location || ""),
        instructor:
          instructor === "Varies" || instructor === "Varies (Subject to change)"
            ? null
            : instructor,
        seats_open: null,
        seats_total: null,
        prerequisite_text: null,
        prerequisite_courses: [],
      });
    });
  }

  console.log(`  Parsed ${sections.length} total sections from ${totalPages} pages`);
  return sections;
}

// ---------------------------------------------------------------------------
// Frederick CC
// Angular SPA backed by a JSON API at /webschedule.
// API returns all sections for a term in one response.
// Term list included in the default API response.
// ---------------------------------------------------------------------------

interface FrederickSection {
  termCode: string;
  subject: string;
  catalogNumber: string;
  classSection: string;
  classNbr: number;
  descr: string;
  title: string;
  days: string;
  mon: string;
  tues: string;
  wed: string;
  thurs: string;
  fri: string;
  sat: string;
  sun: string;
  startTime: string;
  endTime: string;
  startDate: string;
  endDate: string;
  enrolled: number;
  capacity: number;
  room: string;
  instructorName: string;
  credits: string;
  longDescription: string;
  preReqs: string;
  classNotes: Array<{ note: string }>;
  typeclass: string | null;
  sessionDescr: string;
}

interface FrederickTerm {
  termCode: string;
  termDescription: string;
  intTermCode: number;
}

interface FrederickResponse {
  init: boolean;
  term: string;
  total: number;
  display: FrederickSection[];
  termList: FrederickTerm[];
}

function frederickTermToStandard(termDesc: string): string {
  // Frederick terms: "2026 Spring", "2026 Summer", "2026 Fall"
  return toStandardTerm(termDesc);
}

function frederickBuildDays(s: FrederickSection): string {
  // Use the pre-built days string, or construct from individual flags
  if (s.days && s.days.trim()) return parseDayString(s.days);
  const d: string[] = [];
  if (s.mon === "Y") d.push("M");
  if (s.tues === "Y") d.push("Tu");
  if (s.wed === "Y") d.push("W");
  if (s.thurs === "Y") d.push("Th");
  if (s.fri === "Y") d.push("F");
  if (s.sat === "Y") d.push("Sa");
  if (s.sun === "Y") d.push("Su");
  return d.join("");
}

function frederickDetectMode(s: FrederickSection): CourseMode {
  const sectionLower = (s.classSection || "").toLowerCase();
  const notes = (s.classNotes || []).map((n) => n.note).join(" ").toLowerCase();
  const combined = `${sectionLower} ${s.typeclass || ""} ${notes}`;

  if (combined.includes("hybrid") || sectionLower.startsWith("hyb"))
    return "hybrid";
  if (
    combined.includes("online") ||
    sectionLower.startsWith("ol") ||
    sectionLower.startsWith("onl")
  )
    return "online";
  if (combined.includes("zoom") || combined.includes("remote synchronous"))
    return "zoom";
  if (combined.includes("structured remote") || sectionLower.startsWith("sr"))
    return "zoom";
  return "in-person";
}

async function scrapeFrederick(
  targetTerm: string
): Promise<CourseSection[]> {
  const apiUrl = "https://html-schedule.frederick.edu/webschedule";
  const slug = "frederick";

  // Fetch default response to get term list
  console.log("  Fetching term list from Frederick API...");
  const defaultResp = await fetch(apiUrl, {
    headers: {
      ...HEADERS,
      "X-Requested-With": "XMLHttpRequest",
      Accept: "application/json",
    },
  });

  if (!defaultResp.ok) {
    console.error(`  Frederick API returned ${defaultResp.status}`);
    return [];
  }

  const defaultData = (await defaultResp.json()) as FrederickResponse;
  const termList = defaultData.termList || [];

  console.log(
    `  Available terms: ${termList.map((t) => `${t.termDescription} (${t.termCode})`).join(", ")}`
  );

  // Filter to non-FEMA terms
  const mainTerms = termList.filter(
    (t) => !t.termDescription.includes("FEMA")
  );

  // Determine which terms to scrape
  let termsToScrape: FrederickTerm[];

  if (targetTerm) {
    const targetStd = toStandardTerm(targetTerm);
    const match = mainTerms.find(
      (t) => frederickTermToStandard(t.termDescription) === targetStd
    );
    if (!match) {
      console.error(
        `  Term "${targetTerm}" not found. Available: ${mainTerms.map((t) => t.termDescription).join(", ")}`
      );
      return [];
    }
    termsToScrape = [match];
  } else {
    // Default: scrape all non-FEMA terms
    termsToScrape = mainTerms;
  }

  const allSections: CourseSection[] = [];

  for (const term of termsToScrape) {
    const stdTerm = frederickTermToStandard(term.termDescription);
    if (!stdTerm) {
      console.warn(`  Skipping unrecognized term: ${term.termDescription}`);
      continue;
    }

    console.log(
      `  Fetching ${term.termDescription} (${term.termCode}) → ${stdTerm}...`
    );

    const resp = await fetch(`${apiUrl}?term=${term.termCode}`, {
      headers: {
        ...HEADERS,
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json",
      },
    });

    if (!resp.ok) {
      console.error(`  Term ${term.termCode}: HTTP ${resp.status}`);
      continue;
    }

    const data = (await resp.json()) as FrederickResponse;
    const sections = data.display || [];
    console.log(`  ${term.termDescription}: ${sections.length} sections`);

    for (const s of sections) {
      const seatsOpen =
        s.capacity > 0 ? Math.max(0, s.capacity - s.enrolled) : null;

      allSections.push({
        college_code: slug,
        term: stdTerm,
        course_prefix: s.subject || "",
        course_number: s.catalogNumber || "",
        course_title: s.title || s.descr || "",
        credits: isNaN(parseFloat(s.credits)) ? 0 : parseFloat(s.credits),
        crn: String(s.classNbr),
        days: frederickBuildDays(s),
        start_time: s.startTime || "",
        end_time: s.endTime || "",
        start_date: s.startDate || "",
        location: s.room || "",
        campus: "Frederick Community College",
        mode: frederickDetectMode(s),
        instructor: s.instructorName
          ? s.instructorName.replace(/,/g, ", ").trim()
          : null,
        seats_open: seatsOpen,
        seats_total: s.capacity > 0 ? s.capacity : null,
        prerequisite_text: s.preReqs || null,
        prerequisite_courses: extractPrereqCourses(s.preReqs || ""),
      });
    }

    await sleep(500); // Brief pause between term requests
  }

  return allSections;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

type ScrapeFn = (term: string) => Promise<CourseSection[]>;

const CUSTOM_COLLEGES: Record<string, ScrapeFn> = {
  aacc: scrapeAACC,
  frederick: scrapeFrederick,
};

async function main() {
  const args = process.argv.slice(2);
  const collegeFlag = args.indexOf("--college");
  const allFlag = args.includes("--all");
  const termIdx = args.indexOf("--term");
  const targetTerm = termIdx >= 0 ? args[termIdx + 1] : "";

  let targets: string[];

  if (allFlag) {
    targets = Object.keys(CUSTOM_COLLEGES);
  } else if (collegeFlag >= 0) {
    const slug = args[collegeFlag + 1];
    if (!CUSTOM_COLLEGES[slug]) {
      console.error(`Unknown college: ${slug}`);
      console.error(
        `Available: ${Object.keys(CUSTOM_COLLEGES).join(", ")}`
      );
      process.exit(1);
    }
    targets = [slug];
  } else {
    targets = Object.keys(CUSTOM_COLLEGES);
  }

  let grandTotal = 0;

  for (const slug of targets) {
    console.log(`\n=== Scraping ${slug} (Custom HTTP) ===`);

    try {
      const scrapeFn = CUSTOM_COLLEGES[slug];
      const sections = await scrapeFn(targetTerm);

      // Group sections by term for per-term JSON files
      const byTerm = new Map<string, CourseSection[]>();
      for (const s of sections) {
        const arr = byTerm.get(s.term) || [];
        arr.push(s);
        byTerm.set(s.term, arr);
      }

      for (const [term, termSections] of byTerm) {
        const outDir = path.join(
          process.cwd(),
          "data",
          "md",
          "courses",
          slug
        );
        fs.mkdirSync(outDir, { recursive: true });
        const outFile = path.join(outDir, `${term}.json`);
        fs.writeFileSync(outFile, JSON.stringify(termSections, null, 2));
        console.log(
          `  → ${termSections.length} sections written to ${slug}/${term}.json`
        );
      }

      grandTotal += sections.length;
    } catch (e) {
      console.error(`  Error scraping ${slug}: ${(e as Error).message}`);
    }
  }

  // Auto-import into Supabase
  if (!args.includes("--no-import") && grandTotal > 0) {
    const { importCoursesToSupabase } = await import(
      "../lib/supabase-import"
    );
    await importCoursesToSupabase("md");
  }

  console.log(`\nDone. ${grandTotal} total sections scraped.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

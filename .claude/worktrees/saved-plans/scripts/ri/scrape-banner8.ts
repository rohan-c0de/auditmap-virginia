/**
 * scrape-banner8.ts
 *
 * Scrapes course section data from the Community College of Rhode Island (CCRI)
 * which uses Ellucian Banner 8 (legacy HTML form-based system).
 * Uses direct HTTP POST (no browser needed).
 *
 * Usage:
 *   npx tsx scripts/ri/scrape-banner8.ts
 *   npx tsx scripts/ri/scrape-banner8.ts --term "Fall 2026"
 *   npx tsx scripts/ri/scrape-banner8.ts --term 202610
 */

import * as fs from "fs";
import * as path from "path";
import { pickRecentSsbTerms } from "../lib/resolve-terms";

const BASE_URL = "https://bannerweb.ccri.edu/pls/DORA";
const SLUG = "ccri";
const STATE = "ri";

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

// CCRI term codes: YYYYSS format
// Spring 2026 = 202610, Summer 2026 = 202620, Fall 2026 = 202630
function termNameToCode(termName: string): string {
  const match = termName.match(/(spring|summer|fall)\s*(\d{4})/i);
  if (!match) return termName; // assume already a code
  const season = match[1].toLowerCase();
  const year = parseInt(match[2]);
  if (season === "spring") return `${year}10`;
  if (season === "summer") return `${year}20`;
  return `${year}30`; // fall
}

function codeToStandardTerm(code: string): string {
  const year = code.slice(0, 4);
  const suffix = code.slice(4, 6);
  if (suffix === "10") return `${year}SP`;
  if (suffix === "20") return `${year}SU`;
  return `${year}FA`; // 30
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Step 1: Discover available terms from the schedule search page
// ---------------------------------------------------------------------------

async function getAvailableTerms(): Promise<{ code: string; name: string }[]> {
  const resp = await fetch(`${BASE_URL}/bwckschd.p_disp_dyn_sched`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
  });
  const html = await resp.text();

  const terms: { code: string; name: string }[] = [];
  // Extract terms from <select name="p_term"> options
  const selectMatch = html.match(/<select[^>]*name="p_term"[^>]*>([\s\S]*?)<\/select>/i);
  if (!selectMatch) return terms;

  const optionRegex = /<option\s+value="(\d+)"[^>]*>([^<]+)/gi;
  let match;
  while ((match = optionRegex.exec(selectMatch[1])) !== null) {
    const code = match[1];
    const name = match[2].trim();
    // Only include credit terms (skip CWCE / non-credit)
    if (!name.toLowerCase().includes("cwce") && !name.toLowerCase().includes("non-credit")) {
      terms.push({ code, name });
    }
  }
  return terms;
}

// ---------------------------------------------------------------------------
// Step 2: Get subject list for a term
// ---------------------------------------------------------------------------

async function getSubjects(termCode: string): Promise<string[]> {
  const resp = await fetch(`${BASE_URL}/bwckgens.p_proc_term_date`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
    body: `p_calling_proc=bwckschd.p_disp_dyn_sched&p_term=${termCode}`,
  });
  const html = await resp.text();

  const subjects: string[] = [];
  const optionRegex = /<option\s+value="([A-Z]{2,4})"/gi;
  let match;
  while ((match = optionRegex.exec(html)) !== null) {
    if (match[1] !== "%" && match[1] !== "dummy") {
      subjects.push(match[1]);
    }
  }
  return [...new Set(subjects)];
}

// ---------------------------------------------------------------------------
// Step 3: Search for sections by subject
// ---------------------------------------------------------------------------

async function searchSubject(termCode: string, subject: string): Promise<string> {
  const params = new URLSearchParams();
  params.append("term_in", termCode);
  params.append("sel_subj", "dummy");
  params.append("sel_subj", subject);
  params.append("sel_day", "dummy");
  params.append("sel_schd", "dummy");
  params.append("sel_schd", "%");
  params.append("sel_insm", "dummy");
  params.append("sel_insm", "%");
  params.append("sel_camp", "dummy");
  params.append("sel_camp", "%");
  params.append("sel_levl", "dummy");
  params.append("sel_levl", "%");
  params.append("sel_sess", "dummy");
  params.append("sel_sess", "%");
  params.append("sel_instr", "dummy");
  params.append("sel_instr", "%");
  params.append("sel_ptrm", "dummy");
  params.append("sel_ptrm", "%");
  params.append("sel_attr", "dummy");
  params.append("sel_attr", "%");
  params.append("sel_crse", "");
  params.append("sel_title", "");
  params.append("sel_from_cred", "");
  params.append("sel_to_cred", "");
  params.append("begin_hh", "0");
  params.append("begin_mi", "0");
  params.append("begin_ap", "a");
  params.append("end_hh", "0");
  params.append("end_mi", "0");
  params.append("end_ap", "a");

  const resp = await fetch(`${BASE_URL}/bwckschd.p_get_crse_unsec`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
    body: params.toString(),
  });
  return resp.text();
}

// ---------------------------------------------------------------------------
// Step 4: Parse HTML into CourseSection objects
// ---------------------------------------------------------------------------

// CCRI uses a flat table layout ("Schedule of Classes" format) where each
// row is a section. Columns:
//   Select(0), CRN(1), Subj(2), Crse(3), Sec(4), Cmp(5), Cred(6),
//   Title(7), Days(8), Time(9), Cap(10), Act(11), Rem(12),
//   Instructor(13), Date(14), Location(15), Attribute(16)
//
// Days column uses <li class="active"> elements for active days (M,T,W,R,F,S,U)
// Title column uses <abbr title="description">ShortTitle</abbr>

function extractDays(daysCellHtml: string): string {
  // Days are encoded as <li class="active"><abbr title="Monday">M</abbr></li>
  const activeDays: string[] = [];
  const activeRegex = /class="active"[^>]*><abbr[^>]*>(\w)<\/abbr>/gi;
  let m;
  while ((m = activeRegex.exec(daysCellHtml)) !== null) {
    const letter = m[1];
    switch (letter) {
      case "M": activeDays.push("M"); break;
      case "T": activeDays.push("Tu"); break;
      case "W": activeDays.push("W"); break;
      case "R": activeDays.push("Th"); break;
      case "F": activeDays.push("F"); break;
      case "S": activeDays.push("Sa"); break;
      case "U": activeDays.push("Su"); break;
    }
  }
  return activeDays.join(" ");
}

function extractTitle(titleCellHtml: string): string {
  // Title is in <abbr title="long description">Short Title</abbr>
  const abbrMatch = titleCellHtml.match(/<abbr[^>]*>([^<]+)<\/abbr>/i);
  if (abbrMatch) return abbrMatch[1].trim();
  // Fallback: strip tags
  return titleCellHtml.replace(/<[^>]*>/g, "").trim();
}

function extractLocation(locationCellHtml: string): { campus: string; room: string } {
  // Location format: <ABBR ...><a ...>Liston Campus</a></ABBR> Room <a ...>2242</a>
  const campusMatch = locationCellHtml.match(/<a[^>]*>([^<]*Campus[^<]*)<\/a>/i);
  const roomMatch = locationCellHtml.match(/Room\s*<a[^>]*>([^<]+)<\/a>/i);
  const campus = campusMatch ? campusMatch[1].trim() : "";
  const room = roomMatch ? roomMatch[1].trim() : "";
  // For online sections
  if (!campus && locationCellHtml.toLowerCase().includes("online")) {
    return { campus: "Online", room: "" };
  }
  return { campus, room };
}

function extractCampusCode(cmpCellHtml: string): string {
  // Campus code in <abbr title="Knight Campus - Warwick">WK</abbr>
  const titleMatch = cmpCellHtml.match(/<abbr\s+title="([^"]+)"/i);
  return titleMatch ? titleMatch[1].trim() : cmpCellHtml.replace(/<[^>]*>/g, "").trim();
}

function parseSections(html: string, termCode: string): CourseSection[] {
  const sections: CourseSection[] = [];
  const standardTerm = codeToStandardTerm(termCode);

  // Find all data rows (class="dddefault-*")
  const rowRegex = /<tr\s+class="dddefault[^"]*">\s*([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const rowHtml = rowMatch[1];

    // Extract all cells (keep inner HTML for structured extraction)
    const cells: string[] = [];
    const cellRegex = /<td\s+CLASS="dddefault"[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      cells.push(cellMatch[1]);
    }

    // Need at least 15 cells: Select(0) CRN(1) Subj(2) Crse(3) Sec(4) Cmp(5) Cred(6)
    // Title(7) Days(8) Time(9) Cap(10) Act(11) Rem(12) Instructor(13) Date(14) Location(15)
    if (cells.length < 15) continue;

    // CRN - extract from link
    const crnMatch = cells[1].match(/>(\d+)<\/a>/);
    const crn = crnMatch ? crnMatch[1] : cells[1].replace(/<[^>]*>/g, "").trim();
    if (!crn || crn === "&nbsp;") continue;

    // Subject - extract from <abbr title="English">ENGL</abbr>
    const subjAbbrMatch = cells[2].match(/<abbr[^>]*>([^<]+)<\/abbr>/i);
    const prefix = subjAbbrMatch ? subjAbbrMatch[1].trim() : cells[2].replace(/<[^>]*>/g, "").trim();

    // Course number
    const courseNumber = cells[3].replace(/<[^>]*>/g, "").trim();

    // Campus code and name
    const campusName = extractCampusCode(cells[5]);

    // Credits
    const credText = cells[6].replace(/<[^>]*>/g, "").trim();
    const credits = parseFloat(credText) || 0;

    // Title
    const courseTitle = extractTitle(cells[7]);

    // Days
    const days = extractDays(cells[8]);

    // Time
    const timeRaw = cells[9].replace(/<[^>]*>/g, "").trim();
    let startTime = "";
    let endTime = "";
    if (timeRaw && timeRaw !== "TBA") {
      const timeParts = timeRaw.split("-");
      if (timeParts.length === 2) {
        startTime = timeParts[0].trim();
        endTime = timeParts[1].trim();
      }
    }

    // Seats
    const capText = cells[10].replace(/<[^>]*>/g, "").trim();
    const actText = cells[11].replace(/<[^>]*>/g, "").trim();
    const remText = cells[12].replace(/<[^>]*>/g, "").trim();
    const seatsTotal = parseInt(capText) || null;
    const seatsOpen = parseInt(remText) || null;

    // Instructor
    const instrRaw = cells[13].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    const instructor = instrRaw && instrRaw !== "TBA" ? instrRaw : null;

    // Date range (MM/DD format like "08/31-12/21")
    const dateRaw = cells[14].replace(/<[^>]*>/g, "").trim();
    let startDate = "";
    if (dateRaw) {
      const dateMatch = dateRaw.match(/(\d{2})\/(\d{2})/);
      if (dateMatch) {
        // Use the year from the term
        const year = termCode.slice(0, 4);
        startDate = `${year}-${dateMatch[1]}-${dateMatch[2]}`;
      }
    }

    // Location
    const locInfo = cells.length > 15 ? extractLocation(cells[15]) : { campus: "", room: "" };
    const location = locInfo.room ? `${locInfo.campus} ${locInfo.room}`.trim() : locInfo.campus;

    // Mode detection
    let mode: CourseMode = "in-person";
    const modeStr = (campusName + " " + location).toLowerCase();
    if (modeStr.includes("online") || modeStr.includes("distance") || modeStr.includes("internet")) {
      mode = "online";
    }
    if (modeStr.includes("hybrid")) mode = "hybrid";
    if (modeStr.includes("zoom") || modeStr.includes("virtual")) mode = "zoom";

    sections.push({
      college_code: SLUG,
      term: standardTerm,
      course_prefix: prefix,
      course_number: courseNumber,
      course_title: courseTitle,
      credits,
      crn,
      days,
      start_time: startTime,
      end_time: endTime,
      start_date: startDate,
      location,
      campus: locInfo.campus || campusName,
      mode,
      instructor,
      seats_open: seatsOpen,
      seats_total: seatsTotal,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const termIdx = args.indexOf("--term");
  const termInput = termIdx >= 0 ? args[termIdx + 1] : null;

  if (!termInput) {
    // Discover terms and scrape the most recent upcoming ones
    console.log("Discovering available terms...");
    const availableTerms = await getAvailableTerms();
    console.log(`  Found ${availableTerms.length} credit terms`);

    const recentTerms = pickRecentSsbTerms(availableTerms, {
      descriptionOf: (t) => t.name,
    });

    if (recentTerms.length === 0) {
      console.log("  No recent terms found. Available:", availableTerms.map((t) => `${t.name} (${t.code})`));
      return;
    }

    console.log("  Scraping terms:", recentTerms.map((t) => t.name).join(", "));

    let totalSections = 0;
    for (const term of recentTerms) {
      const count = await scrapeTerm(term.code);
      totalSections += count;
    }

    console.log(`\nDone! ${totalSections} total sections across ${recentTerms.length} terms.`);
  } else {
    const termCode = /^\d{6}$/.test(termInput) ? termInput : termNameToCode(termInput);
    await scrapeTerm(termCode);
  }

  // Auto-import into Supabase (skip with --no-import)
  if (!args.includes("--no-import")) {
    const { importCoursesToSupabase } = await import("../lib/supabase-import");
    await importCoursesToSupabase(STATE);
  }
}

async function scrapeTerm(termCode: string): Promise<number> {
  const standardTerm = codeToStandardTerm(termCode);
  console.log(`\nScraping CCRI (Banner 8) for ${termCode} → ${standardTerm}...`);

  // Get available subjects
  const subjects = await getSubjects(termCode);
  console.log(`  Found ${subjects.length} subjects`);

  const allSections: CourseSection[] = [];

  for (let i = 0; i < subjects.length; i++) {
    const subj = subjects[i];
    try {
      const html = await searchSubject(termCode, subj);
      const sections = parseSections(html, termCode);
      if (sections.length > 0) {
        process.stdout.write(`  [${i + 1}/${subjects.length}] ${subj}  ${sections.length} sections\n`);
      }
      allSections.push(...sections);
    } catch (err) {
      console.error(`  [${i + 1}/${subjects.length}] ${subj}  FAILED: ${err}`);
    }
    await sleep(300);
  }

  console.log(`  Total: ${allSections.length} sections for ${standardTerm}`);

  if (allSections.length > 0) {
    const outDir = path.join(process.cwd(), "data", STATE, "courses", SLUG);
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${standardTerm}.json`);
    fs.writeFileSync(outPath, JSON.stringify(allSections, null, 2) + "\n");
    console.log(`  Written to ${outPath}`);
  }

  return allSections.length;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

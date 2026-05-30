/**
 * scrape-banner8.ts
 *
 * Scrapes course section data from SC technical colleges that use
 * Ellucian Banner 8 (older HTML form-based system). Uses direct
 * HTTP POST (no browser needed).
 *
 * Currently: Horry-Georgetown Technical College
 *
 * Usage:
 *   npx tsx scripts/sc/scrape-banner8.ts
 *   npx tsx scripts/sc/scrape-banner8.ts --term 202530
 */

import * as fs from "fs";
import * as path from "path";

const BASE_URL = "https://ssb.hgtc.edu/PROD9";
const SLUG = "horry-georgetown";

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

// HGTC term codes: academic year based (off by 1 from calendar)
// Fall 2026 = 202610, Spring 2026 = 202520, Summer 2026 = 202530
function termNameToCode(termName: string): string {
  const match = termName.match(/(spring|summer|fall)\s*(\d{4})/i);
  if (!match) return termName; // assume already a code
  const season = match[1].toLowerCase();
  const year = parseInt(match[2]);
  if (season === "fall") return `${year}10`;
  if (season === "spring") return `${year - 1}20`;
  return `${year - 1}30`; // summer
}

function codeToStandardTerm(code: string): string {
  const prefix = code.slice(0, 4);
  const suffix = code.slice(4, 6);
  const year = parseInt(prefix);
  if (suffix === "10") return `${year}FA`;
  if (suffix === "20") return `${year + 1}SP`;
  return `${year + 1}SU`; // 30
}

async function getSubjects(termCode: string): Promise<string[]> {
  // POST to get the form page with subject list
  const resp = await fetch(`${BASE_URL}/bwckgens.p_proc_term_date`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
    body: `p_calling_proc=bwckschd.p_disp_dyn_sched&p_term=${termCode}`,
  });
  const html = await resp.text();

  // Extract subject codes from <option> tags in sel_subj select
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
  params.append("sel_sess", "dummy");
  params.append("sel_sess", "%");
  params.append("sel_instr", "dummy");
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

function parseSections(html: string, termCode: string): CourseSection[] {
  const sections: CourseSection[] = [];
  const standardTerm = codeToStandardTerm(termCode);

  // Split by section headers: <th class="ddtitle"><a ...>Title - CRN - SUBJ NUM - Section</a></th>
  const titleRegex = /<th\s+class="ddtitle"[^>]*>\s*<a[^>]*>([^<]+)<\/a>/gi;
  const detailRegex = /<td\s+class="dddefault"[^>]*>([\s\S]*?)(?=<th\s+class="ddtitle"|$)/gi;

  // Find all title + detail pairs
  const titles: { title: string; index: number }[] = [];
  let titleMatch;
  while ((titleMatch = titleRegex.exec(html)) !== null) {
    titles.push({ title: titleMatch[1].trim(), index: titleMatch.index });
  }

  for (let i = 0; i < titles.length; i++) {
    const { title } = titles[i];
    // Parse: "Course Title - CRN - SUBJ NUM - Section"
    const parts = title.split(" - ");
    if (parts.length < 4) continue;

    const courseTitle = parts[0].trim();
    const crn = parts[1].trim();
    const subjNum = parts[2].trim();
    const subjMatch = subjNum.match(/^([A-Z]{2,4})\s+(\d{3}[A-Z]?)$/);
    if (!subjMatch) continue;

    const [, prefix, number] = subjMatch;

    // Get the detail block between this title and the next
    const startIdx = titles[i].index;
    const endIdx = i + 1 < titles.length ? titles[i + 1].index : html.length;
    const detailBlock = html.slice(startIdx, endIdx);

    // Extract credits
    const credMatch = detailBlock.match(/([\d.]+)\s+Credits/);
    const credits = credMatch ? parseFloat(credMatch[1]) : 0;

    // Extract campus
    const campusMatch = detailBlock.match(/(?:Conway|Georgetown|Grand Strand|Online|Hybrid|Off Site)[^<]*/i);
    const campus = campusMatch ? campusMatch[0].trim() : "";

    // Extract instructional method
    const methodMatch = detailBlock.match(/(Online|Hybrid|Lecture|Lab|Lecture and Lab|Off Campus)[^<]*Instructional Method/i);
    const method = methodMatch ? methodMatch[1] : "";

    // Parse meeting times table
    const meetingRegex = /<td\s+class="dddefault"[^>]*>\s*([\s\S]*?)\s*<\/td>/gi;
    const meetingTableMatch = detailBlock.match(/<table[^>]*class="datadisplaytable"[^>]*>([\s\S]*?)<\/table>/i);

    let days = "";
    let startTime = "";
    let endTime = "";
    let startDate = "";
    let where = "";
    let instructor: string | null = null;

    if (meetingTableMatch) {
      const tableHtml = meetingTableMatch[1];
      // Find data rows (skip header)
      const rowRegex = /<tr>\s*((?:<td[^>]*>[\s\S]*?<\/td>\s*)+)<\/tr>/gi;
      let rowMatch;
      while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
        const cells: string[] = [];
        const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let cellMatch;
        while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
          cells.push(cellMatch[1].replace(/<[^>]*>/g, "").trim());
        }

        if (cells.length >= 7) {
          // Type(0), Time(1), Days(2), Where(3), DateRange(4), ScheduleType(5), Instructors(6)
          if (cells[1] && cells[1] !== "TBA") {
            const timeParts = cells[1].split(" - ");
            if (timeParts.length === 2) {
              startTime = timeParts[0].trim();
              endTime = timeParts[1].trim();
            }
          }

          if (cells[2] && cells[2] !== "TBA") {
            // Convert Banner day codes: M T W R F S → M Tu W Th F Sa
            days = cells[2]
              .replace(/R/g, "Th")
              .replace(/T(?!h)/g, "Tu")
              .replace(/S(?!a)/g, "Sa")
              .split("")
              .filter((c) => c !== " ")
              .join("");
            // Re-split properly
            days = cells[2]
              .split("")
              .map((d) => {
                switch (d) {
                  case "M": return "M";
                  case "T": return "Tu";
                  case "W": return "W";
                  case "R": return "Th";
                  case "F": return "F";
                  case "S": return "Sa";
                  case "U": return "Su";
                  default: return "";
                }
              })
              .filter(Boolean)
              .join(" ");
          }

          where = cells[3] || "";

          if (cells[4]) {
            const dateMatch = cells[4].match(/(\w+ \d+, \d{4})/);
            if (dateMatch) {
              const d = new Date(dateMatch[1]);
              if (!isNaN(d.getTime())) {
                startDate = d.toISOString().slice(0, 10);
              }
            }
          }

          if (cells[6]) {
            const instrName = cells[6].replace(/\(P\)/, "").replace(/\s+/g, " ").trim();
            if (instrName && instrName !== "TBA") {
              instructor = instrName;
            }
          }
        }
      }
    }

    // Detect mode
    let mode: CourseMode = "in-person";
    const modeStr = (method + " " + campus + " " + where).toLowerCase();
    if (modeStr.includes("online") || modeStr.includes("internet")) {
      if (modeStr.includes("hybrid")) mode = "hybrid";
      else mode = "online";
    } else if (modeStr.includes("hybrid")) {
      mode = "hybrid";
    } else if (modeStr.includes("synchronous online")) {
      mode = "zoom";
    }

    sections.push({
      college_code: SLUG,
      term: standardTerm,
      course_prefix: prefix,
      course_number: number,
      course_title: courseTitle,
      credits,
      crn,
      days,
      start_time: startTime,
      end_time: endTime,
      start_date: startDate,
      location: where,
      campus,
      mode,
      instructor,
      seats_open: null,
      seats_total: null,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  }

  return sections;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const args = process.argv.slice(2);
  const termIdx = args.indexOf("--term");
  const termInput = termIdx >= 0 ? args[termIdx + 1] : "Summer 2026";

  // Allow both "Summer 2026" and "202530" formats
  const termCode = /^\d{6}$/.test(termInput) ? termInput : termNameToCode(termInput);
  const standardTerm = codeToStandardTerm(termCode);

  console.log(`Scraping HGTC (Banner 8) for ${termInput} (code: ${termCode}, standard: ${standardTerm})...`);

  // Get available subjects
  const subjects = await getSubjects(termCode);
  console.log(`  Found ${subjects.length} subjects`);

  const allSections: CourseSection[] = [];

  for (let i = 0; i < subjects.length; i++) {
    const subj = subjects[i];
    const html = await searchSubject(termCode, subj);
    const sections = parseSections(html, termCode);
    if (sections.length > 0) {
      process.stdout.write(`  [${i + 1}/${subjects.length}] ${subj}  ${sections.length} sections\n`);
    }
    allSections.push(...sections);
    await sleep(200);
  }

  console.log(`\n  Total: ${allSections.length} sections`);

  if (allSections.length > 0) {
    const outDir = path.join(process.cwd(), "data", "sc", "courses", SLUG);
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${standardTerm}.json`);
    fs.writeFileSync(outPath, JSON.stringify(allSections, null, 2) + "\n");
    console.log(`  Written to ${outPath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

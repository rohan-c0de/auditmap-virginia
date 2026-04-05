/**
 * scrape-banner8.ts
 *
 * Scrapes course section data from Maryland community colleges that use
 * Ellucian Banner 8 (older HTML form-based system). Uses direct HTTP POST
 * (no browser needed). Adapted from the SC Banner 8 scraper.
 *
 * Covers: CCBC (Community College of Baltimore County)
 *
 * Usage:
 *   npx tsx scripts/md/scrape-banner8.ts
 *   npx tsx scripts/md/scrape-banner8.ts --term 202710
 */

import * as fs from "fs";
import * as path from "path";

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

// CCBC Banner 8 endpoint
const BANNER8_COLLEGES: Record<
  string,
  { baseUrl: string; prodPath: string }
> = {
  ccbc: {
    baseUrl: "https://simon.ccbcmd.edu",
    prodPath: "/pls/PROD",
  },
};

// CCBC term code patterns — common Banner 8 convention:
// Fall 2026 = 202710, Spring 2026 = 202620, Summer 2026 = 202630
function codeToStandardTerm(code: string): string {
  const prefix = code.slice(0, 4);
  const suffix = code.slice(4, 6);
  const year = parseInt(prefix);
  if (suffix === "10") return `${year - 1}FA`;
  if (suffix === "20") return `${year}SP`;
  if (suffix === "30") return `${year}SU`;
  return `${year}XX`;
}

function termNameToCode(termName: string): string {
  const match = termName.match(/(spring|summer|fall)\s*(\d{4})/i);
  if (!match) return termName;
  const season = match[1].toLowerCase();
  const year = parseInt(match[2]);
  if (season === "fall") return `${year + 1}10`;
  if (season === "spring") return `${year}20`;
  return `${year}30`;
}

const HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
};

async function getAvailableTerms(
  baseUrl: string,
  prodPath: string
): Promise<{ code: string; description: string }[]> {
  const resp = await fetch(
    `${baseUrl}${prodPath}/bwckschd.p_disp_dyn_sched`,
    { headers: { "User-Agent": HEADERS["User-Agent"] } }
  );
  const html = await resp.text();

  const terms: { code: string; description: string }[] = [];
  // Parse <option value="202710">Fall 2026</option> inside the term select
  const optionRegex =
    /<option\s+value="(\d{6})"\s*>([^<]+)<\/option>/gi;
  let match;
  while ((match = optionRegex.exec(html)) !== null) {
    terms.push({ code: match[1], description: match[2].trim() });
  }
  return terms;
}

async function getSubjects(
  baseUrl: string,
  prodPath: string,
  termCode: string
): Promise<string[]> {
  const resp = await fetch(
    `${baseUrl}${prodPath}/bwckgens.p_proc_term_date`,
    {
      method: "POST",
      headers: HEADERS,
      body: `p_calling_proc=bwckschd.p_disp_dyn_sched&p_term=${termCode}`,
    }
  );
  const html = await resp.text();

  const subjects: string[] = [];
  const optionRegex = /<option\s+value="([A-Z]{2,5})"/gi;
  let match;
  while ((match = optionRegex.exec(html)) !== null) {
    if (match[1] !== "%" && match[1] !== "dummy") {
      subjects.push(match[1]);
    }
  }
  return [...new Set(subjects)];
}

async function searchSubject(
  baseUrl: string,
  prodPath: string,
  termCode: string,
  subject: string
): Promise<string> {
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

  const resp = await fetch(
    `${baseUrl}${prodPath}/bwckschd.p_get_crse_unsec`,
    {
      method: "POST",
      headers: HEADERS,
      body: params.toString(),
    }
  );
  return resp.text();
}

function parseSections(
  html: string,
  termCode: string,
  slug: string
): CourseSection[] {
  const sections: CourseSection[] = [];
  const standardTerm = codeToStandardTerm(termCode);

  // Split by section headers:
  // <th class="ddtitle"><a ...>Title - CRN - SUBJ NUM - Section</a></th>
  const titleRegex =
    /<th\s+class="ddtitle"[^>]*>\s*<a[^>]*>([^<]+)<\/a>/gi;

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
    const subjMatch = subjNum.match(/^([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)$/);
    if (!subjMatch) continue;

    const [, prefix, number] = subjMatch;

    // Get the detail block between this title and the next
    const startIdx = titles[i].index;
    const endIdx =
      i + 1 < titles.length ? titles[i + 1].index : html.length;
    const detailBlock = html.slice(startIdx, endIdx);

    // Extract credits
    const credMatch = detailBlock.match(/([\d.]+)\s+Credits/);
    const credits = credMatch ? parseFloat(credMatch[1]) : 0;

    // Extract campus — CCBC campuses: Catonsville, Dundalk, Essex, Online, etc.
    const campusMatch = detailBlock.match(
      /(?:Catonsville|Dundalk|Essex|Hunt Valley|Owings Mills|Online|Off[- ]?Campus|Distance)[^<]*/i
    );
    const campus = campusMatch ? campusMatch[0].trim() : "";

    // Parse meeting times table
    const meetingTableMatch = detailBlock.match(
      /<table[^>]*class="datadisplaytable"[^>]*>([\s\S]*?)<\/table>/i
    );

    let days = "";
    let startTime = "";
    let endTime = "";
    let startDate = "";
    let where = "";
    let instructor: string | null = null;

    if (meetingTableMatch) {
      const tableHtml = meetingTableMatch[1];
      const rowRegex =
        /<tr>\s*((?:<td[^>]*>[\s\S]*?<\/td>\s*)+)<\/tr>/gi;
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
            days = cells[2]
              .split("")
              .map((d: string) => {
                switch (d) {
                  case "M":
                    return "M";
                  case "T":
                    return "Tu";
                  case "W":
                    return "W";
                  case "R":
                    return "Th";
                  case "F":
                    return "F";
                  case "S":
                    return "Sa";
                  case "U":
                    return "Su";
                  default:
                    return "";
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
            const instrName = cells[6]
              .replace(/\(P\)/, "")
              .replace(/\s+/g, " ")
              .trim();
            if (instrName && instrName !== "TBA") {
              instructor = instrName;
            }
          }
        }
      }
    }

    // Detect mode
    let mode: CourseMode = "in-person";
    const modeStr = (campus + " " + where).toLowerCase();
    if (modeStr.includes("online") || modeStr.includes("distance")) {
      if (modeStr.includes("hybrid")) mode = "hybrid";
      else mode = "online";
    } else if (modeStr.includes("hybrid")) {
      mode = "hybrid";
    } else if (modeStr.includes("synchronous")) {
      mode = "zoom";
    }

    // Extract seat counts from enrollment info if available
    const seatMatch = detailBlock.match(
      /Seats:\s*<[^>]*>\s*(\d+)\s*of\s*(\d+)/i
    );
    const seatsOpen = seatMatch ? parseInt(seatMatch[1]) : null;
    const seatsTotal = seatMatch ? parseInt(seatMatch[2]) : null;

    sections.push({
      college_code: slug,
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
      campus: campus || "Main",
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function scrapeCollege(
  slug: string,
  config: { baseUrl: string; prodPath: string },
  termCode: string
): Promise<number> {
  const { baseUrl, prodPath } = config;
  const standardTerm = codeToStandardTerm(termCode);

  console.log(
    `\n=== Scraping ${slug} (Banner 8) for term ${termCode} → ${standardTerm} ===`
  );

  // Get available subjects
  const subjects = await getSubjects(baseUrl, prodPath, termCode);
  console.log(`  Found ${subjects.length} subjects`);

  const allSections: CourseSection[] = [];

  for (let i = 0; i < subjects.length; i++) {
    const subj = subjects[i];
    try {
      const html = await searchSubject(baseUrl, prodPath, termCode, subj);
      const sections = parseSections(html, termCode, slug);
      if (sections.length > 0) {
        process.stdout.write(
          `  [${i + 1}/${subjects.length}] ${subj}  ${sections.length} sections\n`
        );
      }
      allSections.push(...sections);
    } catch (e) {
      console.error(`  Error scraping ${subj}: ${e}`);
    }
    await sleep(200); // Be polite
  }

  console.log(`\n  Total: ${allSections.length} sections`);

  if (allSections.length > 0) {
    const outDir = path.join(
      process.cwd(),
      "data",
      "md",
      "courses",
      slug
    );
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${standardTerm}.json`);
    fs.writeFileSync(outPath, JSON.stringify(allSections, null, 2) + "\n");
    console.log(`  Written to ${outPath}`);
  }

  return allSections.length;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const termIdx = args.indexOf("--term");
  const termInput = termIdx >= 0 ? args[termIdx + 1] : "Fall 2026";
  const collegeFlag = args.indexOf("--college");
  const allFlag = args.includes("--all");

  // Allow both "Fall 2026" and "202710" formats
  const termCode = /^\d{6}$/.test(termInput)
    ? termInput
    : termNameToCode(termInput);

  let targets: [string, { baseUrl: string; prodPath: string }][];

  if (allFlag) {
    targets = Object.entries(BANNER8_COLLEGES);
  } else if (collegeFlag >= 0) {
    const slug = args[collegeFlag + 1];
    const config = BANNER8_COLLEGES[slug];
    if (!config) {
      console.error(`Unknown college: ${slug}`);
      console.error(
        `Available: ${Object.keys(BANNER8_COLLEGES).join(", ")}`
      );
      process.exit(1);
    }
    targets = [[slug, config]];
  } else {
    // Default: scrape all Banner 8 colleges
    targets = Object.entries(BANNER8_COLLEGES);
  }

  // Optionally discover available terms first
  if (args.includes("--list-terms")) {
    for (const [slug, config] of targets) {
      console.log(`\nAvailable terms for ${slug}:`);
      const terms = await getAvailableTerms(
        config.baseUrl,
        config.prodPath
      );
      for (const t of terms) {
        console.log(`  ${t.code}: ${t.description}`);
      }
    }
    return;
  }

  let grandTotal = 0;
  for (const [slug, config] of targets) {
    const count = await scrapeCollege(slug, config, termCode);
    grandTotal += count;
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

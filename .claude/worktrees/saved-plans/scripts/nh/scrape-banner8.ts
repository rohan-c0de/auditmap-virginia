/**
 * scrape-banner8.ts
 *
 * Scrapes course section data from the Community College System of New
 * Hampshire (CCSNH). All 7 colleges share one Banner 8 instance at
 * sis.ccsnh.edu/ssb8/. Colleges are distinguished via the `sel_levl`
 * parameter (CCSNH repurposes "level" as a college selector).
 *
 * Adapted from scripts/md/scrape-banner8.ts. Uses direct HTTP POST.
 *
 * Usage:
 *   npx tsx scripts/nh/scrape-banner8.ts
 *   npx tsx scripts/nh/scrape-banner8.ts --term 202710
 *   npx tsx scripts/nh/scrape-banner8.ts --college nhti
 *   npx tsx scripts/nh/scrape-banner8.ts --list-terms
 */

import * as fs from "fs";
import * as path from "path";

const BASE_URL = "https://sis.ccsnh.edu/ssb8";

// CCSNH college-code → our college_slug mapping.
// Codes come from the <select name="sel_levl"> options on the search page.
const COLLEGES: Record<string, string> = {
  GB: "gbcc",
  LR: "lrcc",
  MC: "mccnh",
  TI: "nhti",
  NC: "nashuacc",
  RV: "rvcc",
  WM: "wmcc",
};

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
  "Content-Type": "application/x-www-form-urlencoded",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
};

// CCSNH term codes: YYYYSS where YYYY = academic-year-ending-year,
//   SS = 10 (Fall), 20 (Spring), 30 (Summer).
//   e.g. 202710 = Fall 2026, 202720 = Spring 2027, 202730 = Summer 2027.
// Description-based mapping is more reliable than code arithmetic.
function codeToStandardTerm(code: string, description: string): string {
  const desc = description.toLowerCase();
  const yearMatch = description.match(/\b(20\d{2})\b/);
  const year = yearMatch ? yearMatch[1] : code.slice(0, 4);
  if (desc.includes("fall")) return `${year}FA`;
  if (desc.includes("spring") || desc.includes("winter")) return `${year}SP`;
  if (desc.includes("summer")) return `${year}SU`;
  return `${year}XX`;
}

async function getAvailableTerms(): Promise<{ code: string; description: string }[]> {
  const resp = await fetch(`${BASE_URL}/bwckschd.p_disp_dyn_sched`, {
    headers: { "User-Agent": HEADERS["User-Agent"] },
  });
  const html = await resp.text();

  const terms: { code: string; description: string }[] = [];
  const optionRegex = /<OPTION\s+VALUE="(\d{6})">([^<]+)<\/OPTION>/gi;
  let match;
  while ((match = optionRegex.exec(html)) !== null) {
    terms.push({ code: match[1], description: match[2].trim() });
  }
  return terms;
}

async function searchCollege(termCode: string, levlCode: string): Promise<string> {
  const params = new URLSearchParams();
  params.append("term_in", termCode);
  params.append("sel_subj", "dummy");
  params.append("sel_subj", "%");
  params.append("sel_day", "dummy");
  params.append("sel_schd", "dummy");
  params.append("sel_schd", "%");
  params.append("sel_insm", "dummy");
  params.append("sel_insm", "%");
  params.append("sel_camp", "dummy");
  params.append("sel_camp", "%");
  params.append("sel_levl", "dummy");
  params.append("sel_levl", levlCode);
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
    headers: HEADERS,
    body: params.toString(),
  });
  return resp.text();
}

function decodeDays(raw: string): string {
  if (!raw || raw === "TBA") return "";
  return raw
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

function parseSections(html: string, slug: string, standardTerm: string): CourseSection[] {
  const sections: CourseSection[] = [];

  // Find section headers:
  //   <th CLASS="ddtitle" ...><a ...>Title - CRN - SUBJ NUM - Section</a></th>
  const titleRegex =
    /<th\s+CLASS="ddtitle"[^>]*>\s*<a[^>]*>([^<]+)<\/a>/gi;

  const titles: { title: string; index: number }[] = [];
  let titleMatch;
  while ((titleMatch = titleRegex.exec(html)) !== null) {
    titles.push({ title: titleMatch[1].trim(), index: titleMatch.index });
  }

  for (let i = 0; i < titles.length; i++) {
    const { title } = titles[i];
    const parts = title.split(" - ");
    if (parts.length < 4) continue;

    // Title may itself contain " - "; last three parts are CRN, SUBJ NUM, Section.
    const section = parts[parts.length - 1].trim();
    const subjNum = parts[parts.length - 2].trim();
    const crn = parts[parts.length - 3].trim();
    const courseTitle = parts.slice(0, parts.length - 3).join(" - ").trim();
    void section;

    const subjMatch = subjNum.match(/^([A-Z]{2,5})\s+([0-9A-Z]{2,6})$/);
    if (!subjMatch) continue;
    const [, prefix, number] = subjMatch;

    const startIdx = titles[i].index;
    const endIdx = i + 1 < titles.length ? titles[i + 1].index : html.length;
    const detailBlock = html.slice(startIdx, endIdx);

    const credMatch = detailBlock.match(/([\d.]+)\s+Credits/);
    const credits = credMatch ? parseFloat(credMatch[1]) : 0;

    // Meeting times table — first datadisplaytable inside the detail block.
    const meetingTableMatch = detailBlock.match(
      /<table[^>]*CLASS="datadisplaytable"[^>]*>([\s\S]*?)<\/table>/i
    );

    let days = "";
    let startTime = "";
    let endTime = "";
    let startDate = "";
    let where = "";
    let instructor: string | null = null;

    if (meetingTableMatch) {
      const tableHtml = meetingTableMatch[1];
      const rowRegex = /<tr>\s*((?:<td[^>]*>[\s\S]*?<\/td>\s*)+)<\/tr>/gi;
      let rowMatch;
      while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
        const cells: string[] = [];
        const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let cellMatch;
        while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
          cells.push(cellMatch[1].replace(/<[^>]*>/g, "").trim());
        }
        if (cells.length < 7) continue;

        // Type(0) Time(1) Days(2) Where(3) DateRange(4) ScheduleType(5) Instructors(6)
        if (cells[1] && cells[1] !== "TBA") {
          const [s, e] = cells[1].split(" - ");
          if (s && e) {
            startTime = s.trim();
            endTime = e.trim();
          }
        }

        if (cells[2]) days = decodeDays(cells[2]);

        if (cells[3]) where = cells[3];

        if (cells[4]) {
          const dateMatch = cells[4].match(/(\w+ \d+, \d{4})/);
          if (dateMatch) {
            const d = new Date(dateMatch[1]);
            if (!isNaN(d.getTime())) startDate = d.toISOString().slice(0, 10);
          }
        }

        if (cells[6]) {
          const instrName = cells[6]
            .replace(/\(P\)/g, "")
            .replace(/E-mail/gi, "")
            .replace(/\s+/g, " ")
            .trim();
          if (instrName && instrName !== "TBA") instructor = instrName;
        }

        // Use the first meeting row for the summary fields.
        break;
      }
    }

    // Detect mode from the "Where" string.
    // CCSNH uses "On-Line Class REMOTE" for online; physical rooms otherwise.
    let mode: CourseMode = "in-person";
    const whereLower = where.toLowerCase();
    if (whereLower.includes("on-line") || whereLower.includes("online") || whereLower.includes("remote")) {
      mode = "online";
    }
    if (whereLower.includes("hybrid")) mode = "hybrid";

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
      campus: where || "Main",
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

async function scrapeCollegeTerm(
  levlCode: string,
  slug: string,
  termCode: string,
  termDescription: string
): Promise<number> {
  const standardTerm = codeToStandardTerm(termCode, termDescription);
  console.log(`\n  ${slug} (${levlCode}) — ${termDescription} ${termCode} → ${standardTerm}`);

  const html = await searchCollege(termCode, levlCode);
  const sections = parseSections(html, slug, standardTerm);
  console.log(`    ${sections.length} sections`);

  if (sections.length > 0) {
    const outDir = path.join(process.cwd(), "data", "nh", "courses", slug);
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${standardTerm}.json`);
    fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
    console.log(`    Written to ${outPath}`);
  }
  return sections.length;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--list-terms")) {
    const terms = await getAvailableTerms();
    for (const t of terms) console.log(`  ${t.code}: ${t.description}`);
    return;
  }

  const collegeFlagIdx = args.indexOf("--college");
  const termFlagIdx = args.indexOf("--term");
  const onlyCollege = collegeFlagIdx >= 0 ? args[collegeFlagIdx + 1] : null;
  const onlyTerm = termFlagIdx >= 0 ? args[termFlagIdx + 1] : null;

  const terms = await getAvailableTerms();
  const targetTerms = terms.filter((t) => {
    const desc = t.description.toLowerCase();
    if (desc.includes("view only")) return false;
    if (desc.includes("examinations")) return false;
    if (desc.includes("coop")) return false;
    const yearMatch = t.description.match(/\b(20\d{2})\b/);
    if (!yearMatch) return false;
    if (parseInt(yearMatch[1]) < 2026) return false;
    if (onlyTerm && t.code !== onlyTerm) return false;
    return true;
  });

  if (targetTerms.length === 0) {
    console.log("No matching terms found.");
    return;
  }
  console.log(`Target terms: ${targetTerms.map((t) => `${t.description} (${t.code})`).join(", ")}`);

  const targetColleges = Object.entries(COLLEGES).filter(([, slug]) =>
    onlyCollege ? slug === onlyCollege : true
  );
  if (targetColleges.length === 0) {
    console.error(`Unknown college: ${onlyCollege}. Available: ${Object.values(COLLEGES).join(", ")}`);
    process.exit(1);
  }

  let grandTotal = 0;
  for (const [levlCode, slug] of targetColleges) {
    console.log(`\n=== ${slug} (${levlCode}) ===`);
    for (const term of targetTerms) {
      const count = await scrapeCollegeTerm(levlCode, slug, term.code, term.description);
      grandTotal += count;
      await sleep(500);
    }
  }

  console.log(`\nDone. ${grandTotal} total sections scraped.`);

  if (!args.includes("--no-import") && grandTotal > 0) {
    const { importCoursesToSupabase } = await import("../lib/supabase-import");
    await importCoursesToSupabase("nh");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

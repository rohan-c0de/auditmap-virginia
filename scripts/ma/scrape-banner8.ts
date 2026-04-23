/**
 * scrape-banner8.ts
 *
 * Scrapes course section data from Massachusetts community colleges that
 * run a public Banner 8 schedule endpoint. Each school has its own Banner
 * instance (unlike CCSNH's single shared deployment), so this is a
 * per-college baseUrl + prodPath table — the same shape as scripts/md/
 * scrape-banner8.ts.
 *
 * Covered:
 *   gcc       Greenfield Community College    my.gcc.mass.edu/PROD
 *   middlesex Middlesex Community College     middlenet.middlesex.mass.edu/PROD
 *
 * Not covered (probed but unusable publicly):
 *   massasoit — banner.massasoit.mass.edu is SSO-gated (Microsoft SAML)
 *     for both /prodssb/bwckschd and /StudentRegistrationSsb paths.
 *     Tracked for future work.
 *
 * Both covered schools accept sel_subj=% (all subjects) in a single
 * request, so we issue one request per (college, term) rather than
 * iterating subjects. Both use the classic hierarchical ddtitle format
 * (same parser as scripts/md/ and scripts/nh/).
 *
 * Usage:
 *   npx tsx scripts/ma/scrape-banner8.ts
 *   npx tsx scripts/ma/scrape-banner8.ts --college gcc --term 202609
 *   npx tsx scripts/ma/scrape-banner8.ts --list-terms
 */

import * as fs from "fs";
import * as path from "path";

// Middlesex's middlenet.middlesex.mass.edu serves an incomplete cert chain
// that Node's default trust store rejects (browsers + curl work fine).
// Since we're scraping public data with no auth, relaxing TLS is acceptable.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
};

interface CollegeEndpoint {
  slug: string;
  baseUrl: string;
  prodPath: string;
}

const COLLEGES: CollegeEndpoint[] = [
  {
    slug: "gcc",
    baseUrl: "https://my.gcc.mass.edu",
    prodPath: "/PROD",
  },
  {
    slug: "middlesex",
    baseUrl: "https://middlenet.middlesex.mass.edu",
    prodPath: "/PROD",
  },
];

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

// Description-based term mapping — more robust than guessing at the
// code suffix scheme (GCC uses 01/05/09, Middlesex uses 01/06/09 etc.)
function codeToStandardTerm(code: string, description: string): string {
  const desc = description.toLowerCase();
  const yearMatch = description.match(/\b(20\d{2})\b/);
  const year = yearMatch ? yearMatch[1] : code.slice(0, 4);
  if (desc.includes("fall")) return `${year}FA`;
  if (desc.includes("spring") || desc.includes("winter")) return `${year}SP`;
  if (desc.includes("summer")) return `${year}SU`;
  return `${year}XX`;
}

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
  const optionRegex = /<OPTION\s+VALUE="(\d{6})"[^>]*>([^<]+)<\/OPTION>/gi;
  let match;
  while ((match = optionRegex.exec(html)) !== null) {
    terms.push({ code: match[1], description: match[2].trim() });
  }
  return terms;
}

async function searchAll(
  baseUrl: string,
  prodPath: string,
  termCode: string
): Promise<string> {
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

  const resp = await fetch(
    `${baseUrl}${prodPath}/bwckschd.p_get_crse_unsec`,
    { method: "POST", headers: HEADERS, body: params.toString() }
  );
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

    // GCC uses CLASS="datadisplaytable table" (two tokens), Middlesex uses
    // CLASS="datadisplaytable" — match the token either way.
    const meetingTableMatch = detailBlock.match(
      /<table[^>]*CLASS="[^"]*\bdatadisplaytable\b[^"]*"[^>]*SUMMARY="[^"]*scheduled meeting times[^"]*"[^>]*>([\s\S]*?)<\/table>/i
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
        // Two column layouts seen across MA Banner 8 deployments:
        //   7 cols: Type(0) Time(1) Days(2) Where(3) DateRange(4) ScheduleType(5) Instructors(6)  [gcc]
        //   5 cols: Days(0) Time(1) Where(2) DateRange(3) Instructors(4)                          [middlesex]
        let timeIdx = -1, daysIdx = -1, whereIdx = -1, dateIdx = -1, instrIdx = -1;
        if (cells.length >= 7) {
          timeIdx = 1; daysIdx = 2; whereIdx = 3; dateIdx = 4; instrIdx = 6;
        } else if (cells.length >= 5) {
          daysIdx = 0; timeIdx = 1; whereIdx = 2; dateIdx = 3; instrIdx = 4;
        } else {
          continue;
        }

        if (cells[timeIdx] && cells[timeIdx] !== "TBA") {
          const [s, e] = cells[timeIdx].split(" - ");
          if (s && e) {
            startTime = s.trim();
            endTime = e.trim();
          }
        }
        if (cells[daysIdx]) days = decodeDays(cells[daysIdx]);
        if (cells[whereIdx]) where = cells[whereIdx];
        if (cells[dateIdx]) {
          const dateMatch = cells[dateIdx].match(/(\w+ \d+, \d{4})/);
          if (dateMatch) {
            const d = new Date(dateMatch[1]);
            if (!isNaN(d.getTime())) startDate = d.toISOString().slice(0, 10);
          }
        }
        if (cells[instrIdx]) {
          const instrName = cells[instrIdx]
            .replace(/\(P\)/g, "")
            .replace(/E-mail/gi, "")
            .replace(/\s+/g, " ")
            .trim();
          if (instrName && instrName !== "TBA") instructor = instrName;
        }
        break;
      }
    }

    let mode: CourseMode = "in-person";
    const whereLower = where.toLowerCase();
    if (whereLower.includes("online") || whereLower.includes("on-line") || whereLower.includes("remote") || whereLower.includes("distance")) {
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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function scrapeCollegeTerm(
  college: CollegeEndpoint,
  termCode: string,
  termDescription: string
): Promise<number> {
  const standardTerm = codeToStandardTerm(termCode, termDescription);
  console.log(`\n  ${college.slug} — ${termDescription} ${termCode} → ${standardTerm}`);

  const html = await searchAll(college.baseUrl, college.prodPath, termCode);
  const sections = parseSections(html, college.slug, standardTerm);
  console.log(`    ${sections.length} sections`);

  if (sections.length > 0) {
    const outDir = path.join(process.cwd(), "data", "ma", "courses", college.slug);
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${standardTerm}.json`);
    fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
    console.log(`    Written to ${outPath}`);
  }
  return sections.length;
}

async function main() {
  const args = process.argv.slice(2);
  const collegeIdx = args.indexOf("--college");
  const termIdx = args.indexOf("--term");
  const onlyCollege = collegeIdx >= 0 ? args[collegeIdx + 1] : null;
  const onlyTerm = termIdx >= 0 ? args[termIdx + 1] : null;

  if (args.includes("--list-terms")) {
    for (const c of COLLEGES) {
      console.log(`\n${c.slug}:`);
      const terms = await getAvailableTerms(c.baseUrl, c.prodPath);
      for (const t of terms) console.log(`  ${t.code}: ${t.description}`);
    }
    return;
  }

  const targets = onlyCollege ? COLLEGES.filter((c) => c.slug === onlyCollege) : COLLEGES;
  if (targets.length === 0) {
    console.error(`Unknown college: ${onlyCollege}. Available: ${COLLEGES.map((c) => c.slug).join(", ")}`);
    process.exit(1);
  }

  let grandTotal = 0;
  for (const college of targets) {
    console.log(`\n=== ${college.slug} (${college.baseUrl}) ===`);
    const terms = await getAvailableTerms(college.baseUrl, college.prodPath);
    const target = terms.filter((t) => {
      const desc = t.description.toLowerCase();
      if (desc.includes("view only")) return false;
      if (desc.includes("non-credit")) return false;
      const yearMatch = t.description.match(/\b(20\d{2})\b/);
      if (!yearMatch || parseInt(yearMatch[1]) < 2026) return false;
      if (onlyTerm && t.code !== onlyTerm) return false;
      return true;
    });
    if (target.length === 0) {
      console.log("  No matching terms");
      continue;
    }
    console.log(`  Target terms: ${target.map((t) => `${t.description} (${t.code})`).join(", ")}`);
    for (const term of target) {
      grandTotal += await scrapeCollegeTerm(college, term.code, term.description);
      await sleep(500);
    }
  }

  console.log(`\nDone. ${grandTotal} total sections scraped.`);

  if (!args.includes("--no-import") && grandTotal > 0) {
    const { importCoursesToSupabase } = await import("../lib/supabase-import");
    await importCoursesToSupabase("ma");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

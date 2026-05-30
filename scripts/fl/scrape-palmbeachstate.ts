/**
 * scrape-palmbeachstate.ts — Palm Beach State College course search
 *
 * PBSC uses a custom ASP.NET WebForms course-search application at
 *   https://studentcoursesearch.palmbeachstate.edu/Default.aspx
 *
 * Strategy: GET the page to obtain a fresh __VIEWSTATE session token,
 * then POST with the "Full Term" selection for each term. The form
 * supports selecting multiple terms + filtering by subject, but the
 * simplest reliable approach is one POST per (term, subject) with
 * __VIEWSTATE from the immediately preceding GET.
 *
 * Term values use URL-encoded patterns:
 *   Summer 2026: "Summer%2026%" (all summer sessions)
 *   Fall 2026:   "Fall%2026%"   (all fall sessions)
 *
 * Usage:
 *   npx tsx scripts/fl/scrape-palmbeachstate.ts
 *   npx tsx scripts/fl/scrape-palmbeachstate.ts --term "Fall 2026"
 *   npx tsx scripts/fl/scrape-palmbeachstate.ts --term "Fall 2026" --subject MAC
 */

import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";

const BASE_URL = "https://studentcoursesearch.palmbeachstate.edu/Default.aspx";
const COLLEGE_SLUG = "palmbeachstate";
const DATA_DIR = path.join(process.cwd(), "data", "fl", "courses", COLLEGE_SLUG);

// Term values from the listBoxTerm <select>
const TERM_MAP: Record<string, { value: string; file: string }> = {
  "Summer 2026": { value: "Summer%2526%2525", file: "2026SU" },
  "Fall 2026":   { value: "Fall%2526%2525",   file: "2026FA" },
};

// All subjects from PBSC's dropdown (captured 2026-05-30)
const PBSC_SUBJECTS = [
  "ACG","ACR","AER","AMH","AML","ANT","APA","ARC","ARH","ART","AST","AVO",
  "BAN","BCA","BCN","BCT","BCV","BOT","BSC","BUL",
  "CAI","CAP","CCJ","CEN","CET","CGS","CHD","CHM","CIS","CJB","CJE","CJJ","CJK","CJL","CLP","CNT","COP","COS","CPO","CRW","CSP","CTS",
  "DAA","DEA","DEH","DEP","DES","DIG","DIM","DSC",
  "EAP","ECO","EDF","EDG","EDP","EEC","EET","EEV","EEX","EGN","EME","EMS","ENC","ENL","ENT","EPI","ESC","ETD","ETI","ETM","ETP","ETS","EVR","EVS",
  "FFP","FIL","FIN","FOS","FRE","FSS",
  "GCO","GEA","GEB","GER","GEY","GLY","GRA",
  "HCP","HEV","HFT","HIM","HOS","HSA","HSC","HUN","HUS",
  "IDC","IDH","IND","INR","ISM",
  "JST","LDE","LIT",
  "MAC","MAD","MAN","MAP","MAR","MAS","MAT","MCB","MEA","MGF","MKA","MMC","MNA","MSL","MSS","MTB","MTE","MUH","MUL","MUN","MUS",
  "NUR","OCE","ORI","OST","OTH",
  "PAS","PET","PGY","PHI","PHT","PHY","PLA","PMT","POS","PRN","PSY",
  "RAD","RCP","REL","RET","RTE","RTV",
  "SCE","SLS","SON","SPC","SPN","SSE","STA","STS","SYG",
  "THE","TSM",
  "VIC","WOH",
];

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
  mode: string;
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

function parseArgs() {
  const args = process.argv.slice(2);
  let termArg = "";
  let subjectFilter: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--term" && args[i + 1]) { termArg = args[i + 1]; i++; }
    else if (args[i] === "--subject" && args[i + 1]) { subjectFilter = args[i + 1].toUpperCase(); i++; }
  }
  if (!termArg) termArg = "Summer 2026,Fall 2026";
  return {
    terms: termArg.split(",").map(t => t.trim()).filter(Boolean),
    subjectFilter,
  };
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

interface FormTokens {
  viewstate: string;
  viewstateGenerator: string;
  eventValidation: string;
  cookieHeader: string;
}

async function getFormTokens(): Promise<FormTokens> {
  const res = await fetch(BASE_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; community-college-path/1.0)",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Encoding": "identity",
    },
  });
  if (!res.ok) throw new Error(`GET ${BASE_URL} -> ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  const cookieHeader = res.headers.get("set-cookie") || "";
  return {
    viewstate: $("#__VIEWSTATE").val() as string || "",
    viewstateGenerator: $("#__VIEWSTATEGENERATOR").val() as string || "",
    eventValidation: $("#__EVENTVALIDATION").val() as string || "",
    cookieHeader,
  };
}

function normalizeDays(raw: string): string {
  // PBSC uses "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun" or abbreviated
  const map: Record<string, string> = {
    "mon": "Mo", "tue": "Tu", "wed": "We", "thu": "Th", "fri": "Fr", "sat": "Sa", "sun": "Su",
    "m": "Mo", "t": "Tu", "w": "We", "r": "Th", "f": "Fr", "s": "Sa", "u": "Su",
  };
  return raw.toLowerCase().split(/[,\s/]+/).map(d => map[d] || "").join("");
}

function normalizeTime(raw: string): string {
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)$/i);
  if (!m) return "";
  return `${m[1]}:${m[2]}${m[3].toUpperCase()}`;
}

function detectMode(location: string, format: string): string {
  const l = (location + " " + format).toLowerCase();
  if (l.includes("online") || l.includes("web")) return "online";
  if (l.includes("hybrid")) return "hybrid";
  return "in-person";
}

function parseTable($: cheerio.CheerioAPI, fileTermCode: string): CourseSection[] {
  const sections: CourseSection[] = [];
  // Results table has id="datatable" or class "table"
  const table = $("#datatable, table.table").first();
  if (!table.length) return sections;

  const headers: string[] = [];
  table.find("thead tr th").each((_, th) => {
    headers.push($(th).text().trim().toLowerCase());
  });

  table.find("tbody tr").each((_, row) => {
    const cells: string[] = [];
    $(row).find("td").each((_, td) => cells.push($(td).text().trim()));
    if (cells.length < 5) return;

    // Header order (typical PBSC): CRN, Subject, Course, Section, Title, Credits,
    //   Days, Time, Location, Campus, Instructor, Seats Avail, Seats Total, Term
    const get = (key: string) => {
      const idx = headers.indexOf(key);
      return idx >= 0 ? cells[idx] || "" : "";
    };

    const crn = get("crn") || cells[0];
    const subject = get("subject") || cells[1];
    const courseNum = get("course") || cells[2];
    const title = get("title") || cells[4] || "";
    const creditsRaw = get("credits") || get("credit hours") || cells[5] || "3";
    const days = normalizeDays(get("days") || cells[6] || "");
    const timeRaw = get("time") || cells[7] || "";
    const [startTime, endTime] = timeRaw.includes("-")
      ? timeRaw.split("-").map(t => normalizeTime(t.trim()))
      : ["", ""];
    const location = get("location") || get("room") || cells[8] || "";
    const campus = get("campus") || cells[9] || "";
    const instructor = get("instructor") || get("faculty") || cells[10] || null;
    const seatsOpen = parseInt(get("seats avail") || get("open") || cells[11] || "0", 10);
    const seatsTotal = parseInt(get("seats total") || get("capacity") || cells[12] || "0", 10);

    if (!crn || !subject || !courseNum) return;

    sections.push({
      college_code: COLLEGE_SLUG,
      term: fileTermCode,
      course_prefix: subject.trim(),
      course_number: courseNum.trim(),
      course_title: title.trim(),
      credits: Math.round(parseFloat(creditsRaw)) || 3,
      crn: crn.trim(),
      days,
      start_time: startTime,
      end_time: endTime,
      start_date: "",
      location: location.trim(),
      campus: campus.trim(),
      mode: detectMode(location, ""),
      instructor: instructor && instructor !== "TBA" && instructor !== "Staff" ? instructor.trim() : null,
      seats_open: isNaN(seatsOpen) ? null : seatsOpen,
      seats_total: isNaN(seatsTotal) ? null : seatsTotal,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  });

  return sections;
}

async function searchTerm(
  termName: string,
  fileTermCode: string,
  termValue: string,
  subjectFilter: string | null,
): Promise<CourseSection[]> {
  const subjects = subjectFilter ? [subjectFilter] : PBSC_SUBJECTS;
  const allSections: CourseSection[] = [];

  console.log(`\n  ${termName} — ${subjects.length} subjects`);

  for (let si = 0; si < subjects.length; si++) {
    const subject = subjects[si];
    process.stdout.write(`  [${si + 1}/${subjects.length}] ${subject.padEnd(6)} `);

    try {
      // Fresh VIEWSTATE per request to avoid MAC validation errors
      const tokens = await getFormTokens();

      const body = new URLSearchParams({
        "__VIEWSTATE": tokens.viewstate,
        "__VIEWSTATEGENERATOR": tokens.viewstateGenerator,
        "__EVENTVALIDATION": tokens.eventValidation,
        "ctl00$ContentPlaceHolder1$listBoxTerm": termValue,
        "ctl00$ContentPlaceHolder1$ddlSubject": subject,
        "ctl00$ContentPlaceHolder1$Button1": "Search",
      });

      const headers: Record<string, string> = {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (compatible; community-college-path/1.0)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Encoding": "identity",
        "Referer": BASE_URL,
      };
      if (tokens.cookieHeader) {
        // Extract ASP.NET session cookie
        const sessMatch = tokens.cookieHeader.match(/ASP\.NET_SessionId=[^;]+/);
        if (sessMatch) headers["Cookie"] = sessMatch[0];
      }

      const res = await fetch(BASE_URL, {
        method: "POST",
        headers,
        body: body.toString(),
      });

      const html = await res.text();
      const $ = cheerio.load(html);

      // Check for server error
      if (html.includes("Server Error") || html.includes("ViewStateException")) {
        console.log("→ viewstate error (retry)");
        await sleep(500);
        si--;
        continue;
      }

      const sections = parseTable($, fileTermCode);
      allSections.push(...sections);
      console.log(`→ ${sections.length}`);

      // Partial save every 20 subjects
      if ((si + 1) % 20 === 0 && allSections.length > 0) {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(
          path.join(DATA_DIR, `${fileTermCode}.partial.json`),
          JSON.stringify(allSections, null, 2) + "\n",
        );
      }

      await sleep(400);
    } catch (err) {
      console.log(`→ error: ${(err as Error).message?.slice(0, 60)}`);
    }
  }

  return allSections;
}

async function main() {
  const { terms, subjectFilter } = parseArgs();
  console.log(`\nPalm Beach State College — ${terms.length} term(s)`);
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  let total = 0;

  for (const termName of terms) {
    const cfg = TERM_MAP[termName];
    if (!cfg) {
      console.error(`Unknown term: "${termName}". Available: ${Object.keys(TERM_MAP).join(", ")}`);
      process.exit(1);
    }
    const sections = await searchTerm(termName, cfg.file, cfg.value, subjectFilter);
    if (sections.length > 0) {
      const p = path.join(DATA_DIR, `${cfg.file}.json`);
      fs.writeFileSync(p, JSON.stringify(sections, null, 2) + "\n");
      const partial = path.join(DATA_DIR, `${cfg.file}.partial.json`);
      if (fs.existsSync(partial)) fs.unlinkSync(partial);
      console.log(`\n  ${termName}: ${sections.length} sections`);
    } else {
      console.log(`\n  ${termName}: 0 sections (check table selectors)`);
    }
    total += sections.length;
  }

  console.log(`\nDone! ${total} sections total\n`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });

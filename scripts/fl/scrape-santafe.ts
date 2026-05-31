/**
 * scrape-santafe.ts — Santa Fe College (Gainesville) class search
 *
 * Santa Fe's public "SF Course Listing" is an Ellucian/SunGard eSfcc
 * servlet embedded as an iframe on /registrar/class-schedule.html:
 *
 *   Stage 1 (SR1098P): pick Term/Campus/Group → submit → category list
 *   Stage 2 (SR1099P): one page per academic category (ORG_CD) listing
 *                       every course + section for that term.
 *
 * Stage 1 is a stateful JS form that resists plain curl (it copies
 * hidden TERM_YR/TERM_NUM_CD from parallel arrays via JS on submit).
 * But Stage 2 (SR1099P) is a plain GET with query params — once you
 * know the ORG_CD it returns the full listing. So we hardcode the 87
 * category ORG_CDs (captured 2026-05-31) and hit Stage 2 directly per
 * (term, category). If SF adds a new subject category, refresh the
 * list by loading the iframe + reading the category links.
 *
 * SR1099P URL params:
 *   HID_TERM_NUM_CD = 1(Summer) | 2(Fall) | 3(Spring)
 *   HID_TERM_YR     = 4-digit year
 *   HID_FAC_SITE_NUM= 12 (ANY campus)
 *   ORG_CD          = numeric subject category
 *   ORG_TITLE_NAM   = display name (cosmetic)
 *
 * Section row layout (flat <td> sequence):
 *   regNum(5digit) | section | status(Open/Closed) | days(MTWHFSU positional)
 *     | time(HH:MM:SS-HH:MM:SS) [absent for online] | location | code
 * Online rows replace the time+location with a single "WEB *COMP" cell.
 *
 * Usage:
 *   npx tsx scripts/fl/scrape-santafe.ts
 *   npx tsx scripts/fl/scrape-santafe.ts --term "Fall 2026"
 *   npx tsx scripts/fl/scrape-santafe.ts --term "Fall 2026" --org 3110
 */
import * as fs from "fs";
import * as path from "path";

const ESFCC = "https://epublic.sfcollege.edu/eSfcc";
const COLLEGE_SLUG = "sfcollege";
const DATA_DIR = path.join(process.cwd(), "data", "fl", "courses", COLLEGE_SLUG);

const TERM_MAP: Record<string, { numCd: string; yr: string; file: string }> = {
  "Summer 2026": { numCd: "1", yr: "2026", file: "2026SU" },
  "Fall 2026":   { numCd: "2", yr: "2026", file: "2026FA" },
  "Spring 2026": { numCd: "3", yr: "2026", file: "2026SP" },
};

// 87 academic categories (ORG_CD → display name), captured 2026-05-31.
const SF_CATEGORIES: Array<[string, string]> = [
  ["3110","ACCOUNTING"],
  ["8810","ACCOUNTING UPPER LEVEL"],
  ["4111","ADULT EDUCATION AND VOC PREP"],
  ["3390","AIR CONDITIONING AND REFRIGERATION TECH"],
  ["1470","AMERICAN SIGN LANGUAGE"],
  ["1910","ANTHROPOLOGY"],
  ["1210","ART"],
  ["1810","ASTRONOMY"],
  ["3330","AUTOMOTIVE TECHNOLOGY"],
  ["1860","BIOLOGICAL SCIENCES"],
  ["3920","BIOMEDICAL TECHNOLOGY"],
  ["3910","BIOTECHNOLOGY-BTN"],
  ["3321","BUILDING MAINTENANCE"],
  ["3120","BUSINESS ADMINISTRATION"],
  ["3220","CARDIOVASCULAR TECHNOLOGY"],
  ["1820","CHEMISTRY"],
  ["3410","CHILD DEVELOPMENT"],
  ["1490","CHINESE"],
  ["3812","COMPUTER-ITE INTRO TO COLLEGE COMPUTING"],
  ["3830","COMPUTER-ITE NETWORKING TECHNOLOGIES"],
  ["3810","COMPUTER-PROGRAMMING AND ANALYSIS"],
  ["3320","CONSTRUCTION TECHNOLOGY"],
  ["3710","CRIMINAL JUSTICE TECHNOLOGY"],
  ["1220","DANCE"],
  ["3230","DENTAL ASSISTING"],
  ["3240","DENTAL HYGIENE"],
  ["3335","DIESEL TECHNOLOGY"],
  ["8410","EARLY CHILDHOOD ED"],
  ["1710","EDUCATION"],
  ["3730","EMERGENCY MEDICAL SERVICES"],
  ["3340","ENGINEERING TECHNOLOGY ADVANCED MANUFACTURING"],
  ["1305","ENGLISH PREP"],
  ["1310","ENGLISH: COMP, CREATIVE WRITING & LIT"],
  ["1406","ESL COLLEGE"],
  ["1405","ESL PREP"],
  ["1311","FILM/VIDEO STUDIES"],
  ["1460","FRENCH"],
  ["1960","GEOGRAPHY"],
  ["1830","GEOLOGY"],
  ["3520","GRAPHIC DESIGN TECHNOLOGY"],
  ["1120","GRRATE"],
  ["3160","HEALTH INFORMATION MANAGEMENT"],
  ["8310","HEALTH SERVICES ADMINISTRATION"],
  ["5110","HIGH SCHOOL PROGRAMS"],
  ["1970","HISTORY"],
  ["1410","HUMANITIES"],
  ["3365","INDUSTRIAL COOP EDUCATION"],
  ["8720","INFORMATION SYSTEMS TECHNOLOGY"],
  ["1313","JOURNALISM"],
  ["1510","LIBRARY SCIENCE"],
  ["1610","MATHEMATICS"],
  ["1605","MATHEMATICS PREP"],
  ["8210","MEDICAL LABORATORY SCIENCE"],
  ["6115","MILITARY SCIENCE-AIR FORCE ROTC"],
  ["6110","MILITARY SCIENCE-ARMY ROTC"],
  ["6120","MILITARY SCIENCE-NAVY ROTC"],
  ["8920","MULTIMEDIA AND VIDEO PRODUCTION TECHNOLOGY"],
  ["1250","MUSIC"],
  ["1260","MUSIC-APPLIED"],
  ["3260","NUCLEAR MEDICINE TECHNOLOGY"],
  ["8510","NURSING BS"],
  ["3610","NURSING PROGRAMS"],
  ["3130","OFFICE SYSTEMS TECHNOLOGY"],
  ["8610","ORGANIZATIONAL MANAGEMENT"],
  ["3150","PARALEGAL STUDIES"],
  ["1420","PHILOSOPHY"],
  ["3940","PHLEBOTOMY"],
  ["1840","PHYSICAL SCIENCE"],
  ["3285","PHYSICAL THERAPIST ASSISTANT"],
  ["1850","PHYSICS"],
  ["1980","POLITICAL SCIENCE"],
  ["1930","PSYCHOLOGY"],
  ["3292","RADIATION THERAPY"],
  ["3290","RADIOGRAPHY"],
  ["1430","RELIGION"],
  ["3295","RESPIRATORY CARE"],
  ["3210","SCIENCES FOR HEALTH PROGRAMS"],
  ["1950","SOCIOLOGY"],
  ["3291","SONOGRAPHY"],
  ["1440","SPANISH"],
  ["1450","SPEECH"],
  ["3281","STERILE SUPPLY"],
  ["2210","STUDENT DEVELOPMENT AND LEADERSHIP"],
  ["3282","SURGICAL SERVICES"],
  ["1230","THEATRE/DRAMA"],
  ["3395","WELDING TECHNOLOGIES"],
  ["1815","ZOO ANIMAL TECHNOLOGY"],
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
  let orgFilter: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--term" && args[i + 1]) { termArg = args[i + 1]; i++; }
    else if (args[i] === "--org" && args[i + 1]) { orgFilter = args[i + 1]; i++; }
  }
  if (!termArg) termArg = "Summer 2026,Fall 2026";
  return { terms: termArg.split(",").map(t => t.trim()).filter(Boolean), orgFilter };
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function decode(s: string): string {
  return s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// days "M......" / "..W...." / "...H..." → Mo/We/Th. Positions: M T W H F S U
function parseDays(raw: string): string {
  const r = raw.replace(/\s/g, "");
  if (!/^[MTWHFSU.]{7}$/.test(r)) return "";
  const map = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
  let out = "";
  for (let i = 0; i < 7; i++) if (r[i] !== ".") out += map[i];
  return out;
}

function parseTime(raw: string): { start: string; end: string } {
  const m = raw.match(/^(\d{1,2}):(\d{2}):\d{2}-(\d{1,2}):(\d{2}):\d{2}$/);
  if (!m) return { start: "", end: "" };
  const to12 = (h: number, mm: string) => {
    const ampm = h >= 12 ? "PM" : "AM";
    let hr = h % 12; if (hr === 0) hr = 12;
    return `${hr}:${mm}${ampm}`;
  };
  return { start: to12(+m[1], m[2]), end: to12(+m[3], m[4]) };
}

async function fetchCategory(numCd: string, yr: string, org: string, title: string): Promise<string | null> {
  const url = `${ESFCC}?hptAppId=SR1099P&hptProgramPackage=PublicServices.Servlets.&hptExec=Y&hptRecord=SR1099UI1&hptUIRecordPackage=sr1099p.pkg.&HID_TERM_NUM_CD=${numCd}&HID_PASS_GROUP_CD=&HID_FAC_SITE_NUM=12&ORG_TITLE_NAM=${encodeURIComponent(title)}&ORG_CD=${org}&HID_TERM_YR=${yr}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 cc-courseMap", "Accept-Encoding": "identity" },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; } finally { clearTimeout(t); }
}

function parseCategoryHtml(html: string, fileTermCode: string): CourseSection[] {
  const sections: CourseSection[] = [];

  // Pass 1: find course headers "CODE <A...>...</A> TITLE" with positions
  const headers: Array<{ pos: number; prefix: string; number: string; title: string }> = [];
  const headerRe = /([A-Z]{3})(\d{4})\s*<A\s+href="[^"]*SR109[^"]*"[^>]*>[\s\S]*?<\/A>\s*([A-Za-z0-9][A-Za-z0-9 &/.\-]*?)\s*</gi;
  for (const m of html.matchAll(headerRe)) {
    headers.push({ pos: m.index!, prefix: m[1], number: m[2], title: decode(m[3]).slice(0, 60) });
  }
  if (headers.length === 0) return sections;

  // Pass 2: section rows — a 5-digit reg# cell followed by the section fields.
  // We scan the flat <td> list and reconstruct rows by the regNum anchor.
  const cells: Array<{ pos: number; text: string }> = [];
  for (const m of html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)) {
    const text = decode(m[1]);
    if (text) cells.push({ pos: m.index!, text });
  }

  const headerForPos = (pos: number) => {
    let best = headers[0];
    for (const h of headers) { if (h.pos <= pos) best = h; else break; }
    return best;
  };

  for (let i = 0; i < cells.length; i++) {
    if (!/^\d{5}$/.test(cells[i].text)) continue;
    const regNum = cells[i].text;
    const section = cells[i + 1]?.text || "";
    const status = cells[i + 2]?.text || "";
    if (!/^(Open|Closed|Wait)/i.test(status)) continue; // not a real section row
    const daysCell = cells[i + 3]?.text || "";
    if (!/^[MTWHFSU. ]{7}$/.test(daysCell.replace(/\s/g, "").padEnd(7, "."))) {
      // some online rows have empty days "......."
    }
    const days = parseDays(daysCell);
    const next = cells[i + 4]?.text || "";
    let startTime = "", endTime = "", location = "", mode = "in-person";
    if (/^\d{1,2}:\d{2}:\d{2}-/.test(next)) {
      const t = parseTime(next);
      startTime = t.start; endTime = t.end;
      location = cells[i + 5]?.text || "";
    } else {
      // online row: next cell is the location/web marker
      location = next;
    }
    if (/web|online|\*comp/i.test(location)) mode = "online";

    const h = headerForPos(cells[i].pos);
    const campusMatch = location.match(/^([A-Z]{2,4})\s/);
    sections.push({
      college_code: COLLEGE_SLUG,
      term: fileTermCode,
      course_prefix: h.prefix,
      course_number: h.number,
      course_title: h.title,
      credits: 3,
      crn: regNum,
      days,
      start_time: startTime,
      end_time: endTime,
      start_date: "",
      location: mode === "online" ? "" : location,
      campus: campusMatch ? campusMatch[1] : "",
      mode,
      instructor: null,
      seats_open: /open/i.test(status) ? 1 : 0,
      seats_total: null,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  }
  return sections;
}

async function scrapeTerm(termName: string, numCd: string, yr: string, fileTermCode: string, orgFilter: string | null): Promise<CourseSection[]> {
  console.log(`\n  ${termName} (cd=${numCd} yr=${yr})`);
  const cats = orgFilter ? SF_CATEGORIES.filter(c => c[0] === orgFilter) : SF_CATEGORIES;
  const all: CourseSection[] = [];
  const seenCrn = new Set<string>();
  for (let i = 0; i < cats.length; i++) {
    const [org, title] = cats[i];
    process.stdout.write(`  [${i + 1}/${cats.length}] ${org} ${title.slice(0, 18).padEnd(18)} `);
    const html = await fetchCategory(numCd, yr, org, title);
    if (!html) { console.log("→ (no response)"); await sleep(300); continue; }
    const parsed = parseCategoryHtml(html, fileTermCode);
    let added = 0;
    for (const s of parsed) {
      const key = `${s.crn}-${s.course_prefix}${s.course_number}`;
      if (seenCrn.has(key)) continue;
      seenCrn.add(key); all.push(s); added++;
    }
    console.log(`→ ${added}`);
    if ((i + 1) % 15 === 0 && all.length > 0) {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(path.join(DATA_DIR, `${fileTermCode}.partial.json`), JSON.stringify(all, null, 2) + "\n");
    }
    await sleep(250);
  }
  return all;
}

async function main() {
  const { terms, orgFilter } = parseArgs();
  console.log(`\nSanta Fe College — ${terms.join(", ")}`);
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  let total = 0;
  for (const termName of terms) {
    const cfg = TERM_MAP[termName];
    if (!cfg) { console.error(`Unknown term: ${termName}`); process.exit(1); }
    const sections = await scrapeTerm(termName, cfg.numCd, cfg.yr, cfg.file, orgFilter);
    if (sections.length > 0) {
      fs.writeFileSync(path.join(DATA_DIR, `${cfg.file}.json`), JSON.stringify(sections, null, 2) + "\n");
      const partial = path.join(DATA_DIR, `${cfg.file}.partial.json`);
      if (fs.existsSync(partial)) fs.unlinkSync(partial);
    }
    console.log(`\n  ${termName}: ${sections.length} sections`);
    total += sections.length;
  }
  console.log(`\nDone! ${total} sections total\n`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });

/**
 * scrape-lsc.ts — Lone Star College System (TX) class-section scraper.
 *
 * Background: LSC publishes a PS Classic CommunityAccess class-search behind
 * a guest auto-login at https://campus.lonestar.edu/classsearch.htm. Three
 * prior reverse-engineering sessions failed at what looked like a validation
 * gate — every search returned to the criteria-entry page. The 4th attempt
 * (2026-05-29) drove the real Chrome via the Claude extension and uncovered
 * the real cause: PS Classic enforces a 250-section result cap and renders
 * the error "Your search will exceed the maximum limit of 250 sections" on
 * the SAME page that always shows the static "Select at least 2 search
 * criteria" help text. The headless probes were matching the static text and
 * declaring failure. With the criteria narrowed enough to stay under 250,
 * search returns clean PS Classic result rows.
 *
 * Driver: Playwright (Classic ICAJAX postbacks need real JS + cookies).
 *
 * Strategy per term:
 *   1. Auto-login as guest (LSC_CS_SS_CLASSGUEST / Guest1) via classsearch.htm
 *   2. Navigate to COMMUNITY_ACCESS.CLASS_SEARCH.GBL
 *   3. For each (campus, subject) pair:
 *        - set term  (postback)
 *        - set career = CR (Credit) (postback)
 *        - set campus (postback)
 *        - set subject (no postback)
 *        - uncheck Open Classes Only (so we capture closed sections too)
 *        - click Search
 *        - if "exceed the maximum limit of 250" → split by catalog-nbr
 *          level (1XXX, 2XXX, 3XXX, 4XXX) and retry each slice
 *        - parse result rows: MTG_CLASS_NBR / MTG_CLASSNAME / MTG_DAYTIME /
 *          MTG_ROOM / MTG_INSTR / MTG_TOPIC + status-icon img alt
 *        - course title parsed from the <td> above each section group:
 *          "BIOL 2401 - Anatomy & Physiology I"
 *        - click "New Search" link, loop
 *
 * Output: data/tx/courses/lone-star-college-system/{TERM}.json
 *
 * Usage:
 *   npx tsx scripts/tx/scrape-lsc.ts                       # default term
 *   npx tsx scripts/tx/scrape-lsc.ts --term 1268           # 2026 Fall
 *   npx tsx scripts/tx/scrape-lsc.ts --campus CF           # single campus smoke
 *   npx tsx scripts/tx/scrape-lsc.ts --subjects BIOL,ENGL  # subject smoke
 *   npx tsx scripts/tx/scrape-lsc.ts --headed              # visible browser
 */

import { chromium, type Browser, type Page } from "playwright";
import * as fs from "fs";
import * as path from "path";

const SLUG = "lone-star-college-system";
const COLLEGE_CODE = SLUG;
const COURSES_DIR = path.join(process.cwd(), "data", "tx", "courses", SLUG);

const ENTRY_URL = "https://campus.lonestar.edu/classsearch.htm";
const SEARCH_URL =
  "https://campus.lonestar.edu/psc/csprd/EMPLOYEE/SA/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL";

const NAV_TIMEOUT = 60_000;
const POSTBACK_WAIT = 2500;
const SEARCH_WAIT = 8_000;
const PER_QUERY_DELAY = 200;

// PS Classic strm code → human file code.
// LSC's strm scheme: 1268 = 2026 Fall, 1266 = 2026 Summer, 1271 = 2027 Spring
const STRM_TO_FILE: Record<string, string> = {
  "1266": "2026SU",
  "1268": "2026FA",
  "1271": "2027SP",
  "1276": "2027SU",
};

// The 8 LSC campuses (matches the form's SSR_CLSRCH_WRK_CAMPUS$0 select).
const CAMPUS_CODES = [
  { code: "CF", name: "LSC-CyFair" },
  { code: "HN", name: "LSC-Houston North" },
  { code: "KC", name: "LSC-Kingwood" },
  { code: "MC", name: "LSC-Montgomery" },
  { code: "NH", name: "LSC-North Harris" },
  { code: "OL", name: "LSC-Online" },
  { code: "TC", name: "LSC-Tomball" },
  { code: "UP", name: "LSC-University Park" },
];

interface CourseSection {
  college_code: string;
  term: string;
  course_prefix: string;
  course_number: string;
  course_title: string;
  credits: number | null;
  crn: string;
  days: string;
  start_time: string;
  end_time: string;
  start_date: string;
  end_date: string;
  location: string;
  campus: string;
  mode: string;
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  status: string;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

interface Args {
  strm: string;
  termFile: string;
  termLabel: string;
  campusFilter: string[] | null;
  subjectsFilter: string[] | null;
  headed: boolean;
  maxQueries: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let strm = "1268";
  let campusFilter: string[] | null = null;
  let subjectsFilter: string[] | null = null;
  let headed = false;
  let maxQueries = Infinity;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--term" && argv[i + 1]) { strm = argv[++i]; }
    else if (a === "--campus" && argv[i + 1]) { campusFilter = argv[++i].split(","); }
    else if (a === "--subjects" && argv[i + 1]) { subjectsFilter = argv[++i].split(","); }
    else if (a === "--headed") { headed = true; }
    else if (a === "--max-queries" && argv[i + 1]) { maxQueries = parseInt(argv[++i], 10); }
  }
  const termFile = STRM_TO_FILE[strm];
  if (!termFile) {
    console.error(`Unknown strm code ${strm}. Known: ${Object.keys(STRM_TO_FILE).join(", ")}`);
    process.exit(1);
  }
  return { strm, termFile, termLabel: termFile, campusFilter, subjectsFilter, headed, maxQueries };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Auth + form prep
// ---------------------------------------------------------------------------

async function establishSession(page: Page): Promise<void> {
  await page.goto(ENTRY_URL, { waitUntil: "load", timeout: NAV_TIMEOUT });
  await sleep(3000);
}

async function gotoClassSearch(page: Page): Promise<void> {
  await page.goto(SEARCH_URL, { waitUntil: "load", timeout: NAV_TIMEOUT });
  await page.waitForSelector("#SSR_CLSRCH_WRK_SUBJECT_SRCH\\$4", { timeout: 30_000 });
  await sleep(1500);
}

async function getSubjectCodes(page: Page): Promise<Array<{ code: string; label: string }>> {
  return page.evaluate(() => {
    const s = document.getElementById("SSR_CLSRCH_WRK_SUBJECT_SRCH$4") as HTMLSelectElement;
    if (!s) return [] as Array<{ code: string; label: string }>;
    return Array.from(s.options)
      .filter((o) => o.value && o.value.trim() !== "")
      .map((o) => ({ code: o.value, label: o.text.trim() }));
  });
}

async function selectAndPostback(page: Page, id: string, val: string, waitMs = POSTBACK_WAIT): Promise<void> {
  await page.evaluate(({ id, val }) => {
    const el = document.getElementById(id) as HTMLSelectElement;
    if (!el) throw new Error(`element ${id} not found`);
    el.value = val;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, { id, val });
  await sleep(waitMs);
}

async function setValueNoPostback(page: Page, id: string, val: string): Promise<void> {
  await page.evaluate(({ id, val }) => {
    const el = document.getElementById(id) as HTMLSelectElement | HTMLInputElement | null;
    if (!el) throw new Error(`element ${id} not found`);
    (el as HTMLSelectElement).value = val;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, { id, val });
}

async function clickSearch(page: Page): Promise<void> {
  await page.evaluate(() => {
    (document.getElementById("CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH") as HTMLInputElement).click();
  });
  await sleep(SEARCH_WAIT);
}

async function dismissModalIfPresent(page: Page): Promise<void> {
  // The modal lives in an iframe named ptModFrame_0; OK button id is the
  // literal "#ICSave" (which means we need a double-escape in querySelector).
  for (let i = 0; i < 4; i++) {
    const handled = await page.evaluate(() => {
      const f = document.querySelector('iframe[name="ptModFrame_0"]') as HTMLIFrameElement | null;
      if (!f) return false;
      const doc = f.contentDocument;
      if (!doc) return false;
      const btn = doc.getElementById("#ICSave") as HTMLInputElement | null;
      if (!btn) return false;
      btn.click();
      return true;
    });
    if (!handled) return;
    await sleep(5000);
  }
}

async function clickNewSearch(page: Page): Promise<void> {
  // PS Classic puts "New Search" / "Modify Search" links somewhere — easier
  // to just navigate fresh to the search GBL.
  await gotoClassSearch(page);
}

// ---------------------------------------------------------------------------
// Result extraction
// ---------------------------------------------------------------------------

interface RawSection {
  classNbr: string;
  classname: string;
  daytime: string;
  room: string;
  instructor: string;
  meetingDates: string;
  status: string;
  courseHeader: string;
}

async function detectResultState(page: Page): Promise<"results" | "over-limit" | "no-classes" | "criteria"> {
  return page.evaluate(() => {
    const txt = document.body.innerText;
    if (/MTG_CLASS_NBR/.test(document.body.innerHTML)) return "results";
    if (txt.includes("exceed the maximum limit")) return "over-limit";
    if (/no classes (found|match)/i.test(txt) || txt.includes("Your search returned no classes")) return "no-classes";
    return "criteria";
  });
}

async function extractSections(page: Page): Promise<RawSection[]> {
  // Inline everything — tsx injects `__name(fn, "name")` wrappers around
  // function declarations inside page.evaluate, which page.evaluate can't
  // resolve. Use only literal expressions and `let`-bound arrow values.
  return page.evaluate(() => {
    const out: RawSection[] = [];
    const nbrEls: HTMLElement[] = [];
    {
      const all = document.querySelectorAll('[id^="MTG_CLASS_NBR$"]');
      for (let i = 0; i < all.length; i++) {
        const el = all[i] as HTMLElement;
        if (!el.id.includes("$span$")) nbrEls.push(el);
      }
    }
    for (let i = 0; i < nbrEls.length; i++) {
      const idx = nbrEls[i].id.replace("MTG_CLASS_NBR$", "");
      const tCN = (document.getElementById("MTG_CLASS_NBR$" + idx)?.textContent || "").trim();
      const tNAME = (document.getElementById("MTG_CLASSNAME$" + idx)?.textContent || "").trim();
      const tDT = (document.getElementById("MTG_DAYTIME$" + idx)?.textContent || "").trim();
      const tROOM = (document.getElementById("MTG_ROOM$" + idx)?.textContent || "").trim();
      const tINSTR = (document.getElementById("MTG_INSTR$" + idx)?.textContent || "").trim();
      const tTOPIC = (document.getElementById("MTG_TOPIC$" + idx)?.textContent || "").trim();
      let courseHeader = "";
      let cur: Element | null = nbrEls[i].closest("tr");
      while (cur && !courseHeader) {
        let prev = cur.previousElementSibling;
        while (prev) {
          const t = (prev.textContent || "").trim();
          const m = t.match(/^([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)\s+-\s+([^\n]{2,200})/);
          if (m) { courseHeader = m[1] + " " + m[2] + " - " + m[3]; break; }
          prev = prev.previousElementSibling;
        }
        cur = cur.parentElement;
      }
      let status = "";
      const tr = nbrEls[i].closest("tr");
      if (tr) {
        let scan: Element | null = tr;
        for (let depth = 0; depth < 4 && scan && !status; depth++) {
          const img = scan.querySelector('img[alt="Open"], img[alt="Closed"], img[alt="Wait List"]');
          if (img) status = (img as HTMLImageElement).alt;
          scan = scan.parentElement;
        }
      }
      out.push({
        classNbr: tCN,
        classname: tNAME,
        daytime: tDT,
        room: tROOM,
        instructor: tINSTR,
        meetingDates: tTOPIC,
        status: status,
        courseHeader: courseHeader,
      });
    }
    return out;
  });
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function parseCourseHeader(h: string): { prefix: string; number: string; title: string } | null {
  const m = h.match(/^([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)\s+-\s+(.+)$/);
  return m ? { prefix: m[1], number: m[2], title: m[3].trim() } : null;
}

function parseClassname(cn: string): { section: string; component: string; mode: string } {
  // e.g. "5001-LEC\nRegular" or "1234-LAB"
  const lines = cn.split("\n").map((s) => s.trim()).filter(Boolean);
  const head = lines[0] || "";
  const mode = lines[1] || "";
  const m = head.match(/^([^-]+)-([A-Z]+)$/);
  return { section: m?.[1] || head, component: m?.[2] || "", mode };
}

function parseDaytime(dt: string): { days: string; start: string; end: string } {
  // e.g. "MoWe 8:30AM - 9:50AM" or "TBA" or "Sa 9:00AM - 11:30AM"
  if (!dt || /^TBA$/i.test(dt)) return { days: "", start: "", end: "" };
  const m = dt.match(/^([A-Za-z]+)\s+(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)$/);
  if (m) return { days: m[1], start: m[2].replace(/\s+/g, ""), end: m[3].replace(/\s+/g, "") };
  return { days: dt, start: "", end: "" };
}

function parseDates(d: string): { start: string; end: string } {
  // e.g. "08/24/2026 - 12/13/2026"
  const m = d.match(/(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})/);
  return { start: m?.[1] || "", end: m?.[2] || "" };
}

function rawToSection(r: RawSection, opts: { campusName: string; term: string }): CourseSection | null {
  const ch = parseCourseHeader(r.courseHeader);
  if (!ch) return null;
  const cn = parseClassname(r.classname);
  const dt = parseDaytime(r.daytime);
  const dates = parseDates(r.meetingDates);
  return {
    college_code: COLLEGE_CODE,
    term: opts.term,
    course_prefix: ch.prefix,
    course_number: ch.number,
    course_title: ch.title,
    credits: null,
    crn: r.classNbr,
    days: dt.days,
    start_time: dt.start,
    end_time: dt.end,
    start_date: dates.start,
    end_date: dates.end,
    location: r.room,
    campus: opts.campusName,
    mode: cn.mode,
    instructor: r.instructor || null,
    seats_open: null,
    seats_total: null,
    status: r.status,
    prerequisite_text: null,
    prerequisite_courses: [],
  };
}

// ---------------------------------------------------------------------------
// Query orchestration
// ---------------------------------------------------------------------------

// PS Classic supports only C(ontains)/E(xact)/G(reater-or-equal)/T(less-or-equal)
// on the catalog-nbr field — no "begins with". Split by halves of the LSC
// catalog range: ≤1999 captures 1XXX freshman courses, ≥2000 captures 2XXX
// sophomore courses (LSC catalog rarely goes higher).
const CATALOG_SPLITS: Array<{ op: string; nbr: string; label: string }> = [
  { op: "T", nbr: "1999", label: "L1" },
  { op: "G", nbr: "2000", label: "L2" },
];

async function runOneQuery(
  page: Page,
  strm: string,
  campusCode: string,
  subject: string,
  catalogLevel: { op: string; nbr: string; label: string } | null,
): Promise<RawSection[]> {
  // Order matters: every onchange-postback resets chgFldArr_win0 on the
  // server side, so fields set with no postback (subject, catalog nbr) MUST
  // come AFTER the postback-triggering fields. Set subject LAST.
  await selectAndPostback(page, "CLASS_SRCH_WRK2_STRM$35$", strm);
  await selectAndPostback(page, "SSR_CLSRCH_WRK_ACAD_CAREER$2", "CR");
  await selectAndPostback(page, "SSR_CLSRCH_WRK_CAMPUS$0", campusCode);
  // Leave Open Classes Only checked (default Y). Unchecking it triggers a
  // PS modal warning when results would exceed 250 — easier to keep on and
  // accept that we miss closed/full sections.
  if (catalogLevel) {
    await page.evaluate(({ op, nbr }) => {
      const opEl = document.getElementById("SSR_CLSRCH_WRK_SSR_EXACT_MATCH1$5") as HTMLSelectElement;
      opEl.value = op;
      opEl.dispatchEvent(new Event("change", { bubbles: true }));
      const nbrEl = document.getElementById("SSR_CLSRCH_WRK_CATALOG_NBR$5") as HTMLInputElement;
      nbrEl.value = nbr;
      nbrEl.dispatchEvent(new Event("change", { bubbles: true }));
    }, catalogLevel);
    await sleep(1500);
  }
  // Subject last — dispatching change fires PS's inline onchange handler
  // which calls submitAction_win0 (an async ICAJAX postback). Wait long
  // enough for that to drain before clicking Search, otherwise the postback
  // races the click and the form is re-rendered without subject.
  await setValueNoPostback(page, "SSR_CLSRCH_WRK_SUBJECT_SRCH$4", subject);
  await sleep(2000);
  await clickSearch(page);
  // Dismiss the PS "Student SS Warning" modal if it appears (over-limit or
  // session-timeout warning). The OK button is rendered with the literal id
  // "#ICSave" inside the ptModFrame_0 iframe.
  await dismissModalIfPresent(page);
  const state = await detectResultState(page);
  console.log(`      [${subject}@${campusCode}${catalogLevel ? `/${catalogLevel.label}` : ""}] state=${state}`);
  if (state === "results") return extractSections(page);
  if (state === "over-limit") throw new Error("OVER_LIMIT");
  // Debug: dump page text snippet when in unexpected state.
  if (process.env.LSC_DEBUG) {
    const snippet = await page.evaluate(() => ({
      bodyText: document.body.innerText.substring(0, 1000),
      subjectVal: (document.getElementById("SSR_CLSRCH_WRK_SUBJECT_SRCH$4") as HTMLSelectElement)?.value,
      campusVal: (document.getElementById("SSR_CLSRCH_WRK_CAMPUS$0") as HTMLSelectElement)?.value,
      careerVal: (document.getElementById("SSR_CLSRCH_WRK_ACAD_CAREER$2") as HTMLSelectElement)?.value,
      termVal: (document.getElementById("CLASS_SRCH_WRK2_STRM$35$") as HTMLSelectElement)?.value,
      icState: (document.getElementById("ICStateNum") as HTMLInputElement)?.value,
    }));
    console.log("      DEBUG:", JSON.stringify(snippet, null, 2).substring(0, 800));
  }
  return [];
}

async function searchSubjectAtCampus(
  page: Page,
  strm: string,
  campus: { code: string; name: string },
  subject: string,
): Promise<CourseSection[]> {
  const sections: CourseSection[] = [];
  const seenCRNs = new Set<string>();
  const tryQuery = async (level: { op: string; nbr: string; label: string } | null) => {
    await clickNewSearch(page);
    let raw: RawSection[];
    try {
      raw = await runOneQuery(page, strm, campus.code, subject, level);
    } catch (e) {
      if ((e as Error).message === "OVER_LIMIT") {
        if (level === null) {
          for (const lvl of CATALOG_SPLITS) {
            await tryQuery(lvl);
          }
          return;
        }
        console.warn(`    ⚠ over-limit even at split ${level.label} for ${subject}@${campus.code}, dropping`);
        return;
      }
      throw e;
    }
    for (const r of raw) {
      if (!r.classNbr || seenCRNs.has(r.classNbr)) continue;
      seenCRNs.add(r.classNbr);
      const s = rawToSection(r, { campusName: campus.name, term: STRM_TO_FILE[strm] });
      if (s) sections.push(s);
    }
  };
  await tryQuery(null);
  return sections;
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs();
  fs.mkdirSync(COURSES_DIR, { recursive: true });
  const outPath = path.join(COURSES_DIR, `${args.termFile}.json`);

  console.log(`LSC scraper — term ${args.strm} (${args.termFile}) → ${outPath}`);
  if (args.campusFilter) console.log(`  campus filter: ${args.campusFilter.join(",")}`);
  if (args.subjectsFilter) console.log(`  subject filter: ${args.subjectsFilter.join(",")}`);

  const browser: Browser = await chromium.launch({ headless: !args.headed });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  });
  const page = await ctx.newPage();

  try {
    console.log("→ guest auth");
    await establishSession(page);
    console.log("→ load class search");
    await gotoClassSearch(page);
    const subjects = await getSubjectCodes(page);
    console.log(`→ ${subjects.length} subjects`);

    const targetSubjects = args.subjectsFilter
      ? subjects.filter((s) => args.subjectsFilter!.includes(s.code))
      : subjects;
    const targetCampuses = args.campusFilter
      ? CAMPUS_CODES.filter((c) => args.campusFilter!.includes(c.code))
      : CAMPUS_CODES;

    const allSections: CourseSection[] = [];
    const seenAcrossCampuses = new Set<string>(); // crn-level dedupe
    let queries = 0;
    for (const campus of targetCampuses) {
      console.log(`\n=== ${campus.name} (${campus.code}) ===`);
      for (const subj of targetSubjects) {
        if (queries >= args.maxQueries) break;
        queries++;
        try {
          const found = await searchSubjectAtCampus(page, args.strm, campus, subj.code);
          let added = 0;
          for (const s of found) {
            if (seenAcrossCampuses.has(s.crn)) continue;
            seenAcrossCampuses.add(s.crn);
            allSections.push(s);
            added++;
          }
          if (added > 0) console.log(`  ${subj.code}: +${added} (${found.length} raw)`);
        } catch (e) {
          console.error(`  ${subj.code}@${campus.code} failed:`, (e as Error).message);
        }
        await sleep(PER_QUERY_DELAY);
      }
      if (queries >= args.maxQueries) break;
    }

    fs.writeFileSync(outPath, JSON.stringify(allSections, null, 2));
    console.log(`\n✓ wrote ${allSections.length} sections (${queries} queries) → ${outPath}`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

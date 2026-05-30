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

// Checkpoints are written to a STABLE path outside any git worktree. A prior
// 10-hour run died when its worktree was pruned mid-run (a parallel session's
// cleanup) and the next checkpoint write hit ENOENT. /tmp survives worktree
// pruning and session archival, so it is the source of truth during a run;
// the worktree COURSES_DIR copy is mirrored best-effort and refreshed at the
// end for the PR.
const STABLE_DIR = "/tmp/lsc-progress";

const ENTRY_URL = "https://campus.lonestar.edu/classsearch.htm";
const SEARCH_URL =
  "https://campus.lonestar.edu/psc/csprd/EMPLOYEE/SA/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL";

const NAV_TIMEOUT = 60_000;
const POSTBACK_WAIT = 2500;
const SEARCH_TIMEOUT = 15_000; // max poll for a definitive outcome (fresh results render <8s; a stuck Modify-path large subject bails here and the fresh-reload retry recovers it)
const MODIFY_WAIT = 4_000; // "Modify Search" in-place postback back to criteria
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

// Click Search, then POLL for a definitive outcome instead of a fixed sleep.
// Large result sets (near the 250 cap, e.g. BIOL/ENGL) render slower than any
// safe fixed wait — a fixed sleep + immediate detect saw the still-rendering
// page as "criteria" and silently dropped the whole subject. Polling returns
// as soon as the table, the over-limit banner, or the no-results message
// appears (fast for small subjects, patient for big ones), dismissing the
// session-timeout modal if it interrupts.
async function clickSearchAndDetect(
  page: Page,
): Promise<"results" | "over-limit" | "no-classes" | "criteria"> {
  await page.evaluate(() => {
    (document.getElementById("CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH") as HTMLInputElement).click();
  });
  const deadline = Date.now() + SEARCH_TIMEOUT;
  let last: "results" | "over-limit" | "no-classes" | "criteria" = "criteria";
  // Date.now() is unavailable in workflow scripts but fine in a plain tsx run.
  while (Date.now() < deadline) {
    await sleep(1000);
    await dismissModalIfPresent(page);
    last = await detectResultState(page);
    if (last === "results" || last === "over-limit" || last === "no-classes") return last;
  }
  return last; // "criteria" — genuinely stuck
}

async function dismissModalIfPresent(page: Page): Promise<void> {
  // PS pops a confirmation modal — "Your search will return over 50 classes,
  // would you like to continue?" — for any subject with >50 sections, plus a
  // periodic "Student SS Warning" session-timeout modal. Both live in an
  // iframe named ptModFrame_0 with an OK button whose id is the literal
  // "#ICSave". Reaching into iframe.contentDocument from page.evaluate is
  // unreliable in headless Chromium (it silently no-ops), which previously
  // left big subjects like BIOL stuck behind an undismissed modal. Use
  // Playwright's native frame API + an attribute selector instead.
  for (let i = 0; i < 5; i++) {
    const frame = page.frames().find((f) => f.name() === "ptModFrame_0");
    if (!frame) return;
    const ok = frame.locator('[id="#ICSave"]');
    if ((await ok.count().catch(() => 0)) === 0) return;
    await ok.click({ timeout: 5000 }).catch(() => { /* modal may have closed */ });
    await sleep(3000);
  }
}

// Fresh-load the criteria form and set the three constant fields (term,
// career, campus) ONCE per campus. Within a campus we never reload or re-set
// these — we return to criteria via the in-place "Modify Search" button,
// which retains them (verified empirically 2026-05-29).
async function setupCampus(page: Page, strm: string, campusCode: string): Promise<void> {
  await gotoClassSearch(page);
  await selectAndPostback(page, "CLASS_SRCH_WRK2_STRM$35$", strm);
  await selectAndPostback(page, "SSR_CLSRCH_WRK_ACAD_CAREER$2", "CR");
  await selectAndPostback(page, "SSR_CLSRCH_WRK_CAMPUS$0", campusCode);
}

// Ensure we're on the criteria-entry form. Over-limit responses already land
// there (subject field present). A results page does not — click the in-place
// "Modify Search" button (retains term/career/campus) rather than reloading.
async function ensureOnCriteria(page: Page): Promise<void> {
  const has = await page.$('#SSR_CLSRCH_WRK_SUBJECT_SRCH\\$4');
  if (has) return;
  await page.evaluate(() => {
    const b = document.getElementById("CLASS_SRCH_WRK2_SSR_PB_MODIFY") as HTMLInputElement | null;
    if (b) b.click();
  });
  await sleep(MODIFY_WAIT);
  await page.waitForSelector('#SSR_CLSRCH_WRK_SUBJECT_SRCH\\$4', { timeout: 20_000 });
}

// Blank the narrowing fields (catalog-nbr + instruction-mode) so a prior
// subject's split filters don't leak into the next subject. Modify Search
// retains everything, so this must run before each fresh subject.
async function clearNarrowing(page: Page): Promise<void> {
  await page.evaluate(() => {
    const nbr = document.getElementById("SSR_CLSRCH_WRK_CATALOG_NBR$5") as HTMLInputElement | null;
    if (nbr && nbr.value) { nbr.value = ""; nbr.dispatchEvent(new Event("change", { bubbles: true })); }
    const mode = document.getElementById("SSR_CLSRCH_WRK_INSTRUCTION_MODE$1") as HTMLSelectElement | null;
    if (mode && mode.value) { mode.value = ""; mode.dispatchEvent(new Event("change", { bubbles: true })); }
  });
  await sleep(1200);
}

// Self-heal: re-set any of the three constant fields that drifted over a long
// per-campus run (session churn occasionally clears one). Cheap (3 reads).
async function verifyContext(page: Page, strm: string, campusCode: string): Promise<void> {
  const ctx = await page.evaluate(() => ({
    term: (document.getElementById("CLASS_SRCH_WRK2_STRM$35$") as HTMLSelectElement | null)?.value,
    career: (document.getElementById("SSR_CLSRCH_WRK_ACAD_CAREER$2") as HTMLSelectElement | null)?.value,
    campus: (document.getElementById("SSR_CLSRCH_WRK_CAMPUS$0") as HTMLSelectElement | null)?.value,
  }));
  if (ctx.term !== strm) await selectAndPostback(page, "CLASS_SRCH_WRK2_STRM$35$", strm);
  if (ctx.career !== "CR") await selectAndPostback(page, "SSR_CLSRCH_WRK_ACAD_CAREER$2", "CR");
  if (ctx.campus !== campusCode) await selectAndPostback(page, "SSR_CLSRCH_WRK_CAMPUS$0", campusCode);
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

// Result states:
//   results    — section rows present
//   over-limit — >250 cap hit; caller splits further
//   no-classes — server confirmed zero matches (genuine empty: do NOT retry)
//   criteria   — back on the entry form with no result/empty message, i.e. the
//                search did not execute (subject dropped by an ICAJAX race) —
//                this is a transient failure the caller should retry.
async function detectResultState(page: Page): Promise<"results" | "over-limit" | "no-classes" | "criteria"> {
  return page.evaluate(() => {
    const txt = document.body.innerText;
    if (/MTG_CLASS_NBR/.test(document.body.innerHTML)) return "results";
    if (txt.includes("exceed the maximum limit")) return "over-limit";
    if (
      /no classes (found|match)/i.test(txt) ||
      txt.includes("Your search returned no classes") ||
      /returns? no results that match/i.test(txt)
    ) return "no-classes";
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
// on the catalog-nbr field — no "begins with", no range AND-ing. Tier 1
// fallback splits by the obvious ≤1999 / ≥2000 halves.
const CATALOG_SPLITS: Array<{ op: string; nbr: string; label: string }> = [
  { op: "T", nbr: "1999", label: "L1" },
  { op: "G", nbr: "2000", label: "L2" },
];

// Tier 2 fallback — when catalog-level is still over-limit (typical for the
// continuing-ed ABEAC / ENGLC subjects), split further by INSTRUCTION_MODE.
// The mode field is independent of catalog-nbr, so we can stack both filters
// (catalog level + mode) for a quarter-or-finer slice. 8 modes × 2 levels =
// 16 sub-queries per truly over-limit subject (worst case).
const INSTRUCTION_MODES: Array<{ code: string; label: string }> = [
  { code: "P",  label: "F2F" },        // In Person - Face to Face
  { code: "H",  label: "Hybrid" },     // Hybrid - In Person & Online
  { code: "FL", label: "Hyflex" },     // Hyflex in Person or Virtually
  { code: "OA", label: "OnlineAsync" }, // Online Asynchronous
  { code: "OS", label: "OnlineSync" },  // Online Synchronous
  { code: "OL", label: "Online" },      // Online (legacy)
  { code: "I",  label: "Indep" },       // Independent Study
];

async function runOneQuery(
  page: Page,
  strm: string,
  campusCode: string,
  subject: string,
  catalogLevel: { op: string; nbr: string; label: string } | null,
  modeCode: string | null = null,
): Promise<RawSection[]> {
  // term / career / campus are set ONCE per campus by setupCampus and retained
  // across subjects via Modify Search. Each attempt returns to the criteria
  // form, clears the prior subject's narrowing, self-heals drifted context,
  // then sets this query's narrowing + subject. Subject is set LAST: its
  // onchange fires an ICAJAX postback, and any postback-triggering field set
  // afterward would reset chgFldArr_win0 and drop the subject from the submit.
  //
  // A "criteria" result means the search didn't execute (the subject onchange
  // postback raced the search click and the subject was dropped — observed on
  // the 3rd+ in-place iteration). We retry it once with a longer settle before
  // giving up. "no-classes" is a confirmed empty set and is NOT retried.
  const tag = `${subject}@${campusCode}${catalogLevel ? `/${catalogLevel.label}` : ""}${modeCode ? `/m=${modeCode}` : ""}`;
  const MAX_ATTEMPTS = 2;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const settle = attempt === 1 ? 2000 : 4000;
    // Attempt 1 uses the fast in-place path (Modify Search retains term/career/
    // campus). The >50-results confirmation modal is reliably dismissed on a
    // FRESH form but intermittently sticks when reached via Modify Search for
    // large subjects — so attempt 2 does a full fresh reload + campus re-setup,
    // which is the proven path (BIOL@CF=181 works fresh). Net: fast for the
    // many small subjects, reliable for the ~15-30 large ones per campus.
    if (attempt === 1) {
      await ensureOnCriteria(page);
      await clearNarrowing(page);
      await verifyContext(page, strm, campusCode);
    } else {
      await setupCampus(page, strm, campusCode);
    }
    // Leave Open Classes Only checked (default Y). Unchecking it triggers a PS
    // modal warning when results would exceed 250 — easier to keep on and
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
    if (modeCode) {
      await page.evaluate((code) => {
        const el = document.getElementById("SSR_CLSRCH_WRK_INSTRUCTION_MODE$1") as HTMLSelectElement;
        el.value = code;
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }, modeCode);
      await sleep(1500);
    }
    await setValueNoPostback(page, "SSR_CLSRCH_WRK_SUBJECT_SRCH$4", subject);
    await sleep(settle);
    const state = await clickSearchAndDetect(page);
    console.log(`      [${tag}] state=${state}${attempt > 1 ? ` (retry ${attempt})` : ""}`);
    if (state === "results") return extractSections(page);
    if (state === "over-limit") throw new Error("OVER_LIMIT");
    if (state === "no-classes") return [];
    // state === "criteria": transient failure. Retry unless out of attempts.
    if (attempt === MAX_ATTEMPTS) {
      console.warn(`    ⚠ ${tag} stuck on criteria after ${MAX_ATTEMPTS} attempts — skipping`);
      return [];
    }
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
  const ingest = (raw: RawSection[]) => {
    for (const r of raw) {
      if (!r.classNbr || seenCRNs.has(r.classNbr)) continue;
      seenCRNs.add(r.classNbr);
      const s = rawToSection(r, { campusName: campus.name, term: STRM_TO_FILE[strm] });
      if (s) sections.push(s);
    }
  };
  // Tier 3 (deepest): catalog-level AND instruction-mode. runOneQuery returns
  // to the criteria form in-place (Modify Search) — no full reload needed.
  const tryWithMode = async (level: { op: string; nbr: string; label: string }) => {
    for (const mode of INSTRUCTION_MODES) {
      try {
        ingest(await runOneQuery(page, strm, campus.code, subject, level, mode.code));
      } catch (e) {
        if ((e as Error).message === "OVER_LIMIT") {
          console.warn(`    ⚠ over-limit even at ${level.label}/m=${mode.code} for ${subject}@${campus.code}, dropping`);
          continue;
        }
        throw e;
      }
    }
  };
  // Tier 2: catalog-level only. Falls back to tier 3 if still over-limit.
  const tryAtLevel = async (level: { op: string; nbr: string; label: string }) => {
    try {
      ingest(await runOneQuery(page, strm, campus.code, subject, level));
    } catch (e) {
      if ((e as Error).message === "OVER_LIMIT") {
        await tryWithMode(level);
        return;
      }
      throw e;
    }
  };
  // Tier 1: no catalog filter. Falls back to per-level tier 2.
  try {
    ingest(await runOneQuery(page, strm, campus.code, subject, null));
  } catch (e) {
    if ((e as Error).message !== "OVER_LIMIT") throw e;
    for (const lvl of CATALOG_SPLITS) await tryAtLevel(lvl);
  }
  return sections;
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs();
  fs.mkdirSync(COURSES_DIR, { recursive: true });
  fs.mkdirSync(STABLE_DIR, { recursive: true });
  const outPath = path.join(COURSES_DIR, `${args.termFile}.json`);
  // Source-of-truth checkpoint files live in STABLE_DIR (survives worktree
  // pruning). The worktree copy is mirrored best-effort.
  const stableData = path.join(STABLE_DIR, `${args.termFile}.json`);
  const stableProg = path.join(STABLE_DIR, `${args.termFile}.progress.json`);

  console.log(`LSC scraper — term ${args.strm} (${args.termFile})`);
  console.log(`  checkpoint: ${stableData}`);
  console.log(`  worktree:   ${outPath}`);
  if (args.campusFilter) console.log(`  campus filter: ${args.campusFilter.join(",")}`);
  if (args.subjectsFilter) console.log(`  subject filter: ${args.subjectsFilter.join(",")}`);

  // Resume: seed sections + completed (campus|subject) pairs from a prior run.
  const allSections: CourseSection[] = [];
  const seenAcrossCampuses = new Set<string>(); // crn-level dedupe
  const completedPairs = new Set<string>();
  if (fs.existsSync(stableData) && fs.existsSync(stableProg)) {
    try {
      for (const s of JSON.parse(fs.readFileSync(stableData, "utf-8")) as CourseSection[]) {
        if (s.crn && !seenAcrossCampuses.has(s.crn)) { seenAcrossCampuses.add(s.crn); allSections.push(s); }
      }
      for (const k of JSON.parse(fs.readFileSync(stableProg, "utf-8")) as string[]) completedPairs.add(k);
      console.log(`→ resumed: ${allSections.length} sections, ${completedPairs.size} pairs done`);
    } catch (e) {
      console.warn(`→ resume failed (${(e as Error).message}); starting fresh`);
    }
  }

  const writeCheckpoint = () => {
    const json = JSON.stringify(allSections, null, 2);
    fs.writeFileSync(stableData, json);
    fs.writeFileSync(stableProg, JSON.stringify(Array.from(completedPairs), null, 2));
    // Mirror into the worktree; ignore failure if the dir was pruned.
    try { fs.writeFileSync(outPath, json); } catch { /* worktree gone — stable copy is canonical */ }
  };

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

    let queries = 0;
    for (const campus of targetCampuses) {
      // Skip a campus entirely if every subject is already done (resume).
      const remaining = targetSubjects.filter((s) => !completedPairs.has(`${campus.code}|${s.code}`));
      if (remaining.length === 0) { console.log(`\n=== ${campus.name} (${campus.code}) — all done, skip ===`); continue; }

      console.log(`\n=== ${campus.name} (${campus.code}) — ${remaining.length} subjects ===`);
      // Set term + career + campus ONCE for this campus.
      await setupCampus(page, args.strm, campus.code);

      for (const subj of remaining) {
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
          // A hard failure may have left us on an unknown page — re-establish
          // the campus context so the next subject starts clean.
          try { await setupCampus(page, args.strm, campus.code); } catch { /* best effort */ }
        }
        completedPairs.add(`${campus.code}|${subj.code}`);
        writeCheckpoint();
        await sleep(PER_QUERY_DELAY);
      }
      if (queries >= args.maxQueries) break;
    }

    writeCheckpoint();
    console.log(`\n✓ wrote ${allSections.length} sections (${queries} queries this run)`);
    console.log(`  → ${stableData}`);
    console.log(`  → ${outPath}`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

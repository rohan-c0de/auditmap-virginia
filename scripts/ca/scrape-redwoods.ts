/**
 * scrape-redwoods.ts — College of the Redwoods class schedule scraper
 *
 * College of the Redwoods (Eureka, CA) runs a legacy Ellucian WebAdvisor
 * GUEST "Search for Classes" page — no login required (the page itself states
 * "No log in is required").
 *
 *   Entry: https://webadvisor.redwoods.edu/WAPROD/WebAdvisor?TYPE=P&PID=ST-XWESTS12A&CONSTITUENCY=WBST
 *
 * WebAdvisor mints its request token (TOKENIDX) client-side, so plain curl
 * returns only a ~450-byte JS shell. The page must be driven with a real
 * browser (Playwright/chromium). The flow:
 *
 *   1. GET the Search-for-Classes page (PID=ST-XWESTS12A).
 *   2. Select the term in <select id="VAR1"> and up to three subject codes in
 *      <select id="LIST_VAR1_1..3">, then submit the form.
 *      - VAR1 term codes:  2026S=Spring 2026, 2026X=Summer 2026, 2026F=Fall 2026,
 *                          2027S=Spring 2027  (read live from the dropdown).
 *      - LIST.VAR1_n = subject codes (ADCT, AFAM, AG, … read live, never hardcoded).
 *   3. Results render in a GWT data grid. Each <tr> has 9 cells:
 *        [0] row index   [1] Term            [2] Class Name + Title (anchor)
 *        [3] Meeting Information           [4] Campus       [5] Faculty
 *        [6] Status      [7] Credits        [8] Comments
 *      Class-name cell: "ENGL-C1000-D1571 (061571) Academic Reading and Writing"
 *        → prefix ENGL, number C1000, section D1571, SYNONYM/CRN 061571, title …
 *      Meeting cell may hold multiple "MM/DD/YYYY-MM/DD/YYYY DAYS TIME, ROOM"
 *        blocks; we take the first dated block with real days/times for the
 *        primary meeting, but merge room/days across blocks where present.
 *   4. Pagination: a GWT <button class="pagingbutton">Next</button>; click it
 *      until "Page N of N" stops advancing.
 *
 * WebAdvisor exposes Status (Open / Closed / Waitlisted / Waitlist Full) but
 * NOT numeric seat counts, so seats_open / seats_total are null.
 *
 * Output: data/ca/courses/college-of-the-redwoods/<TERM>.json
 *   TERM file stems: Fall→2026FA, Spring→2026SP, Summer→2026SU.
 *
 * Usage:
 *   npx tsx scripts/ca/scrape-redwoods.ts
 *   npx tsx scripts/ca/scrape-redwoods.ts --term "Fall 2026"
 *   npx tsx scripts/ca/scrape-redwoods.ts --term "Fall 2026,Spring 2026"
 *   npx tsx scripts/ca/scrape-redwoods.ts --term "Fall 2026" --subject ENGL
 *   npx tsx scripts/ca/scrape-redwoods.ts --term "Fall 2026" --subject EDUC,ENGL,ENGR --merge
 *   npx tsx scripts/ca/scrape-redwoods.ts --headed
 *
 * Flags:
 *   --term "<names>"     comma-separated term display names (default: all
 *                        Spring/Summer/Fall terms the dropdown publishes).
 *   --subject "<codes>"  comma-separated subject codes to limit the scrape to.
 *   --merge              fold scraped rows into the existing term file by CRN
 *                        instead of overwriting it (use to recover a subject
 *                        batch that transiently returned zero rows).
 *   --headed             run a visible browser (debugging).
 */

import { chromium, type Browser, type Page } from "playwright";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ENTRY =
  "https://webadvisor.redwoods.edu/WAPROD/WebAdvisor?TYPE=P&PID=ST-XWESTS12A&CONSTITUENCY=WBST";

const COLLEGE_SLUG = "college-of-the-redwoods";
const DATA_DIR = path.join(process.cwd(), "data", "ca", "courses", COLLEGE_SLUG);

const NAV_TIMEOUT = 60_000;
const RESULTS_WAIT = 45_000;
const INTER_SEARCH_DELAY = 900;
const SUBJECTS_PER_SEARCH = 3; // form exposes LIST.VAR1_1..3
const MAX_PAGES = 60; // hard ceiling on pagination loop per search
const MAX_RETRIES = 2;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// Term display name → output file stem. WebAdvisor's VAR1 code is read live
// from the dropdown so we never hardcode it (Summer is 2026X, not 2026SU).
const TERM_FILE_STEMS: Record<string, string> = {
  spring: "SP",
  summer: "SU",
  fall: "FA",
};

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
  mode: "in-person" | "online" | "hybrid" | "zoom";
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

interface RawRow {
  classCell: string; // "ENGL-C1000-D1571 (061571) Academic Reading and Writing"
  meeting: string; // dates/days/times/room (possibly multiple blocks)
  campus: string; // "Eureka Campus" / "Online Classes" / …
  faculty: string;
  status: string;
  credits: string;
  comments: string;
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]) {
  const out: {
    terms?: string[];
    subjects?: string[];
    merge: boolean;
    headed: boolean;
  } = {
    merge: false,
    headed: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--term" && argv[i + 1]) {
      out.terms = argv[++i]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a === "--subject" && argv[i + 1]) {
      // Accepts a single subject or a comma-separated list (e.g. EDUC,ENGL,ENGR).
      out.subjects = argv[++i]
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
    } else if (a === "--merge") {
      // Merge scraped rows into the existing term file (by CRN) instead of
      // overwriting it. Used to recover a subject batch that transiently
      // returned zero rows during a full run, without re-scraping the term.
      out.merge = true;
    } else if (a === "--headed") {
      out.headed = true;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Term mapping
// ---------------------------------------------------------------------------

/** Map a VAR1 option label ("Fall 2026") to an output file stem ("2026FA"). */
function fileStemForLabel(label: string): string | null {
  const m = label.match(/^(Spring|Summer|Fall|Winter)\s+(\d{4})$/i);
  if (!m) return null;
  const season = m[1].toLowerCase();
  const year = m[2];
  const stem = TERM_FILE_STEMS[season];
  if (!stem) return null; // Winter intentionally unsupported by the contract
  return `${year}${stem}`;
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

const DAY_ORDER = ["M", "Tu", "W", "Th", "F", "Sa", "Su"];

/**
 * Normalize WebAdvisor day tokens to the contract tokens
 * (M Tu W Th F Sa Su). WebAdvisor uses: M, T, W, TH, F, S, SU and the
 * concatenated form "MW", "TTH", "MWF", etc.
 */
function normalizeDays(raw: string): string {
  if (!raw) return "";
  const s = raw.trim().toUpperCase();
  if (!s || /N\/A/.test(s)) return "";
  const set = new Set<string>();
  // Greedy longest-match scan so TH/SU consume before T/S.
  let i = 0;
  while (i < s.length) {
    const two = s.slice(i, i + 2);
    if (two === "TH") {
      set.add("Th");
      i += 2;
      continue;
    }
    if (two === "SU") {
      set.add("Su");
      i += 2;
      continue;
    }
    const c = s[i];
    if (c === "M") set.add("M");
    else if (c === "T") set.add("Tu");
    else if (c === "W") set.add("W");
    else if (c === "F") set.add("F");
    else if (c === "S") set.add("Sa");
    // skip spaces, commas, anything else
    i += 1;
  }
  return DAY_ORDER.filter((d) => set.has(d)).join("");
}

/** "08:30AM" → "08:30 AM"; "01:05PM" → "01:05 PM". null if N/A. */
function normalizeTime(raw: string): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]} ${m[3].toUpperCase()}`;
}

/** "08/22/2026" → "2026-08-22". null if unparseable. */
function normalizeDate(raw: string): string | null {
  const m = raw.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1]}-${m[2]}`;
}

interface MeetingParse {
  start_date: string | null;
  days: string;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
}

/**
 * Parse the meeting-information cell. WebAdvisor format per block:
 *   "MM/DD/YYYY-MM/DD/YYYY DAYS HH:MMAM - HH:MMPM, BLDG Room ROOM"
 * or for async/online:
 *   "MM/DD/YYYY-MM/DD/YYYY Days N/A, Times N/A, Room N/A"
 * Multiple blocks may be concatenated (e.g. a hybrid with an in-person block
 * plus an online block). We choose the first block that has real days/times as
 * the primary meeting; if none has times, fall back to the first block for
 * dates and location.
 */
function parseMeeting(cell: string): MeetingParse {
  const empty: MeetingParse = {
    start_date: null,
    days: "",
    start_time: null,
    end_time: null,
    location: null,
  };
  if (!cell) return empty;

  // Split into per-meeting blocks. Each block begins with a date range.
  const blocks: string[] = [];
  const dateRe = /\d{2}\/\d{2}\/\d{4}-\d{2}\/\d{2}\/\d{4}/g;
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = dateRe.exec(cell)) !== null) starts.push(m.index);
  if (starts.length === 0) {
    blocks.push(cell.trim());
  } else {
    for (let i = 0; i < starts.length; i++) {
      const from = starts[i];
      const to = i + 1 < starts.length ? starts[i + 1] : cell.length;
      blocks.push(cell.slice(from, to).trim());
    }
  }

  const parsed: MeetingParse[] = blocks.map((b) => {
    const res: MeetingParse = { ...empty };
    const dm = b.match(/(\d{2}\/\d{2}\/\d{4})-(\d{2}\/\d{2}\/\d{4})/);
    if (dm) res.start_date = normalizeDate(dm[1]);

    // Time range: "08:30AM - 09:55AM"
    const tm = b.match(
      /(\d{1,2}:\d{2}\s*[AaPp][Mm])\s*-\s*(\d{1,2}:\d{2}\s*[AaPp][Mm])/
    );
    if (tm) {
      res.start_time = normalizeTime(tm[1]);
      res.end_time = normalizeTime(tm[2]);
    }

    // Days: the text between the date range and the time range (or before the
    // first comma). After the date range, WebAdvisor writes "DAYS TIME, ROOM".
    const afterDate = dm ? b.slice(b.indexOf(dm[0]) + dm[0].length) : b;
    // Days token = leading run before the time or "Days N/A"
    const daysMatch = afterDate.match(/^\s*([A-Za-z]+)\b/);
    if (daysMatch && !/^days$/i.test(daysMatch[1])) {
      res.days = normalizeDays(daysMatch[1]);
    } else if (/Days\s+N\/A/i.test(afterDate)) {
      res.days = "";
    }

    // Room/location: after "Room " up to end of block / comma.
    const roomMatch = b.match(/Room\s+([^,]+?)\s*$/i);
    if (roomMatch && !/N\/A/i.test(roomMatch[1])) {
      // Preserve building prefix if present: "HM Room HU115" → "HM HU115"
      const bldgMatch = b.match(/,\s*([A-Za-z0-9]+)\s+Room\s+([^,]+?)\s*$/i);
      if (bldgMatch && !/N\/A/i.test(bldgMatch[2])) {
        res.location = `${bldgMatch[1]} ${bldgMatch[2]}`.trim();
      } else {
        res.location = roomMatch[1].trim();
      }
    }
    return res;
  });

  // Primary = first block with real times; else first block.
  const primary = parsed.find((p) => p.start_time) || parsed[0] || empty;
  // Merge location: prefer a non-null physical room across all blocks.
  const loc = parsed.find((p) => p.location)?.location ?? primary.location;
  // Merge days: prefer the block we picked; if it lacks days but another block
  // has them, use those.
  const days =
    primary.days || parsed.find((p) => p.days)?.days || "";

  return {
    start_date: primary.start_date ?? parsed.find((p) => p.start_date)?.start_date ?? null,
    days,
    start_time: primary.start_time,
    end_time: primary.end_time,
    location: loc,
  };
}

/**
 * Parse the class-name cell into prefix / number / synonym(CRN) / title.
 *   "ENGL-C1000-D1571 (061571) Academic Reading and Writing"
 *   "ENGL-17-V1570 (061570) American Lit I"
 * Layout: PREFIX-NUMBER-SECTION (SYNONYM) TITLE
 */
function parseClassCell(
  cell: string
): { prefix: string; number: string; crn: string; title: string } | null {
  const norm = cell.replace(/\s+/g, " ").trim();
  // Synonym in parens is the stable id we treat as CRN.
  const synMatch = norm.match(/\((\d{4,7})\)/);
  if (!synMatch) return null;
  const crn = String(parseInt(synMatch[1], 10)); // strip leading zeros
  const beforeSyn = norm.slice(0, synMatch.index).trim(); // "ENGL-C1000-D1571"
  const afterSyn = norm.slice(synMatch.index! + synMatch[0].length).trim(); // title
  const title = afterSyn.replace(/\s+/g, " ").trim();

  // PREFIX-NUMBER-SECTION — split on first two hyphens; the rest of any
  // hyphenated section id stays with the section (we don't emit section).
  const segs = beforeSyn.split("-");
  if (segs.length < 2) return null;
  const prefix = segs[0].trim();
  const number = segs[1].trim();
  if (!prefix || !number) return null;
  return { prefix, number, crn, title: title || `${prefix} ${number}` };
}

/**
 * Derive delivery mode from campus, meeting room presence, and comment text.
 *  - "Online Classes" campus + no physical room → online (or hybrid if the
 *    comment explicitly says both in-person and online components).
 *  - A physical room → in-person, unless comment says hybrid/both → hybrid.
 *  - "zoom" only when the comment/room explicitly references Zoom-style sync
 *    remote meetings.
 */
function deriveMode(
  campus: string,
  hasRoom: boolean,
  comments: string
): "in-person" | "online" | "hybrid" | "zoom" {
  const c = `${campus} ${comments}`.toLowerCase();
  const saysBoth =
    /both in[\s-]?person and online|requires both in person and online|in person and online components/.test(
      c
    );
  const saysHybrid = /hybrid/.test(c) || saysBoth;
  const saysZoom = /\bzoom\b/.test(c);
  const isOnlineCampus = /online/.test(campus.toLowerCase());

  // A "both in person and online" / hybrid comment is the authoritative signal
  // — it can appear with or without a parsed physical room (rooms are often
  // listed as "Room N/A" on hybrid sections).
  if (saysHybrid) return "hybrid";
  if (saysZoom) return "zoom";
  if (isOnlineCampus && !hasRoom) return "online";
  if (!hasRoom && /does not require in-person/.test(c)) return "online";
  if (hasRoom) return "in-person";
  // No room, not flagged online-campus, not flagged "no in-person": default
  // to online for async-looking rows; otherwise in-person.
  if (/does not require in-person|fully online|entirely online/.test(c))
    return "online";
  return isOnlineCampus ? "online" : "in-person";
}

function parseCredits(raw: string): number {
  const n = parseFloat(raw.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** "J. Brown" stays as-is (WebAdvisor gives initial+last). null if blank/Staff-only. */
function normalizeInstructor(raw: string): string | null {
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (/^(staff|e\.?\s*staff|tba)$/i.test(s)) return null;
  return s;
}

// ---------------------------------------------------------------------------
// Browser flow
// ---------------------------------------------------------------------------

/** Load the search page fresh (new token) and return the available term options. */
async function loadSearchPage(
  page: Page
): Promise<{ termOptions: { value: string; label: string }[]; subjectCodes: string[] }> {
  await page.goto(ENTRY, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
  await page.waitForSelector("#VAR1", { timeout: NAV_TIMEOUT });
  await page.waitForSelector("#LIST_VAR1_1", { timeout: NAV_TIMEOUT });
  return page.evaluate(() => {
    const termSel = document.querySelector("#VAR1") as HTMLSelectElement;
    const termOptions = Array.from(termSel.options)
      .filter((o) => o.value)
      .map((o) => ({ value: o.value, label: o.text.trim() }));
    const subjSel = document.querySelector("#LIST_VAR1_1") as HTMLSelectElement;
    const subjectCodes = Array.from(subjSel.options)
      .map((o) => o.value)
      .filter(Boolean);
    return { termOptions, subjectCodes };
  });
}

/** Read every row currently rendered in the results grid. */
async function readRows(page: Page): Promise<RawRow[]> {
  return page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll("a")).filter((a) =>
      /\(\s*\d{4,7}\s*\)/.test(a.textContent || "")
    );
    const seen = new Set<HTMLElement>();
    const rows: RawRow[] = [];
    for (const a of anchors) {
      const tr = a.closest("tr") as HTMLElement | null;
      if (!tr || seen.has(tr)) continue;
      seen.add(tr);
      const tds = Array.from(tr.querySelectorAll("td")).map((td) =>
        (td.textContent || "").replace(/\s+/g, " ").trim()
      );
      // Expected 9 cells: [idx, term, class, meeting, campus, faculty, status, credits, comments]
      if (tds.length < 8) continue;
      rows.push({
        classCell: tds[2] || "",
        meeting: tds[3] || "",
        campus: tds[4] || "",
        faculty: tds[5] || "",
        status: tds[6] || "",
        credits: tds[7] || "",
        comments: tds[8] || "",
      });
    }
    return rows;
  });
}

/** Current "Page N of M" -> [N, M], or null. */
async function readPageInfo(page: Page): Promise<[number, number] | null> {
  return page.evaluate(() => {
    const m = (document.body.textContent || "").match(/Page\s+(\d+)\s+of\s+(\d+)/);
    return m ? ([parseInt(m[1], 10), parseInt(m[2], 10)] as [number, number]) : null;
  });
}

/** Click the enabled "Next" paging button. Returns false if none/disabled. */
async function clickNext(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const btns = Array.from(
      document.querySelectorAll("button.pagingbutton")
    ).filter(
      (b) =>
        (b.textContent || "").trim() === "Next" &&
        !(b as HTMLButtonElement).disabled
    );
    if (btns.length) {
      (btns[0] as HTMLButtonElement).click();
      return true;
    }
    return false;
  });
}

/**
 * Run one (term, subjects[]) search and collect all rows across pagination.
 * Returns raw rows; assumes the search page is freshly loaded each call so the
 * token is valid.
 */
async function runSearch(
  page: Page,
  termValue: string,
  subjectCodes: string[]
): Promise<RawRow[]> {
  await page.selectOption("#VAR1", termValue);
  // Fill up to 3 subject dropdowns. CRITICAL: only set dropdowns that have a
  // real code — explicitly selecting the empty option on an unused subject
  // dropdown makes WebAdvisor throw "Error 208130 LOCATE error" and return
  // zero rows. Leaving them untouched (at their default empty option) is fine.
  for (let i = 0; i < SUBJECTS_PER_SEARCH; i++) {
    const code = subjectCodes[i];
    if (!code) continue;
    const sel = `#LIST_VAR1_${i + 1}`;
    if (await page.$(sel)) {
      await page.selectOption(sel, code).catch(() => {});
    }
  }

  // Submit and wait for either the results page or "no results".
  await Promise.all([
    page
      .waitForNavigation({ waitUntil: "domcontentloaded", timeout: RESULTS_WAIT })
      .catch(() => {}),
    page.click('input[type="submit"], input[value="SUBMIT"]').catch(() => {}),
  ]);
  // Let the GWT grid render.
  await page
    .waitForFunction(
      () =>
        /Page\s+\d+\s+of\s+\d+/.test(document.body.textContent || "") ||
        /no\s+(sections|classes|results)/i.test(document.body.textContent || "") ||
        document.querySelector("a") !== null,
      { timeout: RESULTS_WAIT }
    )
    .catch(() => {});
  await page.waitForTimeout(800);

  const all: RawRow[] = [];
  const seenCrns = new Set<string>();
  let pages = 0;
  while (pages < MAX_PAGES) {
    pages++;
    const rows = await readRows(page);
    let added = 0;
    for (const r of rows) {
      const syn = (r.classCell.match(/\((\d{4,7})\)/) || [])[1] || r.classCell;
      const key = `${syn}`;
      if (seenCrns.has(key)) continue;
      seenCrns.add(key);
      all.push(r);
      added++;
    }
    const info = await readPageInfo(page);
    if (!info) break;
    const [cur, total] = info;
    if (cur >= total) break;
    const advanced = await clickNext(page);
    if (!advanced) break;
    // Wait for the page-of indicator to advance or first row to change.
    await page
      .waitForFunction(
        (prev) => {
          const m = (document.body.textContent || "").match(
            /Page\s+(\d+)\s+of\s+\d+/
          );
          return m ? parseInt(m[1], 10) !== prev : true;
        },
        cur,
        { timeout: RESULTS_WAIT }
      )
      .catch(() => {});
    await page.waitForTimeout(600);
    if (added === 0 && pages > 1) break; // safety: no new data
  }
  return all;
}

// ---------------------------------------------------------------------------
// Row → schema
// ---------------------------------------------------------------------------

function toSection(
  raw: RawRow,
  termStem: string
): CourseSection | null {
  const cls = parseClassCell(raw.classCell);
  if (!cls) return null;
  const meet = parseMeeting(raw.meeting);
  const hasRoom = !!meet.location;
  const mode = deriveMode(raw.campus, hasRoom, raw.comments);

  // location: physical room, or the campus label for online/no-room sections.
  let location = meet.location || "";
  if (!location) {
    location = mode === "online" ? "ONLINE" : raw.campus || "";
  }

  return {
    college_code: COLLEGE_SLUG,
    term: termStem,
    course_prefix: cls.prefix,
    course_number: cls.number,
    course_title: cls.title,
    credits: parseCredits(raw.credits),
    crn: cls.crn,
    days: meet.days,
    start_time: meet.start_time ?? "",
    end_time: meet.end_time ?? "",
    start_date: meet.start_date ?? "",
    location,
    campus: raw.campus || "",
    mode,
    instructor: normalizeInstructor(raw.faculty),
    seats_open: null, // WebAdvisor shows Status only, no numeric seat counts
    seats_total: null,
    prerequisite_text: null,
    prerequisite_courses: [],
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function scrapeTerm(
  page: Page,
  termValue: string,
  termLabel: string,
  termStem: string,
  subjectCodes: string[]
): Promise<CourseSection[]> {
  const sections: CourseSection[] = [];
  const seen = new Set<string>(); // crn-level dedupe across subject batches

  // Batch subjects in groups of 3.
  const batches: string[][] = [];
  for (let i = 0; i < subjectCodes.length; i += SUBJECTS_PER_SEARCH) {
    batches.push(subjectCodes.slice(i, i + SUBJECTS_PER_SEARCH));
  }

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    let rows: RawRow[] = [];
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Re-load the search page each batch for a fresh token.
        await loadSearchPage(page);
        rows = await runSearch(page, termValue, batch);
        // WebAdvisor intermittently throws a server-side "Error 208130 LOCATE"
        // and renders an empty grid even for subjects that DO have sections.
        // A genuinely empty batch is common too, so we can't tell them apart
        // from one response — but a retry is cheap and idempotent, so retry a
        // zero-row batch a couple of times before accepting the empty result.
        if (rows.length === 0 && attempt < MAX_RETRIES) {
          await page.waitForTimeout(1500);
          continue;
        }
        break;
      } catch (err) {
        if (attempt === MAX_RETRIES) {
          console.error(
            `  [${termLabel}] batch ${batch.join(",")} failed:`,
            String(err).slice(0, 160)
          );
          rows = [];
        } else {
          await page.waitForTimeout(1500);
        }
      }
    }

    let kept = 0;
    for (const r of rows) {
      const sec = toSection(r, termStem);
      if (!sec) continue;
      if (seen.has(sec.crn)) continue;
      seen.add(sec.crn);
      sections.push(sec);
      kept++;
    }
    console.log(
      `  [${termLabel}] ${b + 1}/${batches.length} subjects=${batch.join(
        ","
      )} → ${rows.length} rows, +${kept} sections (running ${sections.length})`
    );
    await page.waitForTimeout(INTER_SEARCH_DELAY);
  }

  return sections;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const browser: Browser = await chromium.launch({ headless: !args.headed });
  const ctx = await browser.newContext({ userAgent: USER_AGENT });
  const page = await ctx.newPage();
  page.setDefaultTimeout(NAV_TIMEOUT);

  try {
    const { termOptions, subjectCodes } = await loadSearchPage(page);
    console.log(
      `Term options: ${termOptions.map((t) => `${t.label}(${t.value})`).join(", ")}`
    );
    console.log(`Subjects available: ${subjectCodes.length}`);

    // Decide which terms to scrape. Default: every supported (Spring/Summer/Fall)
    // term the dropdown offers — i.e. all upcoming published terms.
    let targets = termOptions
      .map((t) => ({ ...t, stem: fileStemForLabel(t.label) }))
      .filter((t) => t.stem) as {
      value: string;
      label: string;
      stem: string;
    }[];

    if (args.terms && args.terms.length) {
      const want = new Set(args.terms.map((s) => s.toLowerCase()));
      targets = targets.filter((t) => want.has(t.label.toLowerCase()));
      if (targets.length === 0) {
        console.error(
          `No matching terms for --term "${args.terms.join(
            ","
          )}". Available: ${termOptions.map((t) => t.label).join(", ")}`
        );
        process.exitCode = 1;
        return;
      }
    }

    let subjects = subjectCodes;
    if (args.subjects && args.subjects.length) {
      const want = new Set(args.subjects);
      subjects = subjectCodes.filter((c) => want.has(c));
      const missing = args.subjects.filter((s) => !subjectCodes.includes(s));
      if (missing.length) {
        console.error(
          `Subject(s) not in list: ${missing.join(", ")}. Available: ${subjectCodes
            .slice(0, 40)
            .join(", ")}…`
        );
      }
      if (subjects.length === 0) {
        process.exitCode = 1;
        return;
      }
    }

    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

    for (const t of targets) {
      console.log(`\n=== ${t.label} (VAR1=${t.value}, file=${t.stem}.json) ===`);
      const sections = await scrapeTerm(
        page,
        t.value,
        t.label,
        t.stem,
        subjects
      );

      if (sections.length === 0) {
        console.error(
          `  ${t.label}: 0 sections scraped — writing NOTHING (no stub).`
        );
        continue;
      }

      const outPath = path.join(DATA_DIR, `${t.stem}.json`);

      // In --merge mode, fold the freshly-scraped sections into the existing
      // term file (by CRN). New CRNs are added; existing CRNs are refreshed
      // with the new row. This recovers a subject batch that transiently
      // returned zero rows in a full run without touching unrelated rows.
      let finalSections = sections;
      if (args.merge && fs.existsSync(outPath)) {
        const existing: CourseSection[] = JSON.parse(
          fs.readFileSync(outPath, "utf8")
        );
        const byCrn = new Map<string, CourseSection>();
        for (const s of existing) byCrn.set(s.crn, s);
        let added = 0;
        let updated = 0;
        for (const s of sections) {
          if (byCrn.has(s.crn)) updated++;
          else added++;
          byCrn.set(s.crn, s);
        }
        finalSections = Array.from(byCrn.values());
        console.log(
          `  MERGE: existing ${existing.length} + scraped ${sections.length} → ${finalSections.length} (added ${added}, refreshed ${updated})`
        );
      }

      // Deterministic order for idempotent diffs.
      finalSections.sort((a, b) => {
        const k = `${a.course_prefix} ${a.course_number}`.localeCompare(
          `${b.course_prefix} ${b.course_number}`
        );
        return k !== 0 ? k : a.crn.localeCompare(b.crn);
      });

      fs.writeFileSync(outPath, JSON.stringify(finalSections, null, 2) + "\n");
      console.log(`  WROTE ${outPath} (${finalSections.length} sections)`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});

/**
 * scrape-jenzabar-webforms.ts (template)
 *
 * Parameterized scraper for the ASP.NET WebForms variant of Jenzabar ICS
 * course search — the portlets that use `pg0$V$ddlTerm` + `pg0$V$btnSearch`
 * instead of the standard `#stuRegTermSelect`-driven StudentRegistration
 * portlet that scripts/lib/scrape-jenzabar.ts targets.
 *
 * Common portlet names that fit this pattern:
 *   AddDrop_Courses    (Paris Junior, NCTC, Kilgore, …)
 *   Course_Search      (Texarkana, …)
 *   Course_search      (Kilgore — note lowercase)
 *
 * The form is publicly reachable (no SSO), and the result table renders
 * server-side. Pagination on most colleges is a letter-chunk navigator
 * (`pg0$V$ltrNav`) — same as Kilgore.
 *
 * The original bespoke scraper at scripts/tx/scrape-kilgore.ts predates
 * this template and is left untouched to avoid regressing a working
 * production scraper. New WebForms-style TX colleges should use this
 * library going forward.
 *
 * Usage:
 *
 *   import { scrapeJenzabarWebformsState } from "../lib/scrape-jenzabar-webforms";
 *
 *   await scrapeJenzabarWebformsState({
 *     state: "tx",
 *     hosts: {
 *       "paris-junior-college": "https://mypjc.parisjc.edu/ICS/Portal_Homepage.jnz?portlet=AddDrop_Courses&screen=Advanced+Course+Search&screenType=next",
 *     },
 *   });
 */
import * as fs from "fs";
import * as path from "path";
import { chromium, type Browser, type Page } from "playwright";

const NAV_TIMEOUT = 45_000;
const PAGE_DELAY = 1500;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type CourseMode = "in-person" | "online" | "hybrid" | "zoom";

export interface CourseSection {
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

export interface ScrapeStateOptions {
  state: string;
  hosts: Record<string, string>;
  collegeFilter?: string;
  termFilter?: string;
  maxPages?: number;
  headed?: boolean;
}

export interface ScrapeCollegeResult {
  slug: string;
  url: string;
  totalSections: number;
  termsScraped: Array<{ termCode: string; sections: number }>;
  errors: string[];
}

export interface ScrapeStateResult {
  state: string;
  results: ScrapeCollegeResult[];
  grandTotal: number;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface TermOption {
  value: string;
  label: string;
}

interface RawRow {
  cells: string[];
}

// ---------------------------------------------------------------------------
// Parsing helpers — straight ports of scripts/tx/scrape-kilgore.ts
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function jenzabarTermToStandard(value: string, label: string): string | null {
  const map: Record<string, string> = {
    FA: "FA", FALL: "FA",
    SP: "SP", SPRING: "SP",
    SU: "SU", SUMMER: "SU",
    WI: "WI", WINTER: "WI",
  };
  // Format 1: value embeds the term name. e.g. "2026;FA" or "2026;FALL"
  const v = value.match(/(\d{4})\s*;\s*(FA|SP|SU|WI|FALL|SPRING|SUMMER|WINTER)/i);
  if (v) return `${v[1]}${map[v[2].toUpperCase()] ?? v[2].slice(0, 2).toUpperCase()}`;
  // Format 2: label is "Fall 2026" or similar.
  const l = label.match(/(Fall|Spring|Summer|Winter|FA|SP|SU|WI)\s+(\d{4})/i);
  if (l) return `${l[2]}${map[l[1].toUpperCase()] ?? l[1].slice(0, 2).toUpperCase()}`;
  // Format 3: label is "{academic-year} - {Term}". e.g.
  // "2026-2027 - Fall" (NCMC) or "2026/27 - Summer". Use the FIRST year
  // in the academic-year range as the calendar-year prefix — this is
  // consistent with how Fall is named everywhere else (Fall 2026 = the
  // Fall semester at the start of AY 2026-2027). Summer is ambiguous
  // (some schools call AY 2026-2027 Summer "Summer 2026", others "2027"),
  // but the dominant convention at the schools using this format is the
  // starting calendar year.
  const ay = label.match(
    /(\d{4})(?:[-/]\d{2,4})?\s*-\s*(Fall|Spring|Summer|Winter|FA|SP|SU|WI)/i
  );
  if (ay) {
    return `${ay[1]}${map[ay[2].toUpperCase()] ?? ay[2].slice(0, 2).toUpperCase()}`;
  }
  return null;
}

function parseCourseCode(raw: string): { prefix: string; number: string; section: string } | null {
  const m = raw.match(/^([A-Z]{2,4})\s*(\d{3,4}[A-Z]?)\s*(.*)$/);
  if (!m) return null;
  return { prefix: m[1], number: m[2], section: m[3].trim() };
}

function parseSeats(s: string): { open: number | null; total: number | null } {
  const m = s.match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);
  if (!m) return { open: null, total: null };
  return { open: parseInt(m[1], 10), total: parseInt(m[2], 10) };
}

function parseDays(d: string): string {
  return d.replace(/\s+/g, "");
}

function parseSchedule(s: string): {
  days: string;
  start_time: string;
  end_time: string;
  location: string;
  mode: CourseMode;
} {
  const clean = s.replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  const [scheduleSide = "", locationSide = ""] = clean.split(/;\s*/, 2);
  const location = locationSide.trim();
  const isOnline = /web|online|internet|blackboard|canvas|moodle/i.test(clean);
  const isHybrid = /hybrid/i.test(clean);
  const mode: CourseMode = isHybrid ? "hybrid" : isOnline ? "online" : "in-person";
  const tm = scheduleSide.match(/([A-Z]{1,7})\s*(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/i);
  if (tm) {
    return {
      days: parseDays(tm[1]),
      start_time: tm[2].replace(/\s+/g, " ").trim(),
      end_time: tm[3].replace(/\s+/g, " ").trim(),
      location,
      mode,
    };
  }
  return { days: "", start_time: "", end_time: "", location, mode };
}

function normalizeDate(d: string): string {
  const m = d.match(/^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/);
  if (!m) return "";
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function parseInstructor(s: string): string | null {
  const t = s.trim();
  if (!t || /^staff$/i.test(t) || t === "-") return null;
  return t;
}

function pickTermsToScrape(terms: TermOption[]): TermOption[] {
  return terms.filter((t) => {
    if (!t.value || /select/i.test(t.label)) return false;
    if (/view only|past|archived/i.test(t.label)) return false;
    // Skip sub-term variants — they have a 3rd `;`-segment (e.g. "2026;FA;1D")
    if (t.value.split(";").length > 2) return false;
    const m = t.value.match(/(\d{4})/);
    if (!m) return true;
    return parseInt(m[1], 10) >= new Date().getFullYear();
  });
}

// ---------------------------------------------------------------------------
// Page-driver helpers
// ---------------------------------------------------------------------------

async function getTerms(page: Page): Promise<TermOption[]> {
  return page.evaluate(() => {
    const sel = document.querySelector<HTMLSelectElement>("#pg0_V_ddlTerm");
    if (!sel) return [];
    return Array.from(sel.options)
      .filter((o) => o.value && o.value.trim() && o.text.trim())
      .map((o) => ({ value: o.value, label: o.text.trim() }));
  });
}

async function selectTermAndSearch(page: Page, termValue: string): Promise<void> {
  await page.selectOption("#pg0_V_ddlTerm", termValue);
  await sleep(500);
  await page.click("#pg0_V_btnSearch");
  await page.waitForLoadState("networkidle", { timeout: NAV_TIMEOUT }).catch(() => {});
  await sleep(2000);
}

/**
 * Find the results table (heuristically — the one whose header contains a
 * "Course code"-ish cell) and return its data rows as cell arrays.
 *
 * Column positions vary slightly across colleges; the wrapper finds the
 * first cell that parses as a course code (e.g. "ACNT 2388") and treats
 * everything after that as data. Each row is returned as the full cells
 * array so callers can map columns by index if they need to.
 */
async function extractRowsFromCurrentPage(page: Page): Promise<RawRow[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
      return await page.evaluate(() => {
        const tables = Array.from(document.querySelectorAll<HTMLTableElement>("table"));
        const resultsTable = tables.find((t) =>
          Array.from(t.querySelectorAll("th, td")).some((c) =>
            /Course\s*code/i.test(c.textContent || "")
          )
        );
        if (!resultsTable) return [];
        const rows = Array.from(resultsTable.querySelectorAll<HTMLTableRowElement>("tr"));
        const out: { cells: string[] }[] = [];
        for (const r of rows) {
          const cells = Array.from(r.querySelectorAll("td")).map((td) =>
            (td.innerText || td.textContent || "").trim()
          );
          if (cells.length < 5) continue;
          // Look for a cell containing what looks like a course code.
          if (!cells.some((c) => /^[A-Z]{2,4}\s*\d{3,4}/.test(c))) continue;
          out.push({ cells });
        }
        return out;
      });
    } catch (e) {
      if (attempt < 2 && /Execution context was destroyed|context/i.test(String(e))) {
        await sleep(1500);
        continue;
      }
      throw e;
    }
  }
  return [];
}

async function goToNextPage(page: Page): Promise<boolean> {
  // The Kilgore-style "Next page -->" letter-chunk pager. Most WebForms
  // Jenzabar deployments use the same `pg0$V$ltrNav` postback control.
  const clicked = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>("a"));
    for (const a of anchors) {
      const href = a.getAttribute("href") || "";
      if (!/ltrNav/.test(href)) continue;
      const text = ((a.innerText || a.textContent) || "").trim();
      if (/next\s*page/i.test(text)) {
        a.click();
        return true;
      }
    }
    return false;
  });
  if (!clicked) return false;
  await page.waitForLoadState("networkidle", { timeout: NAV_TIMEOUT }).catch(() => {});
  await sleep(PAGE_DELAY);
  return true;
}

// ---------------------------------------------------------------------------
// Row → Section mapping
// ---------------------------------------------------------------------------

/**
 * Identify which cell index holds the course code (the cell matching
 * /^[A-Z]{2,4}\s*\d{3,4}/) and treat the next cells as a fixed sequence:
 *
 *   [codeIdx]     → "ACNT 2388 0W01" (prefix + number + section)
 *   [codeIdx+1]   → course name
 *   [codeIdx+2]   → faculty
 *   [codeIdx+3]   → seats ("19/20")
 *   [codeIdx+4]   → status
 *   [codeIdx+5]   → schedule
 *   [codeIdx+6]   → credits
 *   [codeIdx+7]   → begin date
 *
 * This is the layout the Jenzabar "Advanced Course Search" template emits
 * — verified against Kilgore in production and against the form HTML of
 * Paris Jr / NCTC / Texarkana on 2026-05-28.
 */
function rawToSection(
  cells: string[],
  slug: string,
  termFile: string
): CourseSection | null {
  const codeIdx = cells.findIndex((c) => /^[A-Z]{2,4}\s*\d{3,4}/.test(c));
  if (codeIdx < 0) return null;
  const parsed = parseCourseCode(cells[codeIdx]);
  if (!parsed) return null;
  const get = (i: number) => cells[codeIdx + i] || "";
  const name = get(1);
  const faculty = get(2);
  const seats = get(3);
  const _status = get(4);
  const schedule = get(5);
  const creditsRaw = get(6);
  const beginDate = get(7);
  const { days, start_time, end_time, location, mode } = parseSchedule(schedule);
  const { open, total } = parseSeats(seats);
  return {
    college_code: slug,
    term: termFile,
    course_prefix: parsed.prefix,
    course_number: parsed.number,
    course_title: name,
    credits: parseFloat(creditsRaw) || 0,
    crn: parsed.section || `${parsed.prefix}-${parsed.number}`,
    days,
    start_time,
    end_time,
    start_date: normalizeDate(beginDate),
    location,
    campus: location.split(",")[0]?.trim() || "",
    mode,
    instructor: parseInstructor(faculty),
    seats_open: open,
    seats_total: total,
    prerequisite_text: null,
    prerequisite_courses: [],
  };
}

// ---------------------------------------------------------------------------
// Per-college driver
// ---------------------------------------------------------------------------

async function scrapeCollege(
  page: Page,
  slug: string,
  url: string,
  termFilter: string | undefined,
  maxPages: number,
  state: string
): Promise<ScrapeCollegeResult> {
  const result: ScrapeCollegeResult = {
    slug,
    url,
    totalSections: 0,
    termsScraped: [],
    errors: [],
  };
  console.log(`\n=== ${slug} ===`);
  console.log(`  URL: ${url}`);

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: NAV_TIMEOUT });
    await sleep(1500);
  } catch (e) {
    const msg = `goto failed: ${e}`;
    console.warn(`  ${msg}`);
    result.errors.push(msg);
    return result;
  }

  const allTerms = await getTerms(page);
  if (allTerms.length === 0) {
    const msg = `no terms found — page may have changed or login required`;
    console.warn(`  ${msg}`);
    result.errors.push(msg);
    return result;
  }
  const candidates = pickTermsToScrape(allTerms);
  const targets = termFilter
    ? candidates.filter((t) => t.value === termFilter || t.label === termFilter)
    : candidates;
  console.log(`  ${allTerms.length} total terms; ${candidates.length} candidates; ${targets.length} target(s)`);

  const outDir = path.join(process.cwd(), "data", state, "courses", slug);

  for (const term of targets) {
    const termFile = jenzabarTermToStandard(term.value, term.label);
    if (!termFile) {
      console.log(`  skip ${term.value}: can't map`);
      continue;
    }
    console.log(`\n  • ${term.label} (${term.value} → ${termFile})`);

    try {
      // Fresh page-load per term — ASP.NET ViewState makes multi-term reuse unreliable.
      await page.goto(url, { waitUntil: "networkidle", timeout: NAV_TIMEOUT });
      await sleep(1200);
      await selectTermAndSearch(page, term.value);

      const sections: CourseSection[] = [];
      let pageNum = 1;
      while (true) {
        const rows = await extractRowsFromCurrentPage(page);
        for (const r of rows) {
          const sec = rawToSection(r.cells, slug, termFile);
          if (sec) sections.push(sec);
        }
        console.log(`    page ${pageNum}: +${rows.length} rows (total: ${sections.length})`);
        if (pageNum >= maxPages) break;
        const hasNext = await goToNextPage(page);
        if (!hasNext) break;
        pageNum++;
      }

      fs.mkdirSync(outDir, { recursive: true });
      const outFile = path.join(outDir, `${termFile}.json`);
      fs.writeFileSync(outFile, JSON.stringify(sections, null, 2) + "\n");
      console.log(`    ✓ ${termFile}: ${sections.length} sections → ${outFile}`);
      result.termsScraped.push({ termCode: termFile, sections: sections.length });
      result.totalSections += sections.length;
    } catch (e) {
      const msg = `${termFile ?? term.value} failed: ${e}`;
      console.warn(`    ${msg}`);
      result.errors.push(msg);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function scrapeJenzabarWebformsState(
  opts: ScrapeStateOptions
): Promise<ScrapeStateResult> {
  const targets: Array<[string, string]> = opts.collegeFilter
    ? (() => {
        const url = opts.hosts[opts.collegeFilter!];
        if (!url) {
          throw new Error(
            `Unknown college: ${opts.collegeFilter}. Known: ${Object.keys(opts.hosts).join(", ")}`
          );
        }
        return [[opts.collegeFilter!, url]];
      })()
    : Object.entries(opts.hosts);

  const browser: Browser = await chromium.launch({ headless: !opts.headed });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(NAV_TIMEOUT);

  const results: ScrapeCollegeResult[] = [];
  let grandTotal = 0;
  try {
    for (const [slug, url] of targets) {
      const r = await scrapeCollege(
        page,
        slug,
        url,
        opts.termFilter,
        opts.maxPages ?? Infinity,
        opts.state
      );
      results.push(r);
      grandTotal += r.totalSections;
    }
  } finally {
    await browser.close();
  }

  console.log(`\n✅ Done — ${grandTotal} sections across ${results.length} colleges.`);
  return { state: opts.state, results, grandTotal };
}

/**
 * scrape-jenzabar.ts (template)
 *
 * Parameterized Jenzabar JICS / Jenzabar EX course-section scraper.
 * Designed to be called by the auto-add-state orchestrator or imported
 * directly by per-state scripts. Additive — does not touch any existing
 * per-state scraper.
 *
 * Targets the public Jenzabar Course_Search.jnz portlet served under
 * /ICS/Academics/. Most Jenzabar installs expose this page without auth
 * (the SSO wall sits in front of registration but not search). Each
 * college's URL has a different portlet/screen query, so callers pass
 * the full search-page URL per college.
 *
 * Why Playwright (vs fetch): the search portlet is an ASP.NET WebForms
 * AjaxPortletForm with ViewState; results render after an XHR fires on
 * "Search Courses" click. The result table also uses footable.js for
 * pagination, which only updates the DOM client-side. A real browser
 * context is the simplest correct approach. There IS an internal REST
 * endpoint at /ICS/webserviceproxy/exi/... but it requires a session
 * cookie that's tied to the page load, so bypassing the page buys very
 * little.
 *
 * Usage as a library:
 *
 *   import { scrapeJenzabarState } from "../lib/scrape-jenzabar";
 *
 *   await scrapeJenzabarState({
 *     state: "mi",
 *     hosts: {
 *       "montcalm-community-college": "https://my.montcalm.edu/ICS/Academics/?portlet=Student_Registration&screen=StudentRegistrationPortlet_CourseSearchView&screenType=next",
 *     },
 *   });
 *
 * Output schema matches the shared CourseSection shape used by every
 * other scrape-* template.
 */

import * as fs from "fs";
import * as path from "path";
import {
  chromium,
  type Page,
  type BrowserContext,
  type Browser,
} from "playwright";

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
  /** State slug — lowercase 2-letter code. */
  state: string;
  /** Map of college slug → Jenzabar Course_Search.jnz portlet URL. */
  hosts: Record<string, string>;
  /** When set, only scrape this college slug. */
  collegeFilter?: string;
  /** When true, skip the Supabase import after scraping. */
  noImport?: boolean;
  /** Run headless in production; set true to debug. */
  headed?: boolean;
}

export interface ScrapeCollegeResult {
  slug: string;
  baseUrl: string;
  totalSections: number;
  termsScraped: { name: string; code: string; sections: number }[];
  errors: string[];
}

export interface ScrapeStateResult {
  state: string;
  results: ScrapeCollegeResult[];
  grandTotal: number;
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Map a Jenzabar term label like "Spring 2026" to our standard term code.
 * Jenzabar's `stuRegTermSelect` option value uses academic-year encoding
 * (e.g. "2026;30" for Spring 2026) which differs from calendar year for
 * Summer/Fall — we parse the human label instead so the output term code
 * stays in sync with how the rest of the site stores terms.
 */
export function jenzabarTermLabelToCode(label: string): string | null {
  const m = label.trim().match(/^(Spring|Summer|Fall|Winter)\s+(\d{4})$/i);
  if (!m) return null;
  const season = m[1].toLowerCase();
  const year = m[2];
  const suffix =
    season === "spring"
      ? "SP"
      : season === "summer"
        ? "SU"
        : season === "fall"
          ? "FA"
          : "WI";
  return `${year}${suffix}`;
}

/** "ACCT-115--01" → { prefix: "ACCT", number: "115", section: "01" }. */
export function parseCourseCode(
  code: string,
): { prefix: string; number: string; section: string } | null {
  // Jenzabar's standard format is PREFIX-NUMBER--SECTION (double dash).
  // Some installs use PREFIX-NUMBER-SECTION (single dash). Accept both.
  const m = code.trim().match(/^([A-Z]{2,5})-([A-Z0-9]+)-{1,2}([A-Z0-9]+)$/);
  if (!m) return null;
  return { prefix: m[1], number: m[2], section: m[3] };
}

/** "10/24" → { open: 10, total: 24 }. Returns nulls if unparseable. */
export function parseSeats(text: string): { open: number | null; total: number | null } {
  const m = text.trim().match(/(\d+)\s*\/\s*(\d+)/);
  if (!m) return { open: null, total: null };
  return { open: parseInt(m[1], 10), total: parseInt(m[2], 10) };
}

/** "1/12/2026" → "2026-01-12". Returns input on failure. */
export function normalizeDate(dateStr: string): string {
  if (!dateStr) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const m = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return dateStr;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

/**
 * Parse a Jenzabar schedule cell. Two flavours observed:
 *   "Mon 1:00-5:00 PM 1/12/2026 - 4/27/2026 Greenville Learning Center Greenville - G118"
 *   "1/12/2026 - 5/1/2026 Online Online (proctored exams may be required) - ONLNE"
 */
export function parseSchedule(text: string): {
  days: string;
  start_time: string;
  end_time: string;
  start_date: string;
  location: string;
  campus: string;
  mode: CourseMode;
} {
  const clean = text.replace(/\s+/g, " ").trim();
  // Date range like "1/12/2026 - 5/1/2026"
  const dateRange = clean.match(
    /(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})/,
  );
  const start_date = dateRange ? normalizeDate(dateRange[1]) : "";

  // Days + time appear before the date range when present:
  //   "Mon 1:00-5:00 PM <date range> ..."
  //   "Mon, Wed 9:00-9:50 AM <date range> ..."
  // Day tokens: M, T, W, R, F, S, U or Mon/Tue/Wed/.../Sun.
  let days = "";
  let start_time = "";
  let end_time = "";
  if (dateRange) {
    const before = clean.slice(0, dateRange.index ?? 0).trim();
    const timeMatch = before.match(
      /(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*(AM|PM|am|pm)?/,
    );
    if (timeMatch) {
      const meridian = (timeMatch[3] ?? "").toUpperCase();
      start_time = meridian ? `${timeMatch[1]} ${meridian}` : timeMatch[1];
      end_time = meridian ? `${timeMatch[2]} ${meridian}` : timeMatch[2];
      days = before.slice(0, timeMatch.index ?? 0).trim();
    } else {
      // Online-only / async — no day/time, just date range.
      days = "";
    }
  }

  // Everything after the date range is location info ending in "- CODE".
  let location = "";
  let campus = "";
  if (dateRange) {
    const afterIdx = (dateRange.index ?? 0) + dateRange[0].length;
    const after = clean.slice(afterIdx).trim();
    // Last "- XYZ" token is the room/building code.
    const dashSplit = after.lastIndexOf(" - ");
    if (dashSplit > -1) {
      location = after.slice(dashSplit + 3).trim();
      campus = after.slice(0, dashSplit).trim();
    } else {
      campus = after;
    }
  }

  // Mode heuristic
  const lower = clean.toLowerCase();
  const mode: CourseMode = /\bonline\b/.test(lower)
    ? /\bhybrid\b|f2f|in[-\s]?person/.test(lower)
      ? "hybrid"
      : "online"
    : /\bhybrid\b/.test(lower)
      ? "hybrid"
      : /\bzoom\b|\blive online\b/.test(lower)
        ? "zoom"
        : "in-person";

  return { days, start_time, end_time, start_date, location, campus, mode };
}

// ---------------------------------------------------------------------------
// Core scraping
// ---------------------------------------------------------------------------

interface RawJenzabarRow {
  yearterm: string;
  sectionId: string;
  advisingCode: string; // e.g. "ACCT115" — prefix+number, no separator
  courseCode: string; // e.g. "ACCT-115--01"
  title: string;
  faculty: string;
  seats: string;
  status: string;
  schedule: string;
  credits: string;
}

async function clickSearchCourses(page: Page): Promise<void> {
  await page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll("button, input"),
    ) as HTMLElement[];
    for (const b of candidates) {
      const txt = (b.textContent ?? (b as HTMLInputElement).value ?? "").trim();
      if (txt === "Search Courses") {
        b.click();
        return;
      }
    }
  });
}

async function getRows(page: Page): Promise<RawJenzabarRow[]> {
  return page.$$eval(
    "#CourseSearchResultsTable tbody tr, #CourseSearchResultsTable tr",
    (trs) =>
      trs
        .map((tr) => {
          // Skip header row (has only <th>) and the "no results" placeholder.
          const ths = tr.querySelectorAll("th");
          if (ths.length > 0) return null;
          const tds = Array.from(tr.querySelectorAll("td"));
          if (tds.length < 5) return null;
          const link = tr.querySelector(
            "a[data-yearterm]",
          ) as HTMLAnchorElement | null;
          if (!link) return null;
          // Clone each cell and strip <label class="sr-only"> screen-reader
          // markers before reading textContent — otherwise "Title" prefixes
          // bleed into "Principles of Accounting I" etc.
          // tsx wraps any nested function/arrow with `__name(...)`, which
          // breaks inside page.$$eval. So clean each cell inline — no
          // local function abstraction.
          const cells: (Element | undefined | null)[] = [
            link,
            tds[1],
            tds[2],
            tds[3],
            tds[4],
            tds[5],
            tds[6],
          ];
          const texts: string[] = [];
          for (let ci = 0; ci < cells.length; ci++) {
            const el = cells[ci];
            if (!el) {
              texts.push("");
              continue;
            }
            const clone = el.cloneNode(true) as Element;
            const labels = clone.querySelectorAll(".sr-only");
            for (let li = 0; li < labels.length; li++) labels[li].remove();
            texts.push((clone.textContent || "").replace(/\s+/g, " ").trim());
          }
          const [t0, t1, t2, t3, t4, t5, t6] = texts;
          return {
            yearterm: link.getAttribute("data-yearterm") ?? "",
            sectionId: link.getAttribute("data-sectionid") ?? "",
            advisingCode:
              link.getAttribute("data-advisingrequirementcode") ?? "",
            courseCode: t0,
            title: t1,
            faculty: t2,
            seats: t3,
            status: t4,
            schedule: t5,
            credits: t6,
          };
        })
        .filter((r): r is RawJenzabarRow => r !== null),
  );
}

async function clickNextPage(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    // footable.js binds clicks on the inner <a class="footable-page-link">.
    // Clicking the <li> directly does nothing; clicking the <a> triggers
    // the pagination XHR (data-is-server="true").
    const nextLi = document.querySelector(
      "#CourseSearchResultsTable tfoot .footable-page-nav[data-page='next']",
    ) as HTMLElement | null;
    if (!nextLi) return false;
    if (nextLi.classList.contains("disabled")) return false;
    const a = nextLi.querySelector("a") as HTMLElement | null;
    if (!a) return false;
    a.click();
    return true;
  });
}

async function harvestTerms(
  page: Page,
): Promise<{ value: string; label: string; code: string }[]> {
  const opts = await page.$$eval("#stuRegTermSelect option", (os) =>
    os.map((o) => ({
      value: (o as HTMLOptionElement).value,
      label: o.textContent?.trim() ?? "",
    })),
  );
  return opts
    .map((o) => ({ ...o, code: jenzabarTermLabelToCode(o.label) }))
    .filter(
      (o): o is { value: string; label: string; code: string } => o.code !== null,
    );
}

function rowsToSections(
  rows: RawJenzabarRow[],
  collegeSlug: string,
  termCode: string,
): CourseSection[] {
  const out: CourseSection[] = [];
  for (const r of rows) {
    const parsed = parseCourseCode(r.courseCode);
    if (!parsed) continue;
    const seats = parseSeats(r.seats);
    const sched = parseSchedule(r.schedule);
    const credits = parseFloat(r.credits) || 0;
    out.push({
      college_code: collegeSlug,
      term: termCode,
      course_prefix: parsed.prefix,
      course_number: parsed.number,
      course_title: r.title,
      credits,
      crn: r.sectionId || parsed.section,
      days: sched.days,
      start_time: sched.start_time,
      end_time: sched.end_time,
      start_date: sched.start_date,
      location: sched.location,
      campus: sched.campus,
      mode: sched.mode,
      instructor: r.faculty || null,
      seats_open: seats.open,
      seats_total: seats.total,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  }
  return out;
}

export interface ScrapeCollegeOptions {
  state: string;
  slug: string;
  baseUrl: string;
  context: BrowserContext;
  dryRun?: boolean;
  silent?: boolean;
}

export async function scrapeJenzabarCollege(
  opts: ScrapeCollegeOptions,
): Promise<ScrapeCollegeResult> {
  const log = opts.silent ? () => {} : (m: string) => console.log(m);
  const result: ScrapeCollegeResult = {
    slug: opts.slug,
    baseUrl: opts.baseUrl,
    totalSections: 0,
    termsScraped: [],
    errors: [],
  };

  const page = await opts.context.newPage();
  try {
    log(`\n--- ${opts.slug}: ${opts.baseUrl} ---`);
    await page.goto(opts.baseUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(2000);

    // Check we can see the term dropdown — if not, this college isn't a
    // straight-Jenzabar JICS course-search page (auth-gated, wrong URL,
    // etc.). Bail without writing anything.
    const hasTermSelect = await page.$("#stuRegTermSelect");
    if (!hasTermSelect) {
      result.errors.push("stuRegTermSelect not found — wrong URL or auth-gated");
      log(`  skip: term dropdown not found`);
      return result;
    }

    const terms = await harvestTerms(page);
    if (terms.length === 0) {
      result.errors.push("no terms discovered");
      log(`  skip: no terms discovered`);
      return result;
    }
    log(`  ${terms.length} term(s): ${terms.map((t) => t.label).join(", ")}`);

    for (const term of terms) {
      try {
        await page.selectOption("#stuRegTermSelect", term.value);
        await page.waitForTimeout(500);
        await clickSearchCourses(page);

        // Wait for results to render — at least one populated <td> or a
        // "no rows" placeholder. We poll for up to 20s.
        await page
          .waitForFunction(
            () => {
              const tbl = document.querySelector("#CourseSearchResultsTable");
              if (!tbl) return false;
              const rows = tbl.querySelectorAll("tbody tr");
              return rows.length > 0;
            },
            { timeout: 20_000 },
          )
          .catch(() => {
            // Fall through; we'll still try to read rows below.
          });
        await page.waitForTimeout(1500);

        const all: RawJenzabarRow[] = [];
        const seen = new Set<string>();
        const MAX_PAGES = 500;
        for (let i = 0; i < MAX_PAGES; i++) {
          const pageRows = await getRows(page);
          let added = 0;
          for (const r of pageRows) {
            const key = `${r.yearterm}|${r.sectionId}|${r.courseCode}`;
            if (seen.has(key)) continue;
            seen.add(key);
            all.push(r);
            added++;
          }
          if (added === 0 && i > 0) break;
          // Record the first row's section ID, then click next and wait
          // for the row set to change (server-side pagination XHR).
          const firstSectionId = pageRows[0]?.sectionId ?? "";
          const advanced = await clickNextPage(page);
          if (!advanced) break;
          await page
            .waitForFunction(
              (prev: string) => {
                const tbl = document.querySelector("#CourseSearchResultsTable");
                if (!tbl) return false;
                const firstLink = tbl.querySelector(
                  "tbody tr a[data-yearterm]",
                ) as HTMLAnchorElement | null;
                if (!firstLink) return false;
                return firstLink.getAttribute("data-sectionid") !== prev;
              },
              firstSectionId,
              { timeout: 15_000 },
            )
            .catch(() => undefined);
        }

        const sections = rowsToSections(all, opts.slug, term.code);
        if (sections.length === 0) {
          log(`  ${term.label} (${term.code}): no sections`);
          continue;
        }

        if (!opts.dryRun) {
          const outDir = path.join(
            process.cwd(),
            "data",
            opts.state,
            "courses",
            opts.slug,
          );
          fs.mkdirSync(outDir, { recursive: true });
          const outPath = path.join(outDir, `${term.code}.json`);
          fs.writeFileSync(
            outPath,
            JSON.stringify(sections, null, 2) + "\n",
          );
          log(`  ${term.label} (${term.code}): ${sections.length} sections → ${outPath}`);
        } else {
          log(
            `  ${term.label} (${term.code}): ${sections.length} sections (dry-run)`,
          );
        }

        result.termsScraped.push({
          name: term.label,
          code: term.code,
          sections: sections.length,
        });
        result.totalSections += sections.length;
      } catch (e) {
        const msg = `term ${term.label}: ${e instanceof Error ? e.message : String(e)}`;
        result.errors.push(msg);
        log(`  error: ${msg}`);
      }
    }
  } finally {
    await page.close();
  }

  return result;
}

export async function scrapeJenzabarState(
  opts: ScrapeStateOptions,
): Promise<ScrapeStateResult> {
  const targets: Array<[string, string]> = opts.collegeFilter
    ? (() => {
        const baseUrl = opts.hosts[opts.collegeFilter];
        if (!baseUrl) {
          throw new Error(
            `Unknown college: ${opts.collegeFilter}. Known: ${Object.keys(opts.hosts).join(", ")}`,
          );
        }
        return [[opts.collegeFilter, baseUrl]];
      })()
    : Object.entries(opts.hosts);

  console.log(`Scraping ${targets.length} Jenzabar college(s)...\n`);

  let browser: Browser | null = null;
  const results: ScrapeCollegeResult[] = [];
  let grandTotal = 0;
  try {
    browser = await chromium.launch({ headless: !opts.headed });
    const context = await browser.newContext();
    for (const [slug, baseUrl] of targets) {
      const r = await scrapeJenzabarCollege({
        state: opts.state,
        slug,
        baseUrl,
        context,
      });
      results.push(r);
      grandTotal += r.totalSections;
    }
    await context.close();
  } finally {
    if (browser) await browser.close();
  }

  console.log(`\n=== Jenzabar scrape complete: ${grandTotal} total sections ===`);
  return { state: opts.state, results, grandTotal };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const isMain =
  typeof import.meta !== "undefined" &&
  import.meta.url.startsWith("file:") &&
  process.argv[1] &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  const args = process.argv.slice(2);
  const flag = (name: string): string | null => {
    const i = args.indexOf(name);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
  };
  const smoke = args.includes("--smoke");
  const url = flag("--url");
  const slug = flag("--slug") || "test-college";
  const state = flag("--state") || "test";

  if (!url) {
    console.error(
      `Usage: tsx scripts/lib/scrape-jenzabar.ts --url <course-search-url> --slug <slug> [--state <state>] [--smoke]\n` +
        `  --smoke: dry-run, no JSON written`,
    );
    process.exit(1);
  }

  scrapeJenzabarState({
    state,
    hosts: { [slug]: url },
    noImport: true,
  })
    .then((r) => {
      if (smoke) {
        console.log(JSON.stringify(r, null, 2));
      }
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

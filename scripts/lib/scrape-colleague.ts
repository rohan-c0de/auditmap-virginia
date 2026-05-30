/**
 * scrape-colleague.ts (template)
 *
 * Parameterized Ellucian Colleague Self-Service course-section scraper.
 * Designed to be called by the auto-add-state orchestrator (PR 7) or
 * imported directly by per-state scripts.
 *
 * Existing per-state Colleague scrapers in scripts/{nc,sc,nj,md,ma,vt}/
 * are NOT modified by this PR — they continue producing data exactly as
 * they do today. This template is additive.
 *
 * Why Playwright (vs plain fetch): Colleague is an Angular/Knockout SPA
 * that needs a real browser context for two reasons —
 *   1. Some colleges redirect /Student/Courses to /Account/Login and
 *      require a click on a "Continue as Guest" link before the catalog
 *      is reachable. Plain fetch doesn't handle the JS-driven redirect.
 *   2. The PostSearchCriteria API requires the antiforgery cookie and
 *      header to match. Playwright's cookie jar handles this transparently;
 *      hand-rolled cookie tracking has cost us regressions before.
 *
 * Usage as a library:
 *
 *   import { scrapeColleagueState } from "../lib/scrape-colleague";
 *
 *   await scrapeColleagueState({
 *     state: "oh",
 *     hosts: {
 *       "lakeland":   "https://selfservice.lakelandcc.edu",
 *       "stark":      "https://ss-prod.cloud.starkstate.edu",
 *     },
 *   });
 *
 * Usage as a smoke test (read-only, no JSON written, no Supabase import):
 *
 *   npx tsx scripts/lib/scrape-colleague.ts --smoke \
 *     --url https://selfserve.waketech.edu --slug wake-technical
 *
 * Output schema matches every existing Colleague scraper exactly:
 *
 *   { college_code, term, course_prefix, course_number, course_title,
 *     credits, crn, days, start_time, end_time, start_date, location,
 *     campus, mode, instructor, seats_open, seats_total,
 *     prerequisite_text, prerequisite_courses }
 */

import * as fs from "fs";
import * as path from "path";
import {
  chromium,
  type Page,
  type BrowserContext,
  type Browser,
} from "playwright";
import { resolveCollegeTerms } from "./colleague-terms";

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

export interface ColleagueSectionRaw {
  Course: {
    SubjectCode: string;
    Number: string;
    Title: string;
    MinimumCredits: number;
    Requisites: Array<{
      RequirementCode?: string;
      IsRequired?: boolean;
      CompletionOrder?: string;
      CorequisiteCourseId?: string;
    }>;
  };
  SectionNameDisplay: string;
  FacultyDisplay: string[];
  FormattedMeetingTimes: Array<{
    DaysOfWeekDisplay: string;
    StartTimeDisplay: string;
    EndTimeDisplay: string;
    BuildingDisplay: string;
    RoomDisplay: string;
    IsOnline: boolean;
  }>;
  StartDateDisplay: string;
  LocationDisplay: string;
  LocationCode: string;
  MeetingsDisplay: string[];
  MinimumCredits: number;
  Available: number | null;
  Capacity: number | null;
  Id: string;
}

export interface RequisiteItem {
  DisplayText: string;
  DisplayTextExtension?: string;
  IsRequired: boolean;
}

export interface ColleagueSearchResponse {
  Sections: ColleagueSectionRaw[];
  TotalItems: number;
  TotalPages: number;
  PageSize: number;
  Subjects: Array<{ Code: string; Description: string }>;
}

export interface ScraperHooks {
  /** Override the default in-person/online/hybrid/zoom heuristic. */
  determineMode?: (input: {
    locationCode: string;
    locationDisplay: string;
    isOnline: boolean;
    meetingsDisplay: string[];
  }) => CourseMode;
  /**
   * Optional context passed to `resolveCollegeTerms` so freeze rules in
   * `term-freeze.ts` apply (e.g. NJ's freeze for past terms).
   */
  freezeContext?: { state: string; slug: string };
}

export interface ScrapeStateOptions {
  /** State slug — lowercase 2-letter code. */
  state: string;
  /** Map of college slug → Colleague Self-Service base URL (no trailing slash). */
  hosts: Record<string, string>;
  /** When set, only scrape this college slug. */
  collegeFilter?: string;
  /**
   * Explicit term list (e.g. ["Fall 2026", "Summer 2026"]). When omitted,
   * each college's terms are auto-discovered via resolveCollegeTerms.
   */
  termOverrides?: string[];
  /** When true, skip the Supabase import after scraping. */
  noImport?: boolean;
  /** Per-state hook overrides. */
  hooks?: ScraperHooks;
  /** When true, run the browser in headed mode (debugging). Default: headless. */
  headed?: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DELAY_MS = 500;
const PAGE_SIZE = 500;
const PREREQ_BATCH_SIZE = 10;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Normalize "M/D/YYYY" or "MM/DD/YYYY" to "YYYY-MM-DD". */
export function normalizeDate(dateStr: string): string {
  if (!dateStr) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const match = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return dateStr;
  return `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

export function formatDays(daysOfWeekDisplay: string): string {
  if (!daysOfWeekDisplay) return "";
  return daysOfWeekDisplay.replace(/\//g, " ").replace(/,\s*/g, " ").trim();
}

export function defaultDetermineMode(input: {
  locationCode: string;
  locationDisplay: string;
  isOnline: boolean;
  meetingsDisplay: string[];
}): CourseMode {
  const loc = input.locationDisplay.toLowerCase();
  const allMeetings = input.meetingsDisplay.join(" ").toLowerCase();

  if (loc.includes("hybrid") || allMeetings.includes("hybrid")) return "hybrid";

  if (input.isOnline || loc === "online" || input.locationCode === "ONL") {
    if (
      allMeetings.includes("synchronous") ||
      allMeetings.includes("zoom") ||
      allMeetings.includes("teams") ||
      allMeetings.includes("remote")
    ) {
      return "zoom";
    }
    return "online";
  }

  if (loc.includes("virtual") && loc.includes("required")) return "zoom";
  return "in-person";
}

/**
 * Parse Colleague's RequisiteItems[] into the canonical text + courses
 * format. The Colleague API returns one item per requisite block; each
 * item's DisplayText is a free-text sentence containing course codes
 * like "BIOL-111" or "ENG-111" plus optional "minimum grade X" notes.
 */
export function parseRequisiteDisplayText(items: RequisiteItem[]): {
  text: string | null;
  courses: string[];
} {
  if (!items || items.length === 0) return { text: null, courses: [] };

  const itemGroups: { courses: string[]; gradeNote: string; hasOr: boolean }[] = [];

  for (const item of items) {
    if (!item.DisplayText) continue;
    const dt = item.DisplayText;

    // Course codes appear with one of three separators across Colleague
    // instances: hyphen "BIOL-111" (most), asterisk "MATH*0900" (Casper,
    // LCCC), or a plain space "ENGL 1011" (Western Wyoming). Accept any so
    // every instance parses — without all three, some yield 0 prereqs even
    // though requisites are present. The 4-char-uppercase + 3-4-digit shape
    // keeps the space variant from matching prose like "ACT English 18".
    const courseRegex = /([A-Z]{2,4})[-* ](\d{3,4}[A-Z]*)/g;
    let match;
    const coursesInItem: string[] = [];
    while ((match = courseRegex.exec(dt)) !== null) {
      coursesInItem.push(`${match[1]} ${match[2]}`);
    }
    if (coursesInItem.length === 0) continue;

    const gradeMatch = dt.match(/[Mm]inimum grade\s+([A-Z])/);
    const gradeNote = gradeMatch ? ` (min ${gradeMatch[1]})` : "";
    const hasOr = /\bor\b/i.test(dt);

    itemGroups.push({ courses: coursesInItem, gradeNote, hasOr });
  }

  if (itemGroups.length === 0) return { text: null, courses: [] };

  // Dedupe — same course set with grade beats same set without grade
  const seen = new Map<
    string,
    { courses: string[]; gradeNote: string; hasOr: boolean }
  >();
  for (const group of itemGroups) {
    const key = [...group.courses].sort().join("+");
    const existing = seen.get(key);
    if (!existing || group.gradeNote) seen.set(key, group);
  }

  const allCourses: string[] = [];
  const parts: string[] = [];

  for (const group of seen.values()) {
    const connector = group.hasOr ? " or " : " and ";
    const partText = group.courses
      .map((c) => {
        if (!allCourses.includes(c)) allCourses.push(c);
        return `${c}${group.gradeNote}`;
      })
      .join(connector);
    parts.push(partText);
  }

  if (parts.length === 0) return { text: null, courses: [] };
  return { text: parts.join(" and "), courses: allCourses };
}

// ---------------------------------------------------------------------------
// Browser session helpers
// ---------------------------------------------------------------------------

async function fetchSectionPrerequisites(
  page: Page,
  baseUrl: string,
  csrfToken: string,
  coursesWithRequisites: Map<string, string>,
  log: (m: string) => void
): Promise<Map<string, { text: string | null; courses: string[] }>> {
  log(
    `  Fetching prerequisites for ${coursesWithRequisites.size} courses with requisites...`
  );

  const prereqMap = new Map<string, { text: string | null; courses: string[] }>();
  const entries = Array.from(coursesWithRequisites.entries());
  let fetched = 0;

  for (let i = 0; i < entries.length; i += PREREQ_BATCH_SIZE) {
    const batch = entries.slice(i, i + PREREQ_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async ([courseKey, sectionId]) => {
        try {
          const detail = await page.evaluate(
            async ({
              url,
              id,
              token,
            }: {
              url: string;
              id: string;
              token: string;
            }) => {
              const resp = await fetch(url, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json, charset=UTF-8",
                  Accept: "application/json, text/javascript, */*; q=0.01",
                  "X-Requested-With": "XMLHttpRequest",
                  __RequestVerificationToken: token,
                  __IsGuestUser: "true",
                },
                body: JSON.stringify({ sectionId: id }),
              });
              return await resp.json();
            },
            {
              url: `${baseUrl}/Student/Courses/SectionDetails`,
              id: sectionId,
              token: csrfToken,
            }
          );
          return {
            courseKey,
            items: (detail?.RequisiteItems || []) as RequisiteItem[],
          };
        } catch {
          return { courseKey, items: [] as RequisiteItem[] };
        }
      })
    );

    for (const { courseKey, items } of results) {
      const parsed = parseRequisiteDisplayText(items);
      if (parsed.text) prereqMap.set(courseKey, parsed);
    }

    fetched += batch.length;
    if (fetched % 50 === 0 || fetched === entries.length) {
      log(
        `    prereqs: ${fetched}/${entries.length} (${prereqMap.size} with prereqs)`
      );
    }

    if (i + PREREQ_BATCH_SIZE < entries.length) await sleep(100);
  }

  return prereqMap;
}

// ---------------------------------------------------------------------------
// Single-college, single-term scrape
// ---------------------------------------------------------------------------

export interface ScrapeOneOptions {
  state: string;
  slug: string;
  baseUrl: string;
  termName: string;
  context: BrowserContext;
  hooks?: ScraperHooks;
  silent?: boolean;
}

export async function scrapeColleagueCollegeTerm(
  opts: ScrapeOneOptions
): Promise<CourseSection[]> {
  const { state: _state, slug, baseUrl, termName, context, hooks = {}, silent = false } = opts;
  void _state;
  const log = silent ? () => {} : (m: string) => console.log(m);
  const determine = hooks.determineMode ?? defaultDetermineMode;

  log(`\nScraping ${slug} (${baseUrl}) for ${termName}...`);

  const page = await context.newPage();
  const allSections: CourseSection[] = [];

  try {
    log("  Loading course catalog...");
    await page.goto(`${baseUrl}/Student/Courses`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    // Some Colleague installs redirect to /Account/Login. Look for a
    // guest link to bypass; if none, try the explicit ?guestUser=true URL;
    // if still gated, give up cleanly (this college needs auth — orchestrator
    // should flag it as a manual-investigation TODO, not silently scrape 0).
    const currentUrl = page.url();
    if (currentUrl.includes("/Account/Login")) {
      log("  Redirected to login page, looking for guest access...");
      const guestLink = await page.$(
        'a:has-text("Guest"), a:has-text("guest"), a:has-text("Search"), button:has-text("Guest")'
      );
      if (guestLink) {
        await guestLink.click();
        await page.waitForTimeout(3000);
        log("  Clicked guest access link");
      } else {
        log("  No guest link found, trying guest URL...");
        await page.goto(`${baseUrl}/Student/Courses?guestUser=true`, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        await page.waitForTimeout(3000);
        if (page.url().includes("/Account/Login")) {
          log(`  ${slug} requires authentication — no guest access available. Skipping.`);
          return [];
        }
      }
    }

    const csrfToken = await page.evaluate(() => {
      const input = document.querySelector(
        'input[name="__RequestVerificationToken"]'
      ) as HTMLInputElement | null;
      return input?.value || null;
    });
    if (!csrfToken) {
      log(`  Could not find CSRF token for ${slug}`);
      return [];
    }
    log("  Got CSRF token");

    // Find the term code for the requested term name. Colleague uses
    // human-readable labels ("Spring 2026") in the dropdown but the API
    // expects the per-college code. The matcher below is intentionally
    // forgiving — different installs use different label conventions.
    const termOptions = await page.evaluate(() => {
      const select = document.getElementById("term-id") as HTMLSelectElement | null;
      if (!select) return [] as { value: string; label: string }[];
      return Array.from(select.options).map((o) => ({
        value: o.value,
        label: o.textContent?.trim() || "",
      }));
    });

    const termCode = matchTermCode(termName, termOptions);
    if (!termCode) {
      log(
        `  Term "${termName}" not found. Available: ${termOptions.map((t) => t.label || t.value).join(", ")}`
      );
      return [];
    }
    log(`  Using term code: ${termCode}`);

    // Get subject list — first try the API, then fall back to extracting
    // from the static select element on the page.
    let subjects: Array<{ Code: string; Description: string }> = await page.evaluate(
      async (url) => {
        try {
          const resp = await fetch(url);
          const data = await resp.json();
          return (data.Subjects || []) as Array<{
            Code: string;
            Description: string;
          }>;
        } catch {
          return [];
        }
      },
      `${baseUrl}/Student/Courses/GetCatalogAdvancedSearch`
    );

    if (subjects.length === 0) {
      subjects = await page.evaluate(() => {
        const select = document.getElementById(
          "subject-0"
        ) as HTMLSelectElement | null;
        if (!select) return [] as { Code: string; Description: string }[];
        return Array.from(select.options)
          .filter((o) => o.value)
          .map((o) => ({
            Code: o.value,
            Description: o.textContent?.trim() || "",
          }));
      });
    }
    log(`  Found ${subjects.length} subjects to search`);

    // Per-subject loop with internal pagination
    const coursesWithRequisites = new Map<string, string>();

    for (let i = 0; i < subjects.length; i++) {
      const subject = subjects[i];
      process.stdout.write(
        `  [${i + 1}/${subjects.length}] ${subject.Code.padEnd(5)} `
      );

      let pageNumber = 1;
      let totalPages = 1;
      let subjectCount = 0;

      while (pageNumber <= totalPages) {
        const requestBody = colleagueSearchPayload({
          terms: [termCode],
          subjects: [subject.Code],
          pageNumber,
          pageSize: PAGE_SIZE,
        });

        try {
          const response = (await page.evaluate(
            async ({ url, body, token }) => {
              const resp = await fetch(url, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json, charset=UTF-8",
                  Accept: "application/json, text/javascript, */*; q=0.01",
                  "X-Requested-With": "XMLHttpRequest",
                  __RequestVerificationToken: token,
                  __IsGuestUser: "true",
                },
                body: JSON.stringify(body),
              });
              return await resp.json();
            },
            {
              url: `${baseUrl}/Student/Courses/PostSearchCriteria`,
              body: requestBody,
              token: csrfToken,
            }
          )) as ColleagueSearchResponse;

          if (pageNumber === 1) totalPages = response.TotalPages || 1;

          if (response.Sections && response.Sections.length > 0) {
            for (const s of response.Sections) {
              const meeting = s.FormattedMeetingTimes?.[0];
              const isOnline = meeting?.IsOnline || false;
              if (s.Course?.Requisites && s.Course.Requisites.length > 0) {
                const key = `${s.Course.SubjectCode} ${s.Course.Number}`;
                if (!coursesWithRequisites.has(key)) {
                  coursesWithRequisites.set(key, s.Id);
                }
              }

              allSections.push({
                college_code: slug,
                term: termCode,
                course_prefix: s.Course.SubjectCode,
                course_number: s.Course.Number,
                course_title: s.Course.Title,
                credits: s.MinimumCredits || s.Course.MinimumCredits || 0,
                crn: s.SectionNameDisplay || s.Id,
                days: formatDays(meeting?.DaysOfWeekDisplay || ""),
                start_time: meeting?.StartTimeDisplay || "",
                end_time: meeting?.EndTimeDisplay || "",
                start_date: normalizeDate(s.StartDateDisplay || ""),
                location: s.LocationDisplay || "",
                campus: s.LocationCode || "",
                mode: determine({
                  locationCode: s.LocationCode || "",
                  locationDisplay: s.LocationDisplay || "",
                  isOnline,
                  meetingsDisplay: s.MeetingsDisplay || [],
                }),
                instructor: s.FacultyDisplay?.join(", ") || null,
                seats_open: s.Available ?? null,
                seats_total: s.Capacity ?? null,
                prerequisite_text: null,
                prerequisite_courses: [],
              });
              subjectCount++;
            }
          }
        } catch (e) {
          console.error(`API error: ${e}`);
          break;
        }

        pageNumber++;
        if (pageNumber <= totalPages) await sleep(200);
      }

      log(
        `${subjectCount} sections${totalPages > 1 ? ` (${totalPages} pages)` : ""}`
      );
      await sleep(DELAY_MS);
    }

    // Prereq enrichment
    if (coursesWithRequisites.size > 0) {
      const prereqMap = await fetchSectionPrerequisites(
        page,
        baseUrl,
        csrfToken,
        coursesWithRequisites,
        log
      );
      for (const section of allSections) {
        const key = `${section.course_prefix} ${section.course_number}`;
        const prereq = prereqMap.get(key);
        if (prereq) {
          section.prerequisite_text = prereq.text;
          section.prerequisite_courses = prereq.courses;
        }
      }
      log(`  Updated ${prereqMap.size} courses with prerequisite info`);
    }
  } catch (e) {
    console.error(`  Error scraping ${slug}: ${e}`);
  } finally {
    await page.close();
  }

  return allSections;
}

/** Build the JSON body Colleague's PostSearchCriteria endpoint expects. */
function colleagueSearchPayload(opts: {
  terms: string[];
  subjects: string[];
  pageNumber: number;
  pageSize: number;
}): Record<string, unknown> {
  return {
    keyword: null,
    terms: opts.terms,
    requirement: null,
    subrequirement: null,
    courseIds: null,
    sectionIds: null,
    requirementText: null,
    subrequirementText: "",
    group: null,
    startTime: null,
    endTime: null,
    openSections: null,
    subjects: opts.subjects,
    academicLevels: [],
    courseLevels: [],
    synonyms: [],
    courseTypes: [],
    topicCodes: [],
    days: [],
    locations: [],
    faculty: [],
    onlineCategories: null,
    keywordComponents: [],
    startDate: null,
    endDate: null,
    startsAtTime: null,
    endsByTime: null,
    pageNumber: opts.pageNumber,
    sortOn: "SectionName",
    sortDirection: "Ascending",
    subjectsBadge: [],
    locationsBadge: [],
    termFiltersBadge: [],
    daysBadge: [],
    facultyBadge: [],
    academicLevelsBadge: [],
    courseLevelsBadge: [],
    courseTypesBadge: [],
    topicCodesBadge: [],
    onlineCategoriesBadge: [],
    openSectionsBadge: "",
    openAndWaitlistedSectionsBadge: "",
    subRequirementText: null,
    quantityPerPage: opts.pageSize,
    openAndWaitlistedSections: null,
    searchResultsView: "SectionListing",
  };
}

/**
 * Match a human-readable term name (e.g. "Spring 2026") to the dropdown
 * options on a Colleague Self-Service page. Forgiving: tries exact code,
 * exact label, partial label, and reconstructed YYYY+SP/SU/FA code.
 */
function matchTermCode(
  termName: string,
  options: { value: string; label: string }[]
): string | null {
  const termNameLower = termName.toLowerCase();
  const termParts = termNameLower.split(/\s+/);

  const SEASON_CODE: Record<string, string> = {
    spring: "SP",
    summer: "SU",
    fall: "FA",
    winter: "WI",
  };
  const yearMatch = termName.match(/(\d{4})/);
  const seasonMatch = termName.match(/(spring|summer|fall|winter)/i);
  const expectedCode =
    yearMatch && seasonMatch
      ? `${yearMatch[1]}${SEASON_CODE[seasonMatch[1].toLowerCase()] || ""}`
      : null;

  const found = options.find((t) => {
    const label = t.label.toLowerCase();
    const value = t.value;
    if (expectedCode && value === expectedCode) return true;
    if (label === termNameLower) return true;
    if (
      termParts.every((p) => label.includes(p)) &&
      !label.includes("ce") &&
      !label.includes("reporting")
    )
      return true;
    if (expectedCode && label === expectedCode.toLowerCase()) return true;
    return false;
  });
  return found?.value || null;
}

// ---------------------------------------------------------------------------
// Multi-college, multi-term orchestrator
// ---------------------------------------------------------------------------

export interface ScrapeCollegeResult {
  slug: string;
  baseUrl: string;
  totalSections: number;
  termsScraped: { name: string; code: string; sections: number }[];
  errors: string[];
}

export interface ScrapeCollegeOptions {
  state: string;
  slug: string;
  baseUrl: string;
  termOverrides?: string[];
  hooks?: ScraperHooks;
  context: BrowserContext;
  dryRun?: boolean;
  silent?: boolean;
}

export async function scrapeColleagueCollege(
  opts: ScrapeCollegeOptions
): Promise<ScrapeCollegeResult> {
  const log = opts.silent ? () => {} : (m: string) => console.log(m);
  const result: ScrapeCollegeResult = {
    slug: opts.slug,
    baseUrl: opts.baseUrl,
    totalSections: 0,
    termsScraped: [],
    errors: [],
  };

  let termNames: string[];
  if (opts.termOverrides && opts.termOverrides.length > 0) {
    termNames = opts.termOverrides;
  } else {
    const discovered = await resolveCollegeTerms(opts.baseUrl, {
      freezeContext: opts.hooks?.freezeContext ?? {
        state: opts.state,
        slug: opts.slug,
      },
    });
    if (discovered.length === 0) {
      log(
        `\n--- ${opts.slug}: no terms discovered (offline, gated, or no live sections); skipping ---`
      );
      return result;
    }
    termNames = discovered.map((t) => t.name);
    log(
      `\n--- ${opts.slug}: discovered ${termNames.length} term(s): ${termNames.join(", ")} ---`
    );
  }

  for (const termName of termNames) {
    try {
      const sections = await scrapeColleagueCollegeTerm({
        state: opts.state,
        slug: opts.slug,
        baseUrl: opts.baseUrl,
        termName,
        context: opts.context,
        hooks: opts.hooks,
        silent: opts.silent,
      });

      if (sections.length === 0) {
        log(`  No sections found for ${opts.slug} (${termName})`);
        continue;
      }

      const termCode = sections[0].term;
      // Normalize short-form codes like "26/FA" → "2026FA" so filenames
      // match the canonical format used by the importer and term resolver.
      const fileTermCode = termCode.match(/^(\d{2})[\/\-]([A-Z]+)$/)
        ? `20${termCode.replace(/[\/\-]/, "")}`
        : termCode.replace(/[\\/]/g, "-");
      if (!opts.dryRun) {
        const outDir = path.join(
          process.cwd(),
          "data",
          opts.state,
          "courses",
          opts.slug
        );
        fs.mkdirSync(outDir, { recursive: true });
        const outPath = path.join(outDir, `${fileTermCode}.json`);
        fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
        log(`  Written ${sections.length} sections to ${outPath}`);
      } else {
        log(
          `  ${sections.length} sections (dry-run, not written; would be ${fileTermCode}.json)`
        );
      }

      result.termsScraped.push({
        name: termName,
        code: termCode,
        sections: sections.length,
      });
      result.totalSections += sections.length;
    } catch (e) {
      const msg = `Error scraping ${termName} for ${opts.slug}: ${e}`;
      log(`  ${msg}`);
      result.errors.push(msg);
    }
    await sleep(DELAY_MS);
  }

  return result;
}

export interface ScrapeStateResult {
  state: string;
  results: ScrapeCollegeResult[];
  grandTotal: number;
}

export async function scrapeColleagueState(
  opts: ScrapeStateOptions
): Promise<ScrapeStateResult> {
  const targets: Array<[string, string]> = opts.collegeFilter
    ? (() => {
        const baseUrl = opts.hosts[opts.collegeFilter];
        if (!baseUrl) {
          throw new Error(
            `Unknown college: ${opts.collegeFilter}. Known: ${Object.keys(opts.hosts).join(", ")}`
          );
        }
        return [[opts.collegeFilter, baseUrl]];
      })()
    : Object.entries(opts.hosts);

  console.log(`Scraping ${targets.length} college(s)...\n`);

  const browser: Browser = await chromium.launch({ headless: !opts.headed });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  const results: ScrapeCollegeResult[] = [];
  let grandTotal = 0;

  try {
    for (const [slug, baseUrl] of targets) {
      const r = await scrapeColleagueCollege({
        state: opts.state,
        slug,
        baseUrl,
        termOverrides: opts.termOverrides,
        hooks: opts.hooks,
        context,
      });
      results.push(r);
      grandTotal += r.totalSections;
    }
  } finally {
    await browser.close();
  }

  console.log("\n=== Summary ===");
  for (const r of results) {
    console.log(`  ${r.slug}: ${r.totalSections} sections`);
  }
  console.log(
    `  Total: ${grandTotal} sections across ${results.length} colleges`
  );

  if (!opts.noImport && grandTotal > 0) {
    const { importCoursesToSupabase } = await import("./supabase-import");
    await importCoursesToSupabase(opts.state);
  }

  return { state: opts.state, results, grandTotal };
}

// ---------------------------------------------------------------------------
// CLI smoke test (read-only — no JSON written, no Supabase)
// ---------------------------------------------------------------------------

interface SmokeArgs {
  url?: string;
  slug?: string;
  state?: string;
  term?: string;
  smoke: boolean;
  help: boolean;
  err?: string;
}

function parseArgs(argv: string[]): SmokeArgs {
  const out: SmokeArgs = { smoke: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--smoke") out.smoke = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--url") out.url = argv[++i];
    else if (a === "--slug") out.slug = argv[++i];
    else if (a === "--state") out.state = argv[++i];
    else if (a === "--term") out.term = argv[++i];
    else out.err = `Unknown argument: ${a}`;
  }
  return out;
}

function printHelp() {
  console.log(`Usage:
  npx tsx scripts/lib/scrape-colleague.ts --smoke \\
    --url <baseUrl> --slug <slug> [--state <state>] [--term "Fall 2026"]

Smoke-test the Colleague template against a single public host. Read-only:
no JSON files written, no Supabase import.

If --term is omitted, terms auto-discover via colleague-terms.ts.

Examples:
  npx tsx scripts/lib/scrape-colleague.ts --smoke \\
    --url https://selfserve.waketech.edu --slug wake-technical --state nc

  npx tsx scripts/lib/scrape-colleague.ts --smoke \\
    --url https://selfservice.vsc.edu --slug ccv --state vt --term "Fall 2026"
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.err) {
    if (args.err) console.error(`Error: ${args.err}`);
    printHelp();
    process.exit(args.err ? 1 : 0);
  }
  if (!args.smoke) {
    console.error("This file is a library. Add --smoke to run a read-only test.");
    printHelp();
    process.exit(1);
  }
  if (!args.url || !args.slug) {
    console.error("--smoke requires --url and --slug");
    printHelp();
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  try {
    const r = await scrapeColleagueCollege({
      state: args.state || "smoke",
      slug: args.slug,
      baseUrl: args.url,
      termOverrides: args.term ? [args.term] : undefined,
      context,
      dryRun: true,
    });

    console.log("\n=== Smoke result ===");
    console.log(`  total sections (in-memory only): ${r.totalSections}`);
    console.log(`  terms scraped: ${r.termsScraped.length}`);
    for (const t of r.termsScraped) {
      console.log(`    ${t.code}: ${t.sections} sections (${t.name})`);
    }
    if (r.errors.length > 0) {
      console.log(`  errors:`);
      for (const e of r.errors) console.log(`    - ${e}`);
    }
  } finally {
    await browser.close();
  }
}

const isMain =
  import.meta.url.startsWith("file:") &&
  process.argv[1] &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  main().catch((e) => {
    console.error("Fatal:", e);
    process.exit(1);
  });
}

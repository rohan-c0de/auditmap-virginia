/**
 * scrape-colleague.ts
 *
 * Scrapes course section data from the Community College of Vermont (CCV)
 * which uses Ellucian Colleague Self-Service (shared VSC instance).
 * Uses Playwright to handle the SPA rendering and CSRF token requirements.
 *
 * Term discovery is per-college (issue #172): CCV is asked which of the
 * current/next/next-next calendar terms have live sections. Pass `--term`
 * to override.
 *
 * Usage:
 *   npx tsx scripts/vt/scrape-colleague.ts                 # auto-discover terms
 *   npx tsx scripts/vt/scrape-colleague.ts --term "Fall 2026"
 */

import * as fs from "fs";
import * as path from "path";
import { chromium, type Page, type BrowserContext } from "playwright";
import { resolveCollegeTerms } from "../lib/colleague-terms";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL = "https://selfservice.vsc.edu";
const SLUG = "ccv";
const STATE = "vt";
const DELAY_MS = 500;
const PAGE_SIZE = 500;

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeDate(dateStr: string): string {
  if (!dateStr) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const match = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return dateStr;
  return `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

function determineMode(section: {
  locationCode: string;
  locationDisplay: string;
  isOnline: boolean;
  meetingsDisplay: string[];
}): CourseMode {
  const loc = section.locationDisplay.toLowerCase();
  const allMeetings = section.meetingsDisplay.join(" ").toLowerCase();

  if (loc.includes("hybrid") || allMeetings.includes("hybrid")) return "hybrid";
  if (section.isOnline || loc === "online" || section.locationCode === "ONL") {
    if (allMeetings.includes("synchronous") || allMeetings.includes("zoom") ||
        allMeetings.includes("teams") || allMeetings.includes("remote")) {
      return "zoom";
    }
    return "online";
  }
  if (loc.includes("virtual") && loc.includes("required")) return "zoom";
  return "in-person";
}

function formatDays(daysOfWeekDisplay: string): string {
  if (!daysOfWeekDisplay) return "";
  return daysOfWeekDisplay
    .replace(/\//g, " ")
    .replace(/,\s*/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Prerequisite parsing
// ---------------------------------------------------------------------------

interface RequisiteItem {
  DisplayText: string;
  DisplayTextExtension?: string;
  IsRequired: boolean;
}

function parseRequisiteDisplayText(items: RequisiteItem[]): {
  text: string | null;
  courses: string[];
} {
  if (!items || items.length === 0) return { text: null, courses: [] };

  const itemGroups: { courses: string[]; gradeNote: string; hasOr: boolean }[] = [];

  for (const item of items) {
    if (!item.DisplayText) continue;
    const dt = item.DisplayText;

    const courseRegex = /([A-Z]{2,4})-(\d{3,4}[A-Z]*)/g;
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

  const seen = new Map<string, { courses: string[]; gradeNote: string; hasOr: boolean }>();
  for (const group of itemGroups) {
    const key = [...group.courses].sort().join("+");
    const existing = seen.get(key);
    if (!existing || group.gradeNote) {
      seen.set(key, group);
    }
  }

  const allCourses: string[] = [];
  const parts: string[] = [];

  for (const group of seen.values()) {
    const connector = group.hasOr ? " or " : " and ";
    const partText = group.courses.map((c) => {
      if (!allCourses.includes(c)) allCourses.push(c);
      return `${c}${group.gradeNote}`;
    }).join(connector);
    parts.push(partText);
  }

  if (parts.length === 0) return { text: null, courses: [] };

  return {
    text: parts.join(" and "),
    courses: allCourses,
  };
}

async function fetchSectionPrerequisites(
  page: Page,
  csrfToken: string,
  coursesWithRequisites: Map<string, string>
): Promise<Map<string, { text: string | null; courses: string[] }>> {
  console.log(`  Fetching prerequisites for ${coursesWithRequisites.size} courses with requisites...`);

  const prereqMap = new Map<string, { text: string | null; courses: string[] }>();
  const entries = Array.from(coursesWithRequisites.entries());
  const BATCH_SIZE = 10;
  let fetched = 0;

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async ([courseKey, sectionId]) => {
        try {
          const detail = await page.evaluate(
            async ({ url, id, token }: { url: string; id: string; token: string }) => {
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
            { url: `${BASE_URL}/Student/Courses/SectionDetails`, id: sectionId, token: csrfToken }
          );

          return { courseKey, items: (detail?.RequisiteItems || []) as RequisiteItem[] };
        } catch {
          return { courseKey, items: [] as RequisiteItem[] };
        }
      })
    );

    for (const { courseKey, items } of results) {
      const parsed = parseRequisiteDisplayText(items);
      if (parsed.text) {
        prereqMap.set(courseKey, parsed);
      }
    }

    fetched += batch.length;
    if (fetched % 50 === 0 || fetched === entries.length) {
      console.log(`    prereqs: ${fetched}/${entries.length} (${prereqMap.size} with prereqs)`);
    }

    if (i + BATCH_SIZE < entries.length) await sleep(100);
  }

  return prereqMap;
}

// ---------------------------------------------------------------------------
// Types for the Colleague API response
// ---------------------------------------------------------------------------

interface ColleagueSection {
  Course: {
    SubjectCode: string;
    Number: string;
    Title: string;
    MinimumCredits: number;
    Requisites: Array<{ RequirementCode?: string; IsRequired?: boolean; CompletionOrder?: string; CorequisiteCourseId?: string }>;
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

interface ColleagueSearchResponse {
  Sections: ColleagueSection[];
  TotalItems: number;
  TotalPages: number;
  PageSize: number;
  Subjects: Array<{ Code: string; Description: string }>;
}

// ---------------------------------------------------------------------------
// Scraping
// ---------------------------------------------------------------------------

async function scrapeCollege(
  termName: string,
  context: BrowserContext
): Promise<CourseSection[]> {
  console.log(`\nScraping CCV (${BASE_URL}) for ${termName}...`);

  const page = await context.newPage();
  const allSections: CourseSection[] = [];

  try {
    // Step 1: Load the course catalog page to get CSRF token and subjects
    console.log(`  Loading course catalog...`);
    await page.goto(`${BASE_URL}/Student/Courses`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    // Handle guest access — click "Continue as Guest" or equivalent
    const guestBtns = await page.$$("text=Continue as Guest");
    if (guestBtns.length > 0) {
      console.log("  Clicking 'Continue as Guest'...");
      await guestBtns[0].click();
      await page.waitForTimeout(2000);
    }

    // Try navigating with guest user flag
    const currentUrl = page.url();
    if (currentUrl.includes("Login") || currentUrl.includes("login")) {
      console.log("  Redirected to login, trying guest access...");
      await page.goto(`${BASE_URL}/Student/Courses?guestUser=true`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await page.waitForTimeout(3000);
    }

    // Extract CSRF token
    const csrfToken = await page.evaluate(() => {
      const el = document.querySelector('input[name="__RequestVerificationToken"]');
      return el ? (el as HTMLInputElement).value : "";
    });

    if (!csrfToken) {
      console.error("  ERROR: Could not extract CSRF token");
      await page.close();
      return [];
    }
    console.log(`  CSRF token: ${csrfToken.slice(0, 20)}...`);

    // Step 2: Find the right term code
    const termOptions = await page.evaluate(() => {
      const select = document.querySelector("#term-id") as HTMLSelectElement;
      if (!select) return [];
      return Array.from(select.options).map((o) => ({
        value: o.value,
        text: o.textContent?.trim() || "",
      }));
    });

    console.log(`  Available terms: ${termOptions.map((t) => t.text).join(", ")}`);

    // Find matching term
    const termLower = termName.toLowerCase();
    const matchedTerm = termOptions.find((t) => t.text.toLowerCase().includes(termLower));
    if (!matchedTerm) {
      console.error(`  ERROR: Could not find term matching "${termName}"`);
      console.log("  Available:", termOptions.map((t) => t.text));
      await page.close();
      return [];
    }

    const termCode = matchedTerm.value;
    console.log(`  Matched term: "${matchedTerm.text}" → code "${termCode}"`);

    // Convert to standard term format (e.g. "2026FA")
    let standardTerm = "";
    if (/fall/i.test(matchedTerm.text)) {
      const yearMatch = matchedTerm.text.match(/\d{4}/);
      standardTerm = yearMatch ? `${yearMatch[0]}FA` : termCode;
    } else if (/spring/i.test(matchedTerm.text)) {
      const yearMatch = matchedTerm.text.match(/\d{4}/);
      standardTerm = yearMatch ? `${yearMatch[0]}SP` : termCode;
    } else if (/summer/i.test(matchedTerm.text)) {
      const yearMatch = matchedTerm.text.match(/\d{4}/);
      standardTerm = yearMatch ? `${yearMatch[0]}SU` : termCode;
    } else {
      standardTerm = termCode;
    }

    // Step 3: Get subject list
    let subjects: { Code: string; Description: string }[] = [];

    try {
      const advSearch = await page.evaluate(
        async ({ url, token }: { url: string; token: string }) => {
          const resp = await fetch(url, {
            method: "GET",
            headers: {
              Accept: "application/json, text/javascript, */*; q=0.01",
              "X-Requested-With": "XMLHttpRequest",
              __RequestVerificationToken: token,
              __IsGuestUser: "true",
            },
          });
          return await resp.json();
        },
        { url: `${BASE_URL}/Student/Courses/GetCatalogAdvancedSearch`, token: csrfToken }
      );

      if (advSearch?.Subjects) {
        subjects = advSearch.Subjects;
      }
    } catch {
      console.log("  GetCatalogAdvancedSearch failed, extracting from DOM...");
    }

    // Fallback: extract from DOM
    if (subjects.length === 0) {
      const domSubjects = await page.evaluate(() => {
        const select = document.querySelector("#subject-0") as HTMLSelectElement;
        if (!select) return [];
        return Array.from(select.options)
          .filter((o) => o.value)
          .map((o) => ({ Code: o.value, Description: o.textContent?.trim() || "" }));
      });
      subjects = domSubjects;
    }

    // Filter to CCV subjects only if possible (VSC instance shares CCV + VTSU)
    // CCV subjects typically have codes like ENG, MAT, BIO, etc.
    console.log(`  Found ${subjects.length} subjects`);

    // Step 4: Search each subject
    const coursesWithRequisites = new Map<string, string>();

    for (let si = 0; si < subjects.length; si++) {
      const subject = subjects[si];
      let pageNumber = 1;
      let totalPages = 1;

      while (pageNumber <= totalPages) {
        try {
          const searchBody = {
            keyword: null,
            terms: [termCode],
            subjects: [subject.Code],
            pageNumber,
            quantityPerPage: PAGE_SIZE,
            sortOn: "SectionName",
            sortDirection: "Ascending",
            requirement: null,
            subrequirement: null,
            courseIds: null,
            sectionIds: null,
            academicLevels: [],
            courseLevels: [],
            locations: [],
            faculty: [],
            days: [],
            startDate: null,
            endDate: null,
            subjectsBadge: [],
            locationsBadge: [],
            termFiltersBadge: [],
            daysBadge: [],
            facultyBadge: [],
            academicLevelsBadge: [],
            courseLevelsBadge: [],
            searchResultsView: "SectionListing",
          };

          const response: ColleagueSearchResponse = await page.evaluate(
            async ({ url, body, token }: { url: string; body: unknown; token: string }) => {
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
            { url: `${BASE_URL}/Student/Courses/PostSearchCriteria`, body: searchBody, token: csrfToken }
          );

          totalPages = response.TotalPages || 1;

          if (!response.Sections || response.Sections.length === 0) break;

          for (const sec of response.Sections) {
            const meeting = sec.FormattedMeetingTimes?.[0];
            const isOnline = meeting?.IsOnline || false;

            const courseKey = `${sec.Course.SubjectCode} ${sec.Course.Number}`;

            // Track courses that have requisites for batch prereq fetch
            if (sec.Course.Requisites && sec.Course.Requisites.length > 0) {
              if (!coursesWithRequisites.has(courseKey)) {
                coursesWithRequisites.set(courseKey, sec.Id);
              }
            }

            const mode = determineMode({
              locationCode: sec.LocationCode || "",
              locationDisplay: sec.LocationDisplay || "",
              isOnline,
              meetingsDisplay: sec.MeetingsDisplay || [],
            });

            const section: CourseSection = {
              college_code: SLUG,
              term: standardTerm,
              course_prefix: sec.Course.SubjectCode,
              course_number: sec.Course.Number,
              course_title: sec.Course.Title,
              credits: sec.Course.MinimumCredits || sec.MinimumCredits || 0,
              crn: sec.SectionNameDisplay || "",
              days: meeting ? formatDays(meeting.DaysOfWeekDisplay || "") : "",
              start_time: meeting?.StartTimeDisplay || "",
              end_time: meeting?.EndTimeDisplay || "",
              start_date: normalizeDate(sec.StartDateDisplay || ""),
              location: meeting ? `${meeting.BuildingDisplay || ""} ${meeting.RoomDisplay || ""}`.trim() : "",
              campus: sec.LocationDisplay || "",
              mode,
              instructor: sec.FacultyDisplay?.join(", ") || null,
              seats_open: sec.Available,
              seats_total: sec.Capacity,
              prerequisite_text: null,
              prerequisite_courses: [],
            };

            allSections.push(section);
          }

          pageNumber++;
          if (pageNumber <= totalPages) await sleep(200);
        } catch (err) {
          console.error(`  ERROR on ${subject.Code} page ${pageNumber}:`, err);
          break;
        }
      }

      if (allSections.length > 0 && (si + 1) % 10 === 0) {
        console.log(`  [${si + 1}/${subjects.length}] ${allSections.length} sections so far...`);
      }

      await sleep(DELAY_MS);
    }

    console.log(`  Total sections found: ${allSections.length}`);

    // Step 5: Fetch prerequisites in batch
    if (coursesWithRequisites.size > 0) {
      const prereqMap = await fetchSectionPrerequisites(page, csrfToken, coursesWithRequisites);

      // Apply prereqs to all sections
      for (const section of allSections) {
        const key = `${section.course_prefix} ${section.course_number}`;
        const prereq = prereqMap.get(key);
        if (prereq) {
          section.prerequisite_text = prereq.text;
          section.prerequisite_courses = prereq.courses;
        }
      }

      const withPrereqs = allSections.filter((s) => s.prerequisite_text).length;
      console.log(`  Applied prerequisites: ${prereqMap.size} courses (${withPrereqs} sections)`);
    }
  } catch (err) {
    console.error(`  FATAL ERROR:`, err);
  } finally {
    await page.close();
  }

  return allSections;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const termIdx = args.indexOf("--term");
  const overrideTermNames = termIdx >= 0
    ? args[termIdx + 1].split(",").map((t) => t.trim()).filter(Boolean)
    : null;

  let termNames: string[];
  if (overrideTermNames) {
    termNames = overrideTermNames;
  } else {
    const discovered = await resolveCollegeTerms(BASE_URL, { freezeContext: { state: STATE, slug: SLUG } });
    if (discovered.length === 0) {
      console.log(`No terms discovered at ${BASE_URL} (offline, gated, or no live sections); nothing to do.`);
      return;
    }
    termNames = discovered.map((t) => t.name);
    console.log(`Discovered ${termNames.length} term(s): ${termNames.join(", ")}`);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  try {
    for (const termName of termNames) {
      const sections = await scrapeCollege(termName, context);

      if (sections.length > 0) {
        const standardTerm = sections[0].term;
        const fileTermCode = standardTerm.replace(/[\\/]/g, "-");
        const outDir = path.join(process.cwd(), "data", STATE, "courses", SLUG);
        fs.mkdirSync(outDir, { recursive: true });
        const outPath = path.join(outDir, `${fileTermCode}.json`);
        fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
        const withPrereqs = sections.filter((s) => s.prerequisite_text).length;
        console.log(`  → ${sections.length} sections written to ${outPath} (${withPrereqs} with prereqs)`);
      } else {
        console.log(`  No sections found for ${termName}.`);
      }
    }

    // Auto-import into Supabase (skip with --no-import)
    if (!args.includes("--no-import")) {
      const { importCoursesToSupabase } = await import("../lib/supabase-import");
      await importCoursesToSupabase(STATE);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

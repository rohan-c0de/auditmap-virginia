/**
 * scrape-colleague.ts
 *
 * Scrapes course section data from SC technical colleges that use
 * Ellucian Colleague Self-Service. Uses Playwright to handle the
 * SPA rendering and CSRF token requirements, then calls the internal
 * PostSearchCriteria API for each subject to get full section data.
 *
 * Usage:
 *   npx tsx scripts/sc/scrape-colleague.ts --college aiken
 *   npx tsx scripts/sc/scrape-colleague.ts --college aiken --term "Spring 2026"
 *   npx tsx scripts/sc/scrape-colleague.ts --all
 */

import * as fs from "fs";
import * as path from "path";
import { chromium, type Page, type BrowserContext } from "playwright";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DELAY_MS = 500;
const PAGE_SIZE = 500; // max per request to minimize pagination

// SC technical colleges using Ellucian Colleague Self-Service
const COLLEAGUE_COLLEGES: Record<string, string> = {
  "aiken": "https://courses.atc.edu",
  "denmark": "https://selfservice.denmarktech.edu",
  "florence-darlington": "https://selfservice.fdtc.edu",
  "spartanburg": "https://selfserviceprod.sccsc.edu:8172",
  "lowcountry": "https://selfservice.tcl.edu",
  "central-carolina": "https://ssb.cctech.edu",
};

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

/** Convert "M/D/YYYY" or "MM/DD/YYYY" to "YYYY-MM-DD" */
function normalizeDate(dateStr: string): string {
  if (!dateStr) return "";
  // Already YYYY-MM-DD
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

  // Check for hybrid indicators
  if (loc.includes("hybrid") || allMeetings.includes("hybrid")) return "hybrid";

  // Check for fully online
  if (section.isOnline || loc === "online" || section.locationCode === "ONL") {
    // Synchronous online = zoom
    if (allMeetings.includes("synchronous") || allMeetings.includes("zoom") ||
        allMeetings.includes("teams") || allMeetings.includes("remote")) {
      return "zoom";
    }
    return "online";
  }

  // Virtual with required times = zoom
  if (loc.includes("virtual") && loc.includes("required")) return "zoom";

  return "in-person";
}

function formatDays(daysOfWeekDisplay: string): string {
  if (!daysOfWeekDisplay) return "";
  // Input is like "T/Th" or "M/W/F" or "M, W, F"
  return daysOfWeekDisplay
    .replace(/\//g, " ")
    .replace(/,\s*/g, " ")
    .trim();
}

function parsePrerequisites(requisites: Array<{ CorequisiteCourseId?: string; IsRequired?: boolean }>): {
  text: string | null;
  courses: string[];
} {
  if (!requisites || requisites.length === 0) return { text: null, courses: [] };
  const courses = requisites
    .filter((r) => r.CorequisiteCourseId)
    .map((r) => r.CorequisiteCourseId!);
  return {
    text: courses.length > 0 ? `Prerequisites: ${courses.join(", ")}` : null,
    courses,
  };
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
    Requisites: Array<{ CorequisiteCourseId?: string; IsRequired?: boolean }>;
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
  slug: string,
  baseUrl: string,
  termName: string,
  context: BrowserContext
): Promise<CourseSection[]> {
  console.log(`\nScraping ${slug} (${baseUrl}) for ${termName}...`);

  const page = await context.newPage();
  const allSections: CourseSection[] = [];

  try {
    // Step 1: Load the course catalog page to get CSRF token and subjects
    console.log(`  Loading course catalog...`);
    await page.goto(`${baseUrl}/Student/Courses`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    // Check if we were redirected to a login page
    const currentUrl = page.url();
    if (currentUrl.includes("/Account/Login")) {
      console.log(`  Redirected to login page, looking for guest access...`);

      // Try clicking "Continue as Guest" / "Search as Guest" links/buttons
      const guestLink = await page.$(
        'a:has-text("Guest"), a:has-text("guest"), a:has-text("Search"), button:has-text("Guest")'
      );
      if (guestLink) {
        await guestLink.click();
        await page.waitForTimeout(3000);
        console.log(`  Clicked guest access link`);
      } else {
        // Try navigating to guest course catalog URL
        console.log(`  No guest link found, trying guest URL...`);
        await page.goto(`${baseUrl}/Student/Courses?guestUser=true`, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        await page.waitForTimeout(3000);

        // Still on login page?
        if (page.url().includes("/Account/Login")) {
          console.error(`  ${slug} requires authentication — no guest access available. Skipping.`);
          return [];
        }
      }
    }

    // Extract CSRF token
    const csrfToken = await page.evaluate(() => {
      const input = document.querySelector(
        'input[name="__RequestVerificationToken"]'
      ) as HTMLInputElement;
      return input?.value || null;
    });

    if (!csrfToken) {
      console.error(`  Could not find CSRF token for ${slug}`);
      return [];
    }
    console.log(`  Got CSRF token`);

    // Find the correct term code from the select dropdown
    const termOptions = await page.evaluate(() => {
      const select = document.getElementById("term-id") as HTMLSelectElement;
      if (!select) return [];
      return Array.from(select.options).map((o) => ({
        value: o.value,
        label: o.textContent?.trim() || "",
      }));
    });

    // Flexible term matching: "Spring 2026" should match "Spring 2026", "Spring Semester 2026", etc.
    const termNameLower = termName.toLowerCase();
    const termParts = termNameLower.split(/\s+/); // e.g., ["spring", "2026"]

    // Build expected term code from name (e.g., "Spring 2026" → "2026SP")
    const seasonCodeMap: Record<string, string> = {
      spring: "SP", summer: "SU", fall: "FA", winter: "WI",
    };
    const yearMatch = termName.match(/(\d{4})/);
    const seasonMatch = termName.match(/(spring|summer|fall|winter)/i);
    const expectedTermCode = yearMatch && seasonMatch
      ? `${yearMatch[1]}${seasonCodeMap[seasonMatch[1].toLowerCase()] || ""}`
      : null;

    const termOption = termOptions.find(
      (t) => {
        const label = t.label.toLowerCase();
        const value = t.value;
        // Exact label match
        if (label === termNameLower) return true;
        // All parts of the search term appear in the label (e.g., "spring" and "2026" both in "Spring Semester 2026")
        if (termParts.every((part) => label.includes(part)) && !label.includes("ce")) return true;
        // Match by term code (e.g., value "2026SP" or label "2026SP")
        if (expectedTermCode && (value === expectedTermCode || label === expectedTermCode.toLowerCase())) return true;
        return false;
      }
    );
    if (!termOption || !termOption.value) {
      console.error(`  Term "${termName}" not found. Available: ${termOptions.map((t) => t.label || t.value).join(", ")}`);
      return [];
    }
    const termCode = termOption.value;
    console.log(`  Using term code: ${termCode}`);

    // Get subject list from the advanced search API
    let subjects: Array<{ Code: string; Description: string }> = [];

    // Try fetching from the API endpoint
    const advSearchResp = await page.evaluate(async (url) => {
      try {
        const resp = await fetch(url);
        const data = await resp.json();
        return data.Subjects || [];
      } catch {
        return [];
      }
    }, `${baseUrl}/Student/Courses/GetCatalogAdvancedSearch`);

    if (advSearchResp.length > 0) {
      subjects = advSearchResp;
    } else {
      // Fallback: extract from the select element
      subjects = await page.evaluate(() => {
        const select = document.getElementById("subject-0") as HTMLSelectElement;
        if (!select) return [];
        return Array.from(select.options)
          .filter((o) => o.value)
          .map((o) => ({ Code: o.value, Description: o.textContent?.trim() || "" }));
      });
    }

    console.log(`  Found ${subjects.length} subjects to search`);

    // Step 2: For each subject, search via PostSearchCriteria API
    const cookies = await context.cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    for (let i = 0; i < subjects.length; i++) {
      const subject = subjects[i];
      process.stdout.write(
        `  [${i + 1}/${subjects.length}] ${subject.Code.padEnd(5)} `
      );

      let pageNumber = 1;
      let totalPages = 1;
      let subjectCount = 0;

      while (pageNumber <= totalPages) {
        const requestBody = {
          keyword: null,
          terms: [termCode],
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
          subjects: [subject.Code],
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
          pageNumber,
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
          quantityPerPage: PAGE_SIZE,
          openAndWaitlistedSections: null,
          searchResultsView: "SectionListing",
        };

        try {
          const response = await page.evaluate(
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
          );

          const data = response as ColleagueSearchResponse;

          if (pageNumber === 1) {
            totalPages = data.TotalPages || 1;
          }

          if (data.Sections && data.Sections.length > 0) {
            for (const s of data.Sections) {
              const meeting = s.FormattedMeetingTimes?.[0];
              const isOnline = meeting?.IsOnline || false;
              const prereqs = parsePrerequisites(s.Course?.Requisites || []);

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
                mode: determineMode({
                  locationCode: s.LocationCode || "",
                  locationDisplay: s.LocationDisplay || "",
                  isOnline,
                  meetingsDisplay: s.MeetingsDisplay || [],
                }),
                instructor: s.FacultyDisplay?.join(", ") || null,
                seats_open: s.Available ?? null,
                seats_total: s.Capacity ?? null,
                prerequisite_text: prereqs.text,
                prerequisite_courses: prereqs.courses,
              });
              subjectCount++;
            }
          }
        } catch (e) {
          console.error(`API error: ${e}`);
          break;
        }

        pageNumber++;
        if (pageNumber <= totalPages) {
          await sleep(200);
        }
      }

      console.log(
        `${subjectCount} sections${totalPages > 1 ? ` (${totalPages} pages)` : ""}`
      );
      await sleep(DELAY_MS);
    }
  } catch (e) {
    console.error(`  Error scraping ${slug}: ${e}`);
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
  const collegeFlag = args.indexOf("--college");
  const termFlag = args.indexOf("--term");
  const allFlag = args.includes("--all");

  const termName = termFlag >= 0 ? args[termFlag + 1] : "Spring 2026";

  let targets: [string, string][];

  if (allFlag) {
    targets = Object.entries(COLLEAGUE_COLLEGES);
  } else if (collegeFlag >= 0) {
    const slug = args[collegeFlag + 1];
    const baseUrl = COLLEAGUE_COLLEGES[slug];
    if (!baseUrl) {
      console.error(`Unknown college: ${slug}`);
      console.error(`Available: ${Object.keys(COLLEAGUE_COLLEGES).join(", ")}`);
      process.exit(1);
    }
    targets = [[slug, baseUrl]];
  } else {
    console.log("Usage:");
    console.log("  npx tsx scripts/sc/scrape-colleague.ts --college aiken");
    console.log('  npx tsx scripts/sc/scrape-colleague.ts --college aiken --term "Fall 2026"');
    console.log("  npx tsx scripts/sc/scrape-colleague.ts --all");
    process.exit(0);
  }

  console.log(`Scraping ${targets.length} college(s) for ${termName}...\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  for (const [slug, baseUrl] of targets) {
    const sections = await scrapeCollege(slug, baseUrl, termName, context);

    if (sections.length > 0) {
      const rawTermCode = sections[0].term;
      // Normalize term codes like "2026SU1" → "2026SU" for consistent file naming
      const termCode = rawTermCode.replace(/^(\d{4}(?:SP|SU|FA)).*$/, "$1");
      if (termCode !== rawTermCode) {
        for (const s of sections) s.term = termCode;
      }
      const outDir = path.join(process.cwd(), "data", "sc", "courses", slug);
      fs.mkdirSync(outDir, { recursive: true });
      const outPath = path.join(outDir, `${termCode}.json`);
      fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
      console.log(`\n  Written ${sections.length} sections to ${outPath}`);
    } else {
      console.log(`\n  No sections found for ${slug}`);
    }

    await sleep(DELAY_MS);
  }

  await browser.close();
  console.log("\nDone.");
}

main().catch(console.error);

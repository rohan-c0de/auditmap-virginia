/**
 * scrape-colleague.ts
 *
 * Scrapes course section data from Massachusetts community colleges that
 * use Ellucian Colleague Self-Service. Cloned from scripts/md/scrape-colleague.ts
 * with the college map swapped (otherwise identical logic).
 *
 * Covered (3 of MA's 15 CCs):
 *   berkshire   bcc-ss.colleague.elluciancloud.com   (migrated to Ellucian
 *                                                     Cloud; old collselfserv
 *                                                     instance only serves
 *                                                     terms through 2023)
 *   bhcc        selfservice.bhcc.edu
 *   stcc        studentwebsvr.stcc.edu:9016
 *
 * Usage:
 *   npx tsx scripts/ma/scrape-colleague.ts --college bhcc
 *   npx tsx scripts/ma/scrape-colleague.ts --college bhcc --term "Fall 2026"
 *   npx tsx scripts/ma/scrape-colleague.ts --all
 */

import * as fs from "fs";
import * as path from "path";
import { chromium, type Page, type BrowserContext } from "playwright";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DELAY_MS = 500;
const PAGE_SIZE = 500;

// MA community colleges using Ellucian Colleague Self-Service
const COLLEAGUE_COLLEGES: Record<string, string> = {
  berkshire: "https://bcc-ss.colleague.elluciancloud.com",
  bhcc: "https://selfservice.bhcc.edu",
  stcc: "https://studentwebsvr.stcc.edu:9016",
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

function formatDays(daysOfWeekDisplay: string): string {
  if (!daysOfWeekDisplay) return "";
  return daysOfWeekDisplay
    .replace(/\//g, " ")
    .replace(/,\s*/g, " ")
    .trim();
}

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

  const itemGroups: {
    courses: string[];
    gradeNote: string;
    hasOr: boolean;
  }[] = [];

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

  const seen = new Map<
    string,
    { courses: string[]; gradeNote: string; hasOr: boolean }
  >();
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
    const partText = group.courses
      .map((c) => {
        if (!allCourses.includes(c)) allCourses.push(c);
        return `${c}${group.gradeNote}`;
      })
      .join(connector);
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
  baseUrl: string,
  csrfToken: string,
  coursesWithRequisites: Map<string, string>
): Promise<Map<string, { text: string | null; courses: string[] }>> {
  console.log(
    `  Fetching prerequisites for ${coursesWithRequisites.size} courses with requisites...`
  );

  const prereqMap = new Map<
    string,
    { text: string | null; courses: string[] }
  >();
  const entries = Array.from(coursesWithRequisites.entries());
  const BATCH_SIZE = 10;
  let fetched = 0;

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
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
      if (parsed.text) {
        prereqMap.set(courseKey, parsed);
      }
    }

    fetched += batch.length;
    if (fetched % 50 === 0 || fetched === entries.length) {
      console.log(
        `    prereqs: ${fetched}/${entries.length} (${prereqMap.size} with prereqs)`
      );
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
    console.log(`  Loading course catalog...`);
    await page.goto(`${baseUrl}/Student/Courses`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    // Check for login redirect
    const currentUrl = page.url();
    if (currentUrl.includes("/Account/Login")) {
      console.log(`  Redirected to login page, looking for guest access...`);

      const guestLink = await page.$(
        'a:has-text("Guest"), a:has-text("guest"), a:has-text("Search"), button:has-text("Guest")'
      );
      if (guestLink) {
        await guestLink.click();
        await page.waitForTimeout(3000);
        console.log(`  Clicked guest access link`);
      } else {
        console.log(`  No guest link found, trying guest URL...`);
        await page.goto(`${baseUrl}/Student/Courses?guestUser=true`, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        await page.waitForTimeout(3000);

        if (page.url().includes("/Account/Login")) {
          console.error(
            `  ${slug} requires authentication — no guest access available. Skipping.`
          );
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

    // Find the correct term code
    const termOptions = await page.evaluate(() => {
      const select = document.getElementById("term-id") as HTMLSelectElement;
      if (!select) return [];
      return Array.from(select.options).map((o) => ({
        value: o.value,
        label: o.textContent?.trim() || "",
      }));
    });

    const termNameLower = termName.toLowerCase();
    const termParts = termNameLower.split(/\s+/);

    const seasonCodeMap: Record<string, string> = {
      spring: "SP",
      summer: "SU",
      fall: "FA",
      winter: "WI",
    };
    const yearMatch = termName.match(/(\d{4})/);
    const seasonMatch = termName.match(/(spring|summer|fall|winter)/i);
    const expectedTermCode =
      yearMatch && seasonMatch
        ? `${yearMatch[1]}${seasonCodeMap[seasonMatch[1].toLowerCase()] || ""}`
        : null;

    const termOption = termOptions.find((t) => {
      const label = t.label.toLowerCase();
      const value = t.value;
      if (expectedTermCode && value === expectedTermCode) return true;
      if (label === termNameLower) return true;
      if (
        termParts.every((part) => label.includes(part)) &&
        !label.includes("ce") &&
        !label.includes("reporting")
      )
        return true;
      if (expectedTermCode && label === expectedTermCode.toLowerCase())
        return true;
      return false;
    });
    if (!termOption || !termOption.value) {
      console.error(
        `  Term "${termName}" not found. Available: ${termOptions.map((t) => t.label || t.value).join(", ")}`
      );
      return [];
    }
    const termCode = termOption.value;
    console.log(`  Using term code: ${termCode}`);

    // Get subject list
    let subjects: Array<{ Code: string; Description: string }> = [];

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
      subjects = await page.evaluate(() => {
        const select = document.getElementById(
          "subject-0"
        ) as HTMLSelectElement;
        if (!select) return [];
        return Array.from(select.options)
          .filter((o) => o.value)
          .map((o) => ({
            Code: o.value,
            Description: o.textContent?.trim() || "",
          }));
      });
    }

    console.log(`  Found ${subjects.length} subjects to search`);

    // Track courses with requisites
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

              if (s.Course?.Requisites?.length > 0) {
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
                mode: determineMode({
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
        if (pageNumber <= totalPages) {
          await sleep(200);
        }
      }

      console.log(
        `${subjectCount} sections${totalPages > 1 ? ` (${totalPages} pages)` : ""}`
      );
      await sleep(DELAY_MS);
    }

    // Fetch prerequisites
    if (coursesWithRequisites.size > 0) {
      const prereqMap = await fetchSectionPrerequisites(
        page,
        baseUrl,
        csrfToken,
        coursesWithRequisites
      );
      for (const section of allSections) {
        const key = `${section.course_prefix} ${section.course_number}`;
        const prereq = prereqMap.get(key);
        if (prereq) {
          section.prerequisite_text = prereq.text;
          section.prerequisite_courses = prereq.courses;
        }
      }
      console.log(
        `  Updated ${prereqMap.size} courses with prerequisite info`
      );
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

  const termName = termFlag >= 0 ? args[termFlag + 1] : "Fall 2026";

  let targets: [string, string][];

  if (allFlag) {
    targets = Object.entries(COLLEAGUE_COLLEGES);
  } else if (collegeFlag >= 0) {
    const slug = args[collegeFlag + 1];
    const baseUrl = COLLEAGUE_COLLEGES[slug];
    if (!baseUrl) {
      console.error(`Unknown college: ${slug}`);
      console.error(
        `Available: ${Object.keys(COLLEAGUE_COLLEGES).join(", ")}`
      );
      process.exit(1);
    }
    targets = [[slug, baseUrl]];
  } else {
    console.log("Usage:");
    console.log("  npx tsx scripts/ma/scrape-colleague.ts --college bhcc");
    console.log(
      '  npx tsx scripts/ma/scrape-colleague.ts --college bhcc --term "Fall 2026"'
    );
    console.log("  npx tsx scripts/ma/scrape-colleague.ts --all");
    process.exit(0);
  }

  console.log(`Scraping ${targets.length} MA college(s) for ${termName}...\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ignoreHTTPSErrors: true,
  });

  for (const [slug, baseUrl] of targets) {
    const sections = await scrapeCollege(slug, baseUrl, termName, context);

    if (sections.length > 0) {
      const rawTermCode = sections[0].term;
      // Normalize: strip slashes (e.g. "2026/FA" → "2026FA", "26/FA" → "2026FA")
      let termCode = rawTermCode.replace(/\//g, "");
      // Normalize SM → SU (some Colleague portals use SM for Summer)
      termCode = termCode.replace(/SM$/, "SU").replace(/SM(\d)/, "SU$1");
      // Fix 2-digit year prefix (e.g. "26FA" → "2026FA")
      if (/^\d{2}(SP|SU|FA)$/.test(termCode)) {
        termCode = "20" + termCode;
      }
      termCode = termCode.replace(/^(\d{4}(?:SP|SU|FA)).*$/, "$1");
      if (termCode !== rawTermCode) {
        for (const s of sections) s.term = termCode;
      }
      const outDir = path.join(process.cwd(), "data", "ma", "courses", slug);
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

  // Auto-import into Supabase (skip with --no-import)
  if (!args.includes("--no-import")) {
    const { importCoursesToSupabase } = await import("../lib/supabase-import");
    await importCoursesToSupabase("ma");
  }

  console.log("\nDone.");
}

main().catch(console.error);

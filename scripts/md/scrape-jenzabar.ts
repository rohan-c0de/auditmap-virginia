/**
 * scrape-jenzabar.ts
 *
 * Scrapes course section data from Maryland community colleges that use
 * Jenzabar JICS (Internet Campus Solution) portlets. Uses Playwright
 * because Jenzabar JICS is a heavily JavaScript-driven portal.
 *
 * Covers: Cecil College, Garrett College
 *
 * Usage:
 *   npx tsx scripts/md/scrape-jenzabar.ts --college cecil
 *   npx tsx scripts/md/scrape-jenzabar.ts --all
 */

import fs from "fs";
import path from "path";
import { chromium, type Page, type Browser } from "playwright";

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

// Jenzabar JICS colleges — course search portlet URLs
const JENZABAR_COLLEGES: Record<string, { baseUrl: string; searchPath: string }> = {
  cecil: {
    baseUrl: "https://my.cecil.edu",
    // Bare /ICS/Course_Search.jnz lands on cecil's Free-form_Content welcome
    // portlet (no search form rendered). The actual public guest search lives
    // under the Student_Registration portlet with screen specifier — same
    // ?portlet=...&screen=... pattern garrett uses.
    searchPath:
      "/ICS/Course_Search.jnz?portlet=Student_Registration&screen=StudentRegistrationPortlet_CourseSearchView&screenType=next",
  },
  garrett: {
    baseUrl: "https://my.garrettcollege.edu",
    searchPath:
      "/ICS/Portal_Homepage.jnz?portlet=AddDrop_Courses&screen=Advanced+Course+Search&screenType=next",
  },
};

// Standard term mapping. Allow filler words between season and year
// so "Spring Credit 2026" (cecil) also resolves to 2026SP, not XXXX.
function toStandardTerm(termDesc: string): string {
  const match = termDesc.match(/(spring|summer|fall|winter)[^\d]*(\d{4})/i);
  if (!match) return "XXXX";
  const season = match[1].toLowerCase();
  const year = match[2];
  if (season === "fall") return `${year}FA`;
  if (season === "spring") return `${year}SP`;
  if (season === "summer") return `${year}SU`;
  if (season === "winter") return `${year}SP`; // Winter often maps to spring term
  return `${year}XX`;
}

function detectMode(text: string): CourseMode {
  const lower = text.toLowerCase();
  if (lower.includes("hybrid")) return "hybrid";
  if (lower.includes("online") || lower.includes("virtual") || lower.includes("distance")) {
    return "online";
  }
  if (lower.includes("zoom") || lower.includes("synchronous remote")) {
    return "zoom";
  }
  return "in-person";
}

function parseDays(dayStr: string): string {
  // Jenzabar may use formats like "M W F", "MWF", "TR", "M/W/F", etc.
  const days: string[] = [];
  const clean = dayStr.replace(/[/,]/g, " ").toUpperCase();

  if (clean.includes("M") && !clean.includes("MO")) days.push("M");
  if (clean.includes("MO")) days.push("M");
  if (clean.includes("TU") || (clean.includes("T") && !clean.includes("TH") && !clean.includes("TU"))) {
    // Be careful: T could be Tu or Th
    if (clean.includes("TU")) days.push("Tu");
    else if (clean.match(/\bT\b/)) days.push("Tu");
  }
  if (clean.includes("W") && !clean.includes("WE")) days.push("W");
  if (clean.includes("WE")) days.push("W");
  if (clean.includes("TH") || clean.includes("R")) days.push("Th");
  if (clean.includes("F") && !clean.includes("FR")) days.push("F");
  if (clean.includes("FR")) days.push("F");
  if (clean.includes("SA") || clean.includes("S")) {
    if (clean.includes("SA")) days.push("Sa");
    else if (clean.match(/\bS\b/) && !days.includes("Sa")) days.push("Sa");
  }
  if (clean.includes("SU")) days.push("Su");

  // Fallback: if the simple parsing didn't work, try character-by-character
  if (days.length === 0) {
    for (const ch of dayStr) {
      switch (ch) {
        case "M": if (!days.includes("M")) days.push("M"); break;
        case "T": if (!days.includes("Tu")) days.push("Tu"); break;
        case "W": if (!days.includes("W")) days.push("W"); break;
        case "R": if (!days.includes("Th")) days.push("Th"); break;
        case "F": if (!days.includes("F")) days.push("F"); break;
        case "S": if (!days.includes("Sa")) days.push("Sa"); break;
      }
    }
  }

  return days.join("");
}

async function scrapeJenzabar(
  page: Page,
  slug: string,
  config: { baseUrl: string; searchPath: string },
  targetTerm: string
): Promise<CourseSection[]> {
  const sections: CourseSection[] = [];
  const url = `${config.baseUrl}${config.searchPath}`;

  console.log(`  Navigating to ${url}`);
  // `load` rather than `networkidle` — garrett's JICS has persistent analytics
  // activity that never quiesces, causing a 30s timeout. `load` waits for
  // resources without hanging on never-idle networks. The waitForTimeout below
  // already gives JS-rendered widgets (term dropdown, etc.) time to settle.
  await page.goto(url, { waitUntil: "load", timeout: 30000 });

  // Wait for the page to load
  await page.waitForTimeout(2000);

  // Some JICS portals (cecil) gate the actual form behind an Osano cookie
  // consent banner — until it's dismissed the search form scripts don't
  // execute. Try common Accept buttons; ignore if not present.
  for (const cookieSel of [
    'button:has-text("Accept")',
    'button:has-text("Allow All")',
    "#onetrust-accept-btn-handler",
  ]) {
    const cookieBtn = await page.$(cookieSel);
    if (cookieBtn) {
      try {
        await cookieBtn.click({ timeout: 2000 });
        await page.waitForTimeout(1500);
        console.log(`  Dismissed cookie banner via ${cookieSel}`);
      } catch {
        /* button vanished / not actually visible — ignore */
      }
      break;
    }
  }

  // Try to find and select the target term
  // Jenzabar course search typically has a term dropdown
  const termSelectors = [
    'select[name*="term" i]',
    'select[name*="Term" i]',
    'select[id*="term" i]',
    'select[id*="Term" i]',
    "#pg0_V_ddlTerm",
    "#ddlTerm",
    'select[name="ddlTerm"]',
    "#stuRegTermSelect", // cecil — Student_Registration portlet
  ];

  let termSelect = null;
  for (const sel of termSelectors) {
    const el = await page.$(sel);
    if (el) {
      termSelect = el;
      console.log(`  Found term selector: ${sel}`);
      break;
    }
  }

  let selectedTermDesc = targetTerm;

  if (termSelect) {
    // Get available terms from the dropdown
    const options = await termSelect.evaluate((el: HTMLSelectElement) =>
      Array.from(el.options).map((o) => ({
        value: o.value,
        text: o.text.trim(),
      }))
    );

    console.log(
      `  Available terms: ${options.map((o) => o.text).join(", ")}`
    );

    // Parse the targetTerm into year + semester so we can match against
    // human-readable option text. Required because JICS instances encode
    // their option VALUES inconsistently — garrett's "Fall 2026" carries
    // VALUE="2027;FA" (academic year encoded with END year), so a substring
    // match on "2026FA" against the value or text finds nothing.
    const tm = targetTerm.match(/^(\d{4})(FA|SP|SU|WI)$/i);
    const semWord = tm
      ? { FA: "fall", SP: "spring", SU: "summer", WI: "winter" }[
          tm[2].toUpperCase() as "FA" | "SP" | "SU" | "WI"
        ]
      : null;
    const targetYear = tm ? tm[1] : null;

    // Subterm rows (e.g. "Fall 2026 - Subterm A") split a term in half;
    // skip them in favor of the full-term parent so we don't get half the
    // sections.
    const isSubterm = (t: string) => /subterm|sub-term/i.test(t);

    let bestOption = options.find((o) => {
      if (isSubterm(o.text)) return false;
      const t = o.text.toLowerCase();
      if (semWord && targetYear) {
        return t.includes(semWord) && t.includes(targetYear);
      }
      return t.includes(targetTerm.toLowerCase());
    });
    if (!bestOption) {
      // Fallback: any near-future term that isn't a subterm.
      bestOption = options.find(
        (o) =>
          !isSubterm(o.text) &&
          (o.text.includes("2026") || o.text.includes("2027"))
      );
    }

    if (bestOption) {
      await termSelect.evaluate(
        (el: HTMLSelectElement, val: string) => {
          el.value = val;
          el.dispatchEvent(new Event("change", { bubbles: true }));
        },
        bestOption.value
      );
      selectedTermDesc = bestOption.text;
      console.log(`  Selected term: ${selectedTermDesc}`);
      await page.waitForTimeout(2000);
    }
  }

  const standardTerm = toStandardTerm(selectedTermDesc);
  console.log(`  Standard term: ${standardTerm}`);

  // Cecil short-circuit: the StudentRegistration portlet renders results via
  // an XHR to a private REST endpoint, not a server-rendered HTML table.
  // Driving that endpoint directly via fetch (carrying the page's session
  // cookies) is far more reliable than emulating the form-click and waiting
  // for client-side rendering that never lands on this portlet.
  if (slug === "cecil") {
    console.log("  Cecil: posting to /webserviceproxy/exi/rest/.../pagedsectiondataforsearch");
    const apiUrl = `${config.baseUrl}/ICS/webserviceproxy/exi/rest/studentregistration/pagedsectiondataforsearch?Id=1`;
    const advancedFilters = [
      { name: "courseCode", value: "" },
      { name: "courseCodeType", value: "0" },
      { name: "courseTitle", value: "" },
      { name: "courseTitleType", value: "0" },
      { name: "requirementType", value: "" },
      { name: "division", value: "" },
      { name: "department", value: "" },
      { name: "academicLevel", value: "" },
      { name: "subject", value: "" },
      { name: "campusLocation", value: "" },
      { name: "term", value: "" },
      { name: "beginsAfter", value: "" },
      { name: "beginsBefore", value: "" },
      { name: "method", value: "" },
      { name: "sectionStatus", value: "" },
    ];
    const pageSize = 50;
    let currentPage = 0;
    let allRows: Record<string, string>[] = [];
    while (true) {
      const data: { rows?: Record<string, string>[]; filteredRows?: number } =
        await page.evaluate(
          async (args: { apiUrl: string; pageState: object }) => {
            const r = await fetch(args.apiUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ pageState: args.pageState }),
            });
            return r.json();
          },
          {
            apiUrl,
            pageState: {
              enabled: true,
              keywordFilter: "",
              quickFilters: [],
              sortColumn: "",
              sortAscending: true,
              currentPage,
              pageSize,
              showingAll: false,
              selectedAll: false,
              excludedFromSelection: [],
              includedInSelection: [],
              advancedFilters,
              totalRows: 0,
              filteredRows: 0,
              quickFilterCounts: [],
            },
          },
        );
      const rows = data.rows || [];
      console.log(
        `  cecil API page ${currentPage}: ${rows.length} rows (of ${data.filteredRows ?? "?"} total)`,
      );
      if (rows.length === 0) break;
      allRows = allRows.concat(rows);
      if (data.filteredRows && allRows.length >= data.filteredRows) break;
      currentPage += 1;
      if (currentPage > 50) break; // safety cap
    }
    // Each field is wrapped: <label class='sr-only'>Course Code</label><a>ACC 101 01</a>.
    // Strip the screen-reader label *and its text* first so the visible value
    // isn't prefixed with "Course Code"/"Title"/etc. (which otherwise wins
    // the leading [A-Z]{2,5} match in the course-code regex).
    const stripTags = (s: string | undefined) =>
      (s || "")
        .replace(/<label[^>]*class=['"]sr-only['"][^>]*>[^<]*<\/label>/gi, "")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    // Inline anonymous type — matches the shape of the main page.evaluate
    // call's `rows` declaration below. `RawCourse` was used in an earlier
    // draft of this branch but never defined at file scope, which broke
    // `next build` after #1193 merged.
    const allCourseData: {
      title: string;
      prefix: string;
      number: string;
      crn: string;
      credits: string;
      days: string;
      times: string;
      location: string;
      campus: string;
      instructor: string;
      seats: string;
    }[] = [];
    for (const row of allRows) {
      const codeRaw = stripTags(row.courseCode);
      // codeRaw looks like "ACC 101 01" with extra spaces collapsed
      const m = codeRaw.match(/^([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)\s+(\d+)/);
      if (!m) continue;
      const title = stripTags(row.title);
      if (!title) continue;
      const schedRaw = stripTags(row.schedule);
      // Schedule may be "MW 10:00 AM-11:30 AM" or "6/8/2026 - 8/1/2026 Online Course Asynchronous - *"
      const dayMatch = schedRaw.match(/\b([MTWRFSU]{1,6})\b\s+\d/);
      const timeMatch = schedRaw.match(
        /(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*-\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i,
      );
      allCourseData.push({
        title,
        prefix: m[1],
        number: m[2],
        crn: m[3],
        credits: stripTags(row.credits) || "3",
        days: dayMatch ? dayMatch[1] : "",
        times: timeMatch ? `${timeMatch[1]} - ${timeMatch[2]}` : "",
        location: "",
        campus: "",
        instructor: stripTags(row.faculty),
        seats: stripTags(row.seatsOpen),
      });
    }
    console.log(`  Cecil: parsed ${allCourseData.length} sections from API`);
    // Jump directly to the section-build phase by writing through the same
    // CourseSection-conversion loop the form-click flow uses. The loop expects
    // `allCourseData` to be in scope where it processes rows — so we
    // synthesize a minimal version of the rest of the function here.
    for (const raw of allCourseData) {
      const timeParts = raw.times.match(
        /(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*[-–]\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i,
      );
      const modeStr = [raw.title, raw.campus, raw.location].join(" ");
      sections.push({
        college_code: slug,
        term: standardTerm,
        course_prefix: raw.prefix,
        course_number: raw.number,
        course_title: raw.title,
        credits: parseFloat(raw.credits || "3") || 3,
        crn: raw.crn,
        days: parseDays(raw.days),
        start_time: timeParts ? timeParts[1] : "",
        end_time: timeParts ? timeParts[2] : "",
        start_date: "",
        location: raw.location,
        campus: raw.campus || "Main",
        mode: detectMode(modeStr),
        instructor: raw.instructor || "To be Announced",
        seats_open: null,
        seats_total: null,
        prerequisite_text: null,
        prerequisite_courses: [],
      });
    }
    return sections;
  }

  // Click search button. Text-specific selectors come FIRST so a generic
  // button[type=submit] doesn't accidentally click a Login/Accept button
  // earlier in the DOM (cecil has both).
  const searchBtnSelectors = [
    'button:has-text("Search Courses")',
    'input[type="submit"][value*="Search" i]',
    'input[type="button"][value*="Search" i]',
    'button:has-text("Search")',
    "#pg0_V_btnSearch",
    'a[id*="btnSearch"]',
    'input[value="Search"]',
    'button[type="submit"]',
  ];

  for (const sel of searchBtnSelectors) {
    const btn = await page.$(sel);
    if (btn) {
      console.log(`  Clicking search button: ${sel}`);
      await btn.click();
      break;
    }
  }

  // Wait for results
  await page.waitForTimeout(5000);

  // Extract course data from the results page
  // Jenzabar typically renders results in a table or list
  const courseData = await page.evaluate(() => {
    const rows: {
      title: string;
      prefix: string;
      number: string;
      crn: string;
      credits: string;
      days: string;
      times: string;
      location: string;
      campus: string;
      instructor: string;
      seats: string;
    }[] = [];

    // Strategy 0: Header-aware extraction. Garrett's JICS results table
    // (id="pg0_V_dgCourses") has a th header row like
    //   ["Add", "Textbooks", "Course code", "Name", "Faculty", "Seats Open",
    //    "Status", "Schedule", "Credits", "Begin Date", "End Date"]
    // and data rows where "Course code" is "ACC 210 01" (prefix + number +
    // section in one cell — no separate CRN column). The existing aacc data
    // already stores section numbers in the crn field ("001", "002", ...), so
    // we adopt the same convention here. Schedule combines days/times/location.
    const tablesAll = document.querySelectorAll("table");
    for (const table of tablesAll) {
      const headerCells = Array.from(
        table.querySelectorAll("tr:first-child th, tr:first-child td"),
      ).map((c) => (c.textContent || "").trim().toLowerCase());
      // Inline column lookups — keep zero helper functions inside this
      // page.evaluate body so the bundler doesn't emit __name() decorators
      // that the browser doesn't have at runtime.
      const iCode = headerCells.indexOf("course code");
      const iName = headerCells.indexOf("name");
      if (iCode < 0 || iName < 0) continue; // Not the header-aware table layout.
      const iFaculty = headerCells.indexOf("faculty");
      const iSeats = headerCells.indexOf("seats open");
      const iSched = headerCells.indexOf("schedule");
      const iCred = headerCells.indexOf("credits");

      const dataRows = table.querySelectorAll("tr");
      for (let r = 1; r < dataRows.length; r++) {
        const cells = Array.from(dataRows[r].querySelectorAll("td"));
        if (cells.length < Math.max(iCode, iName) + 1) continue;
        const codeText = (cells[iCode]?.textContent || "").trim();
        // Match "ACC 210 01" → prefix=ACC, number=210, section=01
        const m = codeText.match(/^([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)\s+(\d+)/);
        if (!m) continue;
        const title = (cells[iName]?.textContent || "").trim();
        if (!title) continue; // Skip instruction rows ("TO VIEW TEXTBOOK…").
        const schedCell = iSched >= 0 ? (cells[iSched]?.textContent || "").trim() : "";
        // Schedule format: "MW 10:10 AM-11:40 AM; Main Campus, Building ..."
        const dayMatch = schedCell.match(/^([MTWRFSU]+)\s/);
        const timeMatch = schedCell.match(
          /(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*-\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i,
        );
        rows.push({
          title: title,
          prefix: m[1],
          number: m[2],
          crn: m[3], // section number — matches aacc/etc. convention
          credits: iCred >= 0 ? (cells[iCred]?.textContent || "").trim() : "3",
          days: dayMatch ? dayMatch[1] : "",
          times: timeMatch ? `${timeMatch[1]} - ${timeMatch[2]}` : "",
          location: "",
          campus: "",
          instructor: iFaculty >= 0 ? (cells[iFaculty]?.textContent || "").trim() : "",
          seats: iSeats >= 0 ? (cells[iSeats]?.textContent || "").trim() : "",
        });
      }
    }

    // Strategy 1 (fallback): Look for table rows with course data — used by
    // JICS instances whose results table has no header row we can map.
    if (rows.length === 0) {
    const tables = document.querySelectorAll("table");
    for (const table of tables) {
      const trs = table.querySelectorAll("tr");
      for (const tr of trs) {
        const cells = tr.querySelectorAll("td");
        if (cells.length >= 5) {
          // Try to extract course info from table cells
          const cellTexts = Array.from(cells).map((c) =>
            c.textContent?.trim() || ""
          );
          // Look for a cell that matches course pattern like "ENG 101"
          const courseCell = cellTexts.find((t) =>
            /^[A-Z]{2,5}\s+\d{3,4}/.test(t)
          );
          if (courseCell) {
            const courseMatch = courseCell.match(
              /^([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)/
            );
            if (courseMatch) {
              rows.push({
                title: cellTexts[1] || cellTexts[0] || "",
                prefix: courseMatch[1],
                number: courseMatch[2],
                crn: cellTexts.find((t) => /^\d{5}$/.test(t)) || "",
                credits:
                  cellTexts.find((t) => /^\d+\.?\d*$/.test(t)) || "3",
                days:
                  cellTexts.find((t) =>
                    /^[MTWRFSU]{1,6}$/i.test(t.replace(/\s/g, ""))
                  ) || "",
                times:
                  cellTexts.find((t) =>
                    /\d{1,2}:\d{2}/.test(t)
                  ) || "",
                location: "",
                campus: "",
                instructor:
                  cellTexts.find((t) =>
                    /^[A-Z][a-z]+,\s+[A-Z]/.test(t)
                  ) || "",
                seats: "",
              });
            }
          }
        }
      }
    }
    } // end if(rows.length===0) Strategy 1 fallback

    // Strategy 2: Look for div-based course listings
    if (rows.length === 0) {
      const courseBlocks = document.querySelectorAll(
        '.courseListing, .courseBlock, [class*="course"], .section-listing, .search-result'
      );
      for (const block of courseBlocks) {
        const text = block.textContent || "";
        const courseMatch = text.match(
          /([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)\s*[-–]\s*(.+?)(?:\n|$)/
        );
        if (courseMatch) {
          const crnMatch = text.match(/CRN[:\s]*(\d{5})/i);
          const credMatch = text.match(/(\d+\.?\d*)\s*credit/i);
          const instrMatch = text.match(
            /(?:Instructor|Faculty)[:\s]*([A-Za-z,.\s]+?)(?:\n|$)/i
          );
          const daysMatch = text.match(
            /(?:Days?|Schedule)[:\s]*([MTWRFSU\s/]+?)(?:\n|$)/i
          );
          const timeMatch = text.match(
            /(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*[-–]\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i
          );
          rows.push({
            title: courseMatch[3].trim(),
            prefix: courseMatch[1],
            number: courseMatch[2],
            crn: crnMatch ? crnMatch[1] : "",
            credits: credMatch ? credMatch[1] : "3",
            days: daysMatch ? daysMatch[1].trim() : "",
            times: timeMatch
              ? `${timeMatch[1]} - ${timeMatch[2]}`
              : "",
            location: "",
            campus: "",
            instructor: instrMatch ? instrMatch[1].trim() : "",
            seats: "",
          });
        }
      }
    }

    return rows;
  });

  console.log(`  Found ${courseData.length} raw course entries`);

  // Handle pagination — check for "Next" button
  let pageNum = 1;
  const allCourseData = [...courseData];

  while (true) {
    const nextBtn = await page.$(
      'a:has-text("Next"), a:has-text("»"), .pager-next a, input[value="Next"]'
    );
    if (!nextBtn) break;

    const isDisabled = await nextBtn.evaluate(
      (el) =>
        el.classList.contains("disabled") ||
        el.getAttribute("disabled") === "true" ||
        el.getAttribute("aria-disabled") === "true"
    );
    if (isDisabled) break;

    pageNum++;
    console.log(`  Loading page ${pageNum}...`);
    await nextBtn.click();
    await page.waitForTimeout(3000);

    const moreCourses = await page.evaluate(() => {
      const rows: typeof allCourseData = [];
      // Header-aware Strategy 0 — same logic as the initial extraction
      // above. Garrett-style "Course code | Name | Faculty | …" tables with
      // section embedded in the code cell (no separate CRN column).
      const tables = document.querySelectorAll("table");
      for (const table of tables) {
        const headerCells = Array.from(
          table.querySelectorAll("tr:first-child th, tr:first-child td"),
        ).map((c) => (c.textContent || "").trim().toLowerCase());
        const iCode = headerCells.indexOf("course code");
        const iName = headerCells.indexOf("name");
        if (iCode < 0 || iName < 0) continue;
        const iFaculty = headerCells.indexOf("faculty");
        const iSeats = headerCells.indexOf("seats open");
        const iSched = headerCells.indexOf("schedule");
        const iCred = headerCells.indexOf("credits");
        const trs = table.querySelectorAll("tr");
        for (let r = 1; r < trs.length; r++) {
          const cells = Array.from(trs[r].querySelectorAll("td"));
          if (cells.length < Math.max(iCode, iName) + 1) continue;
          const codeText = (cells[iCode]?.textContent || "").trim();
          const m = codeText.match(/^([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)\s+(\d+)/);
          if (!m) continue;
          const title = (cells[iName]?.textContent || "").trim();
          if (!title) continue;
          const schedCell = iSched >= 0 ? (cells[iSched]?.textContent || "").trim() : "";
          const dayMatch = schedCell.match(/^([MTWRFSU]+)\s/);
          const timeMatch = schedCell.match(
            /(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*-\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i,
          );
          rows.push({
            title: title,
            prefix: m[1],
            number: m[2],
            crn: m[3],
            credits: iCred >= 0 ? (cells[iCred]?.textContent || "").trim() : "3",
            days: dayMatch ? dayMatch[1] : "",
            times: timeMatch ? `${timeMatch[1]} - ${timeMatch[2]}` : "",
            location: "",
            campus: "",
            instructor: iFaculty >= 0 ? (cells[iFaculty]?.textContent || "").trim() : "",
            seats: iSeats >= 0 ? (cells[iSeats]?.textContent || "").trim() : "",
          });
        }
      }
      return rows;
    });

    if (moreCourses.length === 0) break;
    allCourseData.push(...moreCourses);
  }

  // Convert to standard format
  for (const raw of allCourseData) {
    const timeParts = raw.times.match(
      /(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*[-–]\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i
    );

    const modeStr = [
      raw.title,
      raw.campus,
      raw.location,
    ].join(" ");

    sections.push({
      college_code: slug,
      term: standardTerm,
      course_prefix: raw.prefix,
      course_number: raw.number,
      course_title: raw.title,
      credits: parseFloat(raw.credits) || 3,
      crn: raw.crn,
      days: parseDays(raw.days),
      start_time: timeParts ? timeParts[1].trim() : "",
      end_time: timeParts ? timeParts[2].trim() : "",
      start_date: "",
      location: raw.location,
      campus: raw.campus || "Main",
      mode: detectMode(modeStr),
      instructor: raw.instructor || null,
      seats_open: null,
      seats_total: null,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const collegeFlag = args.indexOf("--college");
  const allFlag = args.includes("--all");
  const termIdx = args.indexOf("--term");
  const targetTerm = termIdx >= 0 ? args[termIdx + 1] : "Fall 2026";

  let targets: [string, { baseUrl: string; searchPath: string }][];

  if (allFlag) {
    targets = Object.entries(JENZABAR_COLLEGES);
  } else if (collegeFlag >= 0) {
    const slug = args[collegeFlag + 1];
    const config = JENZABAR_COLLEGES[slug];
    if (!config) {
      console.error(`Unknown college: ${slug}`);
      console.error(
        `Available: ${Object.keys(JENZABAR_COLLEGES).join(", ")}`
      );
      process.exit(1);
    }
    targets = [[slug, config]];
  } else {
    // Default: scrape all Jenzabar colleges
    targets = Object.entries(JENZABAR_COLLEGES);
  }

  console.log("Launching browser...");
  const browser: Browser = await chromium.launch({ headless: true });

  let grandTotal = 0;

  for (const [slug, config] of targets) {
    console.log(`\n=== Scraping ${slug} (Jenzabar JICS) ===`);

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    });
    const page = await context.newPage();

    try {
      const sections = await scrapeJenzabar(
        page,
        slug,
        config,
        targetTerm
      );

      if (sections.length > 0) {
        const standardTerm = sections[0].term;
        const outDir = path.join(
          process.cwd(),
          "data",
          "md",
          "courses",
          slug
        );
        fs.mkdirSync(outDir, { recursive: true });
        const outFile = path.join(outDir, `${standardTerm}.json`);
        fs.writeFileSync(outFile, JSON.stringify(sections, null, 2));
        console.log(
          `  → ${sections.length} sections written to ${standardTerm}.json`
        );
        grandTotal += sections.length;
      } else {
        console.log("  No sections found.");
      }
    } catch (e) {
      console.error(`  Error scraping ${slug}: ${e}`);
    } finally {
      await context.close();
    }
  }

  await browser.close();

  // Auto-import into Supabase
  if (!args.includes("--no-import") && grandTotal > 0) {
    const { importCoursesToSupabase } = await import(
      "../lib/supabase-import"
    );
    await importCoursesToSupabase("md");
  }

  console.log(`\nDone. ${grandTotal} total sections scraped.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

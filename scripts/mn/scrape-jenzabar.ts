/**
 * scrape-jenzabar.ts
 *
 * Scrapes course section data from Minnesota tribal colleges that use
 * Jenzabar JICS (Internet Campus Solution) portlets. Uses Playwright
 * because Jenzabar JICS is a heavily JavaScript-driven portal.
 *
 * Adapted from scripts/md/scrape-jenzabar.ts (the garrett portlet flow);
 * the cecil REST-API short-circuit was dropped — not needed here.
 *
 * Covers: Leech Lake Tribal College (public Course_Search portlet at
 *   my.lltc.edu/ICS/Portal_Homepage.jnz?portlet=Course_Search — no login wall).
 *
 * Usage:
 *   npx tsx scripts/mn/scrape-jenzabar.ts --college leech-lake-tribal-college
 *   npx tsx scripts/mn/scrape-jenzabar.ts --all
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

// Jenzabar JICS colleges — public course-search portlet URLs.
const JENZABAR_COLLEGES: Record<string, { baseUrl: string; searchPath: string }> = {
  "leech-lake-tribal-college": {
    baseUrl: "https://my.lltc.edu",
    // Public Course_Search portlet (no login wall). Term selector is
    // #pg0_V_ddlTerm with UUID values whose visible text is e.g.
    // "2026-2027 Academic Year Fall Semester" — the term matcher keys off the
    // option TEXT, so the UUID values are fine.
    searchPath: "/ICS/Portal_Homepage.jnz?portlet=Course_Search",
  },
};

// Standard term mapping. Handles the JICS label formats observed across
// colleges:
//   "2026FA"                                  (already standard)
//   "Fall 2026" / "Spring Credit 2026"        (garrett/cecil: season then year)
//   "2026-2027 Academic Year Fall Semester"   (leech-lake: academic-year RANGE —
//                                              Fall is the first year, Spring/
//                                              Summer/Winter the second)
function toStandardTerm(termDesc: string): string {
  const t = termDesc.toLowerCase();
  // Already-standard compact form.
  const compact = t.match(/^(\d{4})(fa|sp|su|wi)$/);
  if (compact) return `${compact[1]}${compact[2].toUpperCase()}`;

  const seasonMatch = t.match(/(spring|summer|fall|winter)/);
  if (!seasonMatch) return "XXXX";
  const season = seasonMatch[1];
  const code =
    season === "fall" ? "FA" : season === "summer" ? "SU" : "SP"; // spring/winter → SP

  // Academic-year range "2026-2027 ...": Fall belongs to the first year,
  // Spring/Summer/Winter to the second.
  const range = t.match(/(\d{4})\s*-\s*(\d{4})/);
  if (range) {
    const year = season === "fall" ? range[1] : range[2];
    return `${year}${code}`;
  }

  // Single year, season either side.
  const single = t.match(/(\d{4})/);
  return single ? `${single[1]}${code}` : "XXXX";
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

    // Match by COMPUTED standard term, not substring. JICS instances label
    // and value their term <option>s inconsistently (garrett "Fall 2026"
    // value="2027;FA"; leech-lake "2026-2027 Academic Year Fall Semester"
    // value=<uuid>). toStandardTerm normalizes every label to e.g. "2026FA",
    // so an exact standard-term match is robust across all of them.
    const targetStd = toStandardTerm(targetTerm);

    // Subterm rows (e.g. "Fall 2026 - Subterm A") split a term in half;
    // skip them in favor of the full-term parent so we don't get half the
    // sections.
    const isSubterm = (t: string) => /subterm|sub-term/i.test(t);

    let bestOption = options.find(
      (o) => !isSubterm(o.text) && toStandardTerm(o.text) === targetStd,
    );
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

    // Strategy LLTC: Leech Lake's results grid (#pg0_V_ItemsGrid, class
    // "groupedGrid csGenericTable") has NO "Course code"/"Name" header row —
    // it's a 4-column grid where each data row is
    //   ["ANI 100 (1)", "Anishinaabe Studies", "Ms. Audrey Thayer<cruft>",
    //    "Tue, Thu 09:00 AM - 10:15 AM"]
    // with the section number in parens after the course code, and empty
    // spacer rows between entries. Run it first; if it finds nothing the
    // garrett/fallback strategies below take over.
    {
      const grid = document.querySelector("#pg0_V_ItemsGrid");
      if (grid) {
        const trs = Array.from(grid.querySelectorAll("tr"));
        for (const tr of trs) {
          const cells = Array.from(tr.querySelectorAll("td"));
          if (cells.length < 4) continue;
          const codeText = (cells[0]?.textContent || "").replace(/\s+/g, " ").trim();
          // "ANI 100 (1)" → prefix=ANI number=100 section=1
          const m = codeText.match(/^([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)\s*\(([\w-]+)\)/);
          if (!m) continue;
          const title = (cells[1]?.textContent || "").replace(/\s+/g, " ").trim();
          if (!title) continue;
          // Faculty cell carries a "Show MyInfo popup for <name>" affordance —
          // strip it back to the bare name.
          const faculty = (cells[2]?.textContent || "")
            .replace(/\s+/g, " ")
            .replace(/Show MyInfo popup for.*$/i, "")
            .trim();
          // Schedule: "Tue, Thu 09:00 AM - 10:15 AM" | "Unknown" | online note.
          const sched = (cells[3]?.textContent || "").replace(/\s+/g, " ").trim();
          const dayMatch = sched.match(
            /^((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:,\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun))*)/i,
          );
          const timeMatch = sched.match(
            /(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*-\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i,
          );
          rows.push({
            title,
            prefix: m[1],
            number: m[2],
            crn: m[3], // section number — matches the aacc/garrett convention
            credits: "3",
            days: dayMatch ? dayMatch[1] : "",
            times: timeMatch ? `${timeMatch[1]} - ${timeMatch[2]}` : "",
            location: "",
            campus: "",
            instructor: faculty,
            seats: "",
          });
        }
      }
    }

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
          "mn",
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
    await importCoursesToSupabase("mn");
  }

  console.log(`\nDone. ${grandTotal} total sections scraped.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

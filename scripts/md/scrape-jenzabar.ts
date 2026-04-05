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
    searchPath: "/ICS/Course_Search.jnz",
  },
  garrett: {
    baseUrl: "https://my.garrettcollege.edu",
    searchPath:
      "/ICS/Portal_Homepage.jnz?portlet=AddDrop_Courses&screen=Advanced+Course+Search&screenType=next",
  },
};

// Standard term mapping
function toStandardTerm(termDesc: string): string {
  const match = termDesc.match(/(spring|summer|fall|winter)\s*(\d{4})/i);
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
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });

  // Wait for the page to load
  await page.waitForTimeout(2000);

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

    // Find a matching term (prefer Fall 2026, then Spring 2026, etc.)
    const targetLower = targetTerm.toLowerCase();
    let bestOption = options.find(
      (o) => o.text.toLowerCase().includes(targetLower)
    );
    if (!bestOption) {
      // Try finding the most recent future term
      bestOption = options.find(
        (o) =>
          o.text.includes("2026") || o.text.includes("2027")
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

  // Click search button
  const searchBtnSelectors = [
    'input[type="submit"][value*="Search" i]',
    'button[type="submit"]',
    'input[type="button"][value*="Search" i]',
    "#pg0_V_btnSearch",
    'a[id*="btnSearch"]',
    'input[value="Search"]',
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

    // Strategy 1: Look for table rows with course data
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
  let allCourseData = [...courseData];

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
      // Same extraction logic as above (simplified reference)
      const tables = document.querySelectorAll("table");
      for (const table of tables) {
        const trs = table.querySelectorAll("tr");
        for (const tr of trs) {
          const cells = tr.querySelectorAll("td");
          if (cells.length >= 5) {
            const cellTexts = Array.from(cells).map(
              (c) => c.textContent?.trim() || ""
            );
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
                    cellTexts.find((t) => /\d{1,2}:\d{2}/.test(t)) || "",
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

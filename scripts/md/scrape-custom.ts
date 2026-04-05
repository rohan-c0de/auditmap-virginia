/**
 * scrape-custom.ts
 *
 * Scrapes course section data from Maryland community colleges that use
 * custom/proprietary registration systems. Each college has a unique
 * scraping approach.
 *
 * Covers:
 *   - AACC (Anne Arundel CC): custom WordPress-based course search
 *   - BCCC (Baltimore City CC): Regent/CAMS system
 *   - Frederick CC: static HTML schedule pages
 *
 * Usage:
 *   npx tsx scripts/md/scrape-custom.ts --college aacc
 *   npx tsx scripts/md/scrape-custom.ts --college frederick
 *   npx tsx scripts/md/scrape-custom.ts --all
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

function detectMode(text: string): CourseMode {
  const lower = text.toLowerCase();
  if (lower.includes("hybrid")) return "hybrid";
  if (lower.includes("online") || lower.includes("virtual") || lower.includes("distance"))
    return "online";
  if (lower.includes("zoom") || lower.includes("remote synchronous"))
    return "zoom";
  return "in-person";
}

function parseDayString(dayStr: string): string {
  const days: string[] = [];
  const clean = dayStr.toUpperCase().replace(/[/,\s]+/g, "");
  // Character-by-character parse for Banner-style day codes
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    const next = clean[i + 1];
    switch (ch) {
      case "M":
        days.push("M");
        break;
      case "T":
        if (next === "H" || next === "R") {
          days.push("Th");
          i++;
        } else if (next === "U") {
          days.push("Tu");
          i++;
        } else {
          days.push("Tu");
        }
        break;
      case "W":
        days.push("W");
        break;
      case "R":
        days.push("Th");
        break;
      case "F":
        days.push("F");
        break;
      case "S":
        if (next === "A") {
          days.push("Sa");
          i++;
        } else if (next === "U") {
          days.push("Su");
          i++;
        } else {
          days.push("Sa");
        }
        break;
    }
  }
  return days.join("");
}

function toStandardTerm(termDesc: string): string {
  const match = termDesc.match(/(spring|summer|fall|winter)\s*(\d{4})/i);
  if (!match) return "2026FA";
  const season = match[1].toLowerCase();
  const year = match[2];
  if (season === "fall") return `${year}FA`;
  if (season === "spring") return `${year}SP`;
  if (season === "summer") return `${year}SU`;
  return `${year}SP`;
}

// ---------------------------------------------------------------------------
// AACC — Anne Arundel Community College
// Uses a custom course search at https://www.aacc.edu/course-search/
// The search is JavaScript-driven, likely using an API endpoint
// ---------------------------------------------------------------------------

async function scrapeAACC(page: Page, targetTerm: string): Promise<CourseSection[]> {
  const sections: CourseSection[] = [];
  const standardTerm = toStandardTerm(targetTerm);
  const slug = "aacc";

  console.log("  Navigating to AACC course search...");
  await page.goto("https://www.aacc.edu/course-search/", {
    waitUntil: "networkidle",
    timeout: 30000,
  });
  await page.waitForTimeout(3000);

  // Try to find and interact with the search form
  // AACC may use a search API or a form-based search
  const termSelect = await page.$(
    'select[name*="term" i], select[id*="term" i], #termSelector, .term-select select'
  );

  if (termSelect) {
    const options = await termSelect.evaluate((el: HTMLSelectElement) =>
      Array.from(el.options).map((o) => ({ value: o.value, text: o.text.trim() }))
    );
    console.log(`  Available terms: ${options.map((o) => o.text).join(", ")}`);

    const target = options.find(
      (o) => o.text.toLowerCase().includes(targetTerm.toLowerCase())
    ) || options.find((o) => o.text.includes("2026") || o.text.includes("2027"));

    if (target) {
      await termSelect.selectOption(target.value);
      console.log(`  Selected term: ${target.text}`);
      await page.waitForTimeout(2000);
    }
  }

  // Click search / submit
  const searchBtn = await page.$(
    'button:has-text("Search"), input[type="submit"][value*="Search" i], .search-btn, #searchBtn'
  );
  if (searchBtn) {
    await searchBtn.click();
    await page.waitForTimeout(5000);
  }

  // Also try intercepting API responses
  const apiData: any[] = [];
  page.on("response", async (response) => {
    const url = response.url();
    if (
      url.includes("course") &&
      (url.includes("api") || url.includes("search")) &&
      response.status() === 200
    ) {
      try {
        const json = await response.json();
        if (Array.isArray(json)) apiData.push(...json);
        else if (json.results) apiData.push(...json.results);
        else if (json.data) apiData.push(...json.data);
      } catch {
        // Not JSON, ignore
      }
    }
  });

  // Try to trigger a search that loads all courses
  const allSubjectsBtn = await page.$(
    'a:has-text("All"), option[value=""], select option:first-child'
  );
  if (allSubjectsBtn) {
    await allSubjectsBtn.click();
    await page.waitForTimeout(3000);
  }

  // Extract course data from rendered page
  const pageData = await page.evaluate(() => {
    const rows: {
      prefix: string;
      number: string;
      title: string;
      crn: string;
      credits: string;
      days: string;
      startTime: string;
      endTime: string;
      location: string;
      campus: string;
      instructor: string;
      mode: string;
    }[] = [];

    // Look for course listing elements
    const courseElements = document.querySelectorAll(
      '.course-item, .course-listing, .search-result, tr[class*="course"], .section-row'
    );

    for (const el of courseElements) {
      const text = el.textContent || "";
      const courseMatch = text.match(/([A-Z]{2,5})\s*[-]?\s*(\d{3,4}[A-Z]?)/);
      if (!courseMatch) continue;

      const crnMatch = text.match(/(?:CRN|Section)[:\s#]*(\d{4,5})/i);
      const credMatch = text.match(/(\d+\.?\d*)\s*(?:credit|cr)/i);
      const timeMatch = text.match(
        /(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*[-–]\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i
      );
      const instrMatch = text.match(
        /(?:Instructor|Faculty|Staff)[:\s]*([A-Za-z,.\s]+?)(?:\n|$|<)/i
      );
      const daysMatch = text.match(/(?:Days?)[:\s]*([MTWRFSU\s/]+?)(?:\n|$|\s{2})/i);

      rows.push({
        prefix: courseMatch[1],
        number: courseMatch[2],
        title: "", // Will be populated from other elements if possible
        crn: crnMatch ? crnMatch[1] : "",
        credits: credMatch ? credMatch[1] : "3",
        days: daysMatch ? daysMatch[1].trim() : "",
        startTime: timeMatch ? timeMatch[1] : "",
        endTime: timeMatch ? timeMatch[2] : "",
        location: "",
        campus: "",
        instructor: instrMatch ? instrMatch[1].trim() : "",
        mode: text.toLowerCase().includes("online")
          ? "online"
          : text.toLowerCase().includes("hybrid")
          ? "hybrid"
          : "in-person",
      });
    }

    // Fallback: try table rows
    if (rows.length === 0) {
      const tables = document.querySelectorAll("table");
      for (const table of tables) {
        const trs = table.querySelectorAll("tbody tr");
        for (const tr of trs) {
          const cells = Array.from(tr.querySelectorAll("td")).map(
            (c) => c.textContent?.trim() || ""
          );
          if (cells.length < 3) continue;
          const fullText = cells.join(" ");
          const courseMatch = fullText.match(
            /([A-Z]{2,5})\s*[-]?\s*(\d{3,4}[A-Z]?)/
          );
          if (courseMatch) {
            rows.push({
              prefix: courseMatch[1],
              number: courseMatch[2],
              title: cells[1] || cells[0] || "",
              crn: cells.find((c) => /^\d{4,5}$/.test(c)) || "",
              credits: cells.find((c) => /^\d+\.?\d*$/.test(c)) || "3",
              days: cells.find((c) => /^[MTWRFSU]{1,6}$/i.test(c.replace(/\s/g, ""))) || "",
              startTime: "",
              endTime: "",
              location: "",
              campus: "",
              instructor: cells.find((c) => /^[A-Z][a-z]+,?\s+[A-Z]/.test(c)) || "",
              mode: fullText.toLowerCase().includes("online") ? "online" : "in-person",
            });
          }
        }
      }
    }

    return rows;
  });

  console.log(`  Extracted ${pageData.length} course entries from page`);

  for (const raw of pageData) {
    sections.push({
      college_code: slug,
      term: standardTerm,
      course_prefix: raw.prefix,
      course_number: raw.number,
      course_title: raw.title,
      credits: parseFloat(raw.credits) || 3,
      crn: raw.crn,
      days: parseDayString(raw.days),
      start_time: raw.startTime,
      end_time: raw.endTime,
      start_date: "",
      location: raw.location,
      campus: raw.campus || "Arnold",
      mode: raw.mode as CourseMode,
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
// BCCC — Baltimore City Community College
// Uses Regent/CAMS system at portal.bccc.edu
// ---------------------------------------------------------------------------

async function scrapeBCCC(page: Page, targetTerm: string): Promise<CourseSection[]> {
  const sections: CourseSection[] = [];
  const standardTerm = toStandardTerm(targetTerm);
  const slug = "bccc";

  console.log("  Navigating to BCCC course search...");
  await page.goto(
    "https://portal.bccc.edu/RegentScripts/ctlwb01Project.exe?CMD=colwb57RequestChangeSelection",
    { waitUntil: "networkidle", timeout: 30000 }
  );
  await page.waitForTimeout(3000);

  // Regent/CAMS typically has term and subject dropdowns
  const termSelect = await page.$(
    'select[name*="term" i], select[name*="Term" i], select[name*="semester" i], #ddlTerms'
  );

  if (termSelect) {
    const options = await termSelect.evaluate((el: HTMLSelectElement) =>
      Array.from(el.options).map((o) => ({ value: o.value, text: o.text.trim() }))
    );
    console.log(`  Available terms: ${options.map((o) => o.text).join(", ")}`);

    const target = options.find(
      (o) => o.text.toLowerCase().includes(targetTerm.toLowerCase())
    ) || options.find((o) => o.text.includes("2026") || o.text.includes("2027"));

    if (target) {
      await termSelect.selectOption(target.value);
      console.log(`  Selected term: ${target.text}`);
      await page.waitForTimeout(2000);
    }
  }

  // Submit to get all courses (leave subject as "All")
  const submitBtn = await page.$(
    'input[type="submit"], button[type="submit"], input[value*="Submit" i], input[value*="Search" i], input[value*="Display" i]'
  );
  if (submitBtn) {
    await submitBtn.click();
    await page.waitForTimeout(5000);
  }

  // Regent/CAMS returns HTML tables with course data
  const pageData = await page.evaluate(() => {
    const rows: {
      prefix: string;
      number: string;
      title: string;
      crn: string;
      section: string;
      credits: string;
      days: string;
      startTime: string;
      endTime: string;
      location: string;
      campus: string;
      instructor: string;
      seatsOpen: string;
      seatsTotal: string;
    }[] = [];

    // Regent/CAMS tables often have specific class names or structures
    const tables = document.querySelectorAll("table");
    for (const table of tables) {
      const trs = table.querySelectorAll("tr");
      for (const tr of trs) {
        const cells = Array.from(tr.querySelectorAll("td")).map(
          (c) => c.textContent?.trim() || ""
        );
        if (cells.length < 4) continue;

        const fullText = cells.join(" ");
        const courseMatch = fullText.match(
          /([A-Z]{2,5})\s*[-]?\s*(\d{3,4}[A-Z]?)/
        );
        if (!courseMatch) continue;

        const timeMatch = fullText.match(
          /(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*[-–]\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i
        );
        const seatMatch = fullText.match(/(\d+)\s*(?:of|\/)\s*(\d+)/);

        rows.push({
          prefix: courseMatch[1],
          number: courseMatch[2],
          title: cells.length > 2 ? cells[2] || cells[1] : "",
          crn: cells.find((c) => /^\d{4,5}$/.test(c)) || "",
          section: cells.find((c) => /^\d{2,3}$/.test(c)) || "",
          credits: cells.find((c) => /^\d+\.?\d*$/.test(c) && parseFloat(c) <= 12) || "3",
          days: cells.find((c) => /^[MTWRFSU]{1,7}$/i.test(c.replace(/\s/g, ""))) || "",
          startTime: timeMatch ? timeMatch[1] : "",
          endTime: timeMatch ? timeMatch[2] : "",
          location: "",
          campus: "Liberty",
          instructor: cells.find((c) => /^[A-Z][a-z]+,?\s+[A-Z]/.test(c)) || "",
          seatsOpen: seatMatch ? seatMatch[1] : "",
          seatsTotal: seatMatch ? seatMatch[2] : "",
        });
      }
    }

    return rows;
  });

  console.log(`  Extracted ${pageData.length} course entries from page`);

  for (const raw of pageData) {
    const modeStr = [raw.title, raw.campus, raw.location].join(" ");
    sections.push({
      college_code: slug,
      term: standardTerm,
      course_prefix: raw.prefix,
      course_number: raw.number,
      course_title: raw.title,
      credits: parseFloat(raw.credits) || 3,
      crn: raw.crn || raw.section,
      days: parseDayString(raw.days),
      start_time: raw.startTime,
      end_time: raw.endTime,
      start_date: "",
      location: raw.location,
      campus: raw.campus || "Liberty",
      mode: detectMode(modeStr),
      instructor: raw.instructor || null,
      seats_open: raw.seatsOpen ? parseInt(raw.seatsOpen) : null,
      seats_total: raw.seatsTotal ? parseInt(raw.seatsTotal) : null,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Frederick CC — Static HTML schedule
// Uses https://html-schedule.frederick.edu/ which serves static HTML pages
// ---------------------------------------------------------------------------

async function scrapeFrederick(
  page: Page,
  targetTerm: string
): Promise<CourseSection[]> {
  const sections: CourseSection[] = [];
  const standardTerm = toStandardTerm(targetTerm);
  const slug = "frederick";

  console.log("  Navigating to Frederick CC schedule...");
  await page.goto("https://html-schedule.frederick.edu/", {
    waitUntil: "networkidle",
    timeout: 30000,
  });
  await page.waitForTimeout(2000);

  // Frederick CC has a simple HTML schedule — may have term/subject links
  // Look for term navigation
  const termLinks = await page.$$eval(
    'a[href*="schedule"], a[href*="term"], a[href*="semester"]',
    (links) =>
      links.map((a) => ({
        text: a.textContent?.trim() || "",
        href: a.getAttribute("href") || "",
      }))
  );

  console.log(
    `  Found ${termLinks.length} navigation links`
  );

  // Find relevant term link
  const targetLink = termLinks.find(
    (l) =>
      l.text.toLowerCase().includes(targetTerm.toLowerCase()) ||
      l.text.includes("2026") ||
      l.text.includes("2027")
  );

  if (targetLink && targetLink.href) {
    const fullUrl = new URL(targetLink.href, "https://html-schedule.frederick.edu/").href;
    console.log(`  Following term link: ${targetLink.text} → ${fullUrl}`);
    await page.goto(fullUrl, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);
  }

  // Get all subject/department links
  const subjectLinks = await page.$$eval(
    'a[href]',
    (links) =>
      links
        .map((a) => ({
          text: a.textContent?.trim() || "",
          href: a.getAttribute("href") || "",
        }))
        .filter(
          (l) =>
            l.href.includes(".htm") || l.href.includes(".html")
        )
  );

  console.log(`  Found ${subjectLinks.length} potential subject pages`);

  // Visit each subject page and extract courses
  const baseUrl = page.url();
  for (const link of subjectLinks) {
    if (!link.href || link.href.startsWith("#")) continue;

    const fullUrl = new URL(link.href, baseUrl).href;
    try {
      await page.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
      await page.waitForTimeout(500);

      const pageContent = await page.evaluate(() => {
        const rows: {
          prefix: string;
          number: string;
          title: string;
          section: string;
          crn: string;
          credits: string;
          days: string;
          startTime: string;
          endTime: string;
          location: string;
          instructor: string;
          campus: string;
        }[] = [];

        // Frederick CC HTML schedule typically uses tables or pre-formatted text
        const tables = document.querySelectorAll("table");
        for (const table of tables) {
          const trs = table.querySelectorAll("tr");
          for (const tr of trs) {
            const cells = Array.from(tr.querySelectorAll("td, th")).map(
              (c) => c.textContent?.trim() || ""
            );
            if (cells.length < 3) continue;
            const fullText = cells.join(" ");
            const courseMatch = fullText.match(
              /([A-Z]{2,5})\s*[-]?\s*(\d{3,4}[A-Z]?)/
            );
            if (!courseMatch) continue;

            const timeMatch = fullText.match(
              /(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*[-–]\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i
            );

            rows.push({
              prefix: courseMatch[1],
              number: courseMatch[2],
              title: cells.length > 2 ? cells[2] || cells[1] : "",
              section: "",
              crn: cells.find((c) => /^\d{4,5}$/.test(c)) || "",
              credits:
                cells.find(
                  (c) =>
                    /^\d+\.?\d*$/.test(c) && parseFloat(c) <= 12
                ) || "3",
              days:
                cells.find((c) =>
                  /^[MTWRFSU]{1,7}$/i.test(c.replace(/\s/g, ""))
                ) || "",
              startTime: timeMatch ? timeMatch[1] : "",
              endTime: timeMatch ? timeMatch[2] : "",
              location: "",
              instructor:
                cells.find((c) =>
                  /^[A-Z][a-z]+,?\s+[A-Z]/.test(c)
                ) || "",
              campus: "Frederick",
            });
          }
        }

        // Also try pre-formatted text blocks
        if (rows.length === 0) {
          const preBlocks = document.querySelectorAll("pre, .schedule-data");
          for (const pre of preBlocks) {
            const lines = (pre.textContent || "").split("\n");
            for (const line of lines) {
              const courseMatch = line.match(
                /([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)\s+(.+)/
              );
              if (courseMatch) {
                const timeMatch = line.match(
                  /(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*[-–]\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i
                );
                const daysMatch = line.match(
                  /\b([MTWRFSU]{1,7})\b/
                );
                rows.push({
                  prefix: courseMatch[1],
                  number: courseMatch[2],
                  title: courseMatch[3].split(/\s{2,}/)[0].trim(),
                  section: "",
                  crn: "",
                  credits: "3",
                  days: daysMatch ? daysMatch[1] : "",
                  startTime: timeMatch ? timeMatch[1] : "",
                  endTime: timeMatch ? timeMatch[2] : "",
                  location: "",
                  instructor: "",
                  campus: "Frederick",
                });
              }
            }
          }
        }

        return rows;
      });

      for (const raw of pageContent) {
        const modeStr = [raw.title, raw.campus, raw.location].join(
          " "
        );
        sections.push({
          college_code: slug,
          term: standardTerm,
          course_prefix: raw.prefix,
          course_number: raw.number,
          course_title: raw.title,
          credits: parseFloat(raw.credits) || 3,
          crn: raw.crn,
          days: parseDayString(raw.days),
          start_time: raw.startTime,
          end_time: raw.endTime,
          start_date: "",
          location: raw.location,
          campus: raw.campus || "Frederick",
          mode: detectMode(modeStr),
          instructor: raw.instructor || null,
          seats_open: null,
          seats_total: null,
          prerequisite_text: null,
          prerequisite_courses: [],
        });
      }
    } catch {
      // Skip pages that fail to load
    }
  }

  // Deduplicate by CRN or prefix+number+section
  const seen = new Set<string>();
  const deduped: CourseSection[] = [];
  for (const s of sections) {
    const key = s.crn || `${s.course_prefix}${s.course_number}${s.days}${s.start_time}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(s);
    }
  }

  return deduped;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const CUSTOM_COLLEGES: Record<
  string,
  (page: Page, term: string) => Promise<CourseSection[]>
> = {
  aacc: scrapeAACC,
  bccc: scrapeBCCC,
  frederick: scrapeFrederick,
};

async function main() {
  const args = process.argv.slice(2);
  const collegeFlag = args.indexOf("--college");
  const allFlag = args.includes("--all");
  const termIdx = args.indexOf("--term");
  const targetTerm = termIdx >= 0 ? args[termIdx + 1] : "Fall 2026";

  let targets: string[];

  if (allFlag) {
    targets = Object.keys(CUSTOM_COLLEGES);
  } else if (collegeFlag >= 0) {
    const slug = args[collegeFlag + 1];
    if (!CUSTOM_COLLEGES[slug]) {
      console.error(`Unknown college: ${slug}`);
      console.error(
        `Available: ${Object.keys(CUSTOM_COLLEGES).join(", ")}`
      );
      process.exit(1);
    }
    targets = [slug];
  } else {
    // Default: scrape all custom colleges
    targets = Object.keys(CUSTOM_COLLEGES);
  }

  console.log("Launching browser...");
  const browser: Browser = await chromium.launch({ headless: true });

  let grandTotal = 0;

  for (const slug of targets) {
    console.log(`\n=== Scraping ${slug} (Custom) ===`);

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    });
    const page = await context.newPage();

    try {
      const scrapeFn = CUSTOM_COLLEGES[slug];
      const sections = await scrapeFn(page, targetTerm);

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
        console.log(
          "  Note: Custom scrapers may need tuning after first run to match the site's actual HTML structure."
        );
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

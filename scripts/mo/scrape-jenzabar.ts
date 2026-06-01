/**
 * Missouri — Jenzabar ICS "Course Schedules" portlet scraper
 *
 * These MO colleges use the Jenzabar ICS "Course Schedules" portlet
 * (pg0_V_* element IDs, ASP.NET WebForms postback) — NOT the
 * "Student Registration" portlet that the shared template targets.
 * So this is a standalone Playwright scraper.
 *
 * Public colleges (no login required):
 *   crowder-college               → my.crowder.edu
 *   mineral-area-college          → my.mineralarea.edu
 *
 * SSO-gated (skipped):
 *   moberly-area-community-college → my.macc.edu (login required)
 *   state-technical-college-of-missouri → mytech.statetechmo.edu (login required)
 *
 * The default search (no dept filter) returns a capped ~20 results,
 * so we iterate department-by-department to get everything.
 *
 * Usage:
 *   npx tsx scripts/mo/scrape-jenzabar.ts
 *   npx tsx scripts/mo/scrape-jenzabar.ts --college=crowder-college
 */
import * as fs from "fs";
import * as path from "path";
import { chromium, type Page, type BrowserContext } from "playwright";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CourseSection {
  college_code: string;
  term: string;
  course_prefix: string;
  course_number: string;
  course_title: string;
  credits: number;
  section_code: string;
  crn: string | null;
  days: string[];
  start_time: string | null;
  end_time: string | null;
  start_date: string | null;
  end_date: string | null;
  location: string | null;
  campus: string | null;
  mode: "in-person" | "online" | "hybrid" | "zoom";
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const HOSTS: Record<string, string> = {
  "crowder-college":
    "https://my.crowder.edu/ICS/Academics/Public.jnz?portlet=Course_Schedules&screen=Advanced+Course+Search&screenType=next",
  "mineral-area-college":
    "https://my.mineralarea.edu/ICS/Admissions/Public.jnz?portlet=Course_Schedules&screen=Advanced+Course+Search&screenType=next",
};

// Term value → canonical term code
// Crowder uses numeric months: "2026;08" → "2026FA"
// Mineral Area uses alpha codes: "2026;FA" → "2026FA"
// Sub-term values like "2026;FA;8B" are filtered out upstream.
function termValueToCode(val: string): string {
  const [year, second] = val.split(";");
  // Alpha code path (FA / SP / SU)
  const upper = second.toUpperCase();
  if (upper === "FA") return `${year}FA`;
  if (upper === "SP") return `${year}SP`;
  if (upper === "SU") return `${year}SU`;
  // Numeric month path (Crowder)
  const m = parseInt(second, 10);
  if (m >= 7) return `${year}FA`;
  if (m >= 5) return `${year}SU`;
  return `${year}SP`;
}

// Term value → human-friendly label for filtering
function termValueYear(val: string): number {
  return parseInt(val.split(";")[0], 10);
}

// ---------------------------------------------------------------------------
// Schedule parsing
// ---------------------------------------------------------------------------

const DAY_MAP: Record<string, string> = {
  M: "M", Mo: "M", Mon: "M",
  T: "T", Tu: "T", Tue: "T",
  W: "W", We: "W", Wed: "W",
  R: "R", Th: "R", Thu: "R",
  F: "F", Fr: "F", Fri: "F",
  S: "Sa", Sa: "Sa", Sat: "Sa",
  U: "Su", Su: "Su", Sun: "Su",
};

function parseDaysAndTime(schedule: string): {
  days: string[];
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  campus: string | null;
  mode: "in-person" | "online" | "hybrid" | "zoom";
} {
  const result = {
    days: [] as string[],
    start_time: null as string | null,
    end_time: null as string | null,
    location: null as string | null,
    campus: null as string | null,
    mode: "in-person" as "in-person" | "online" | "hybrid" | "zoom",
  };

  if (!schedule) return result;

  const lower = schedule.toLowerCase();
  if (lower.includes("online")) {
    result.mode = "online";
  }

  // Pattern: "MTWRF 9:30 AM-10:45 AM; Campus, Building, Room"
  // or "Online Course; ..."
  const parts = schedule.split(";").map((s) => s.trim());

  // First part: days + time OR "Online Course"
  const first = parts[0] || "";
  const timeMatch = first.match(
    /^([A-Za-z]+)\s+(\d{1,2}:\d{2}\s*[APap][Mm])\s*-\s*(\d{1,2}:\d{2}\s*[APap][Mm])/
  );
  if (timeMatch) {
    // Parse day letters: "TR" → ["T", "R"], "MWF" → ["M", "W", "F"]
    const dayStr = timeMatch[1];
    // Split on known two-letter abbreviations first, then single letters
    const dayLetters = dayStr.match(/Th|Tu|Sa|Su|Mo|We|Fr|[MTWRFSU]/gi) || [];
    result.days = dayLetters
      .map((d) => DAY_MAP[d] || d)
      .filter((d, i, arr) => arr.indexOf(d) === i);
    result.start_time = timeMatch[2].toUpperCase().replace(/\s/g, "");
    result.end_time = timeMatch[3].toUpperCase().replace(/\s/g, "");

    if (result.mode === "online" && result.days.length > 0) {
      result.mode = "hybrid";
    }
  }

  // Location/campus from remaining parts
  if (parts.length > 1) {
    const locParts = parts.slice(1).filter((p) => p && !p.toLowerCase().includes("online"));
    if (locParts.length > 0) {
      // Full location string: "Main Campus, Building, Room"
      const locStr = locParts.join(", ");
      result.location = locStr;
      // Campus is the first comma-separated segment of the first loc part
      const campusCandidate = locParts[0].split(",")[0]?.replace(/\s+campus$/i, "").trim();
      result.campus = campusCandidate || null;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Row parsing
// ---------------------------------------------------------------------------

function parseRow(
  cells: string[],
  collegeSlug: string,
  termCode: string
): CourseSection | null {
  // cells: [Add, Textbooks, CourseCode, Name, Faculty, SeatsOpen, Status, Schedule, Credits, BeginDate, EndDate]
  if (cells.length < 11) return null;

  const courseCodeRaw = cells[2]?.trim() || "";
  const name = cells[3]?.trim() || "";
  // Faculty cell can contain name + department/title on extra lines — keep only first line
  const faculty = (cells[4]?.trim() || "").split(/\n/)[0].replace(/\s+/g, " ").trim();
  const seatsRaw = cells[5]?.trim() || "";
  const scheduleRaw = cells[7]?.trim() || "";
  const creditsRaw = cells[8]?.trim() || "";
  const beginDate = cells[9]?.trim() || "";
  const endDate = cells[10]?.trim() || "";

  // Course code: "ACCT 201 01 NEO" → prefix=ACCT, number=201, section=01 NEO
  const codeParts = courseCodeRaw.split(/\s+/);
  if (codeParts.length < 3) return null;
  const prefix = codeParts[0];
  const number = codeParts[1];
  const sectionCode = codeParts.slice(2).join(" ");

  if (!/^[A-Z]{2,6}$/.test(prefix)) return null;
  if (!/^\d{1,4}[A-Z]?$/.test(number)) return null;

  // Title: "Principles of Accounting I (Prin Acctg I)" → keep full name without parens
  const title = name.replace(/\s*\([^)]*\)\s*$/, "").trim();

  // Seats: "1/27" → open=1, total=27
  const seatsParts = seatsRaw.split("/");
  const seatsOpen =
    seatsParts.length === 2 ? parseInt(seatsParts[0], 10) : null;
  const seatsTotal =
    seatsParts.length === 2 ? parseInt(seatsParts[1], 10) : null;

  const credits = parseFloat(creditsRaw) || 0;
  const sched = parseDaysAndTime(scheduleRaw);

  // Dates: "8/17/2026" → "2026-08-17"
  const startDate = parseDate(beginDate);
  const endDateParsed = parseDate(endDate);

  return {
    college_code: collegeSlug,
    term: termCode,
    course_prefix: prefix,
    course_number: number,
    course_title: title || courseCodeRaw,
    credits,
    section_code: sectionCode,
    crn: null,
    days: sched.days,
    start_time: sched.start_time,
    end_time: sched.end_time,
    start_date: startDate,
    end_date: endDateParsed,
    location: sched.location,
    campus: sched.campus,
    mode: sched.mode,
    instructor: faculty || null,
    seats_open: Number.isFinite(seatsOpen) ? seatsOpen : null,
    seats_total: Number.isFinite(seatsTotal) ? seatsTotal : null,
    prerequisite_text: null,
    prerequisite_courses: [],
  };
}

function parseDate(d: string): string | null {
  if (!d) return null;
  const m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Scrape one college
// ---------------------------------------------------------------------------

async function scrapeCollege(
  slug: string,
  url: string,
  ctx: BrowserContext
): Promise<{ slug: string; sections: CourseSection[]; errors: string[] }> {
  const sections: CourseSection[] = [];
  const errors: string[] = [];
  const page = await ctx.newPage();

  try {
    console.log(`\n--- ${slug} ---`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(3000);

    // Verify the form exists
    const hasForm = await page.$("#pg0_V_ddlTerm");
    if (!hasForm) {
      errors.push("Form not found — may require login");
      console.log("  ⚠ Form not found — skipping");
      return { slug, sections, errors };
    }

    // Get available terms — filter to current/future main terms only
    const terms = await page.$$eval("#pg0_V_ddlTerm option", (opts) =>
      opts
        .map((o) => ({
          value: (o as HTMLOptionElement).value,
          label: o.textContent?.trim() ?? "",
        }))
        .filter((o) => /^\d{4};(?:\d{2}|[A-Z]{2})$/.test(o.value))
    );

    const now = new Date();
    const currentYear = now.getFullYear();
    const relevantTerms = terms.filter((t) => {
      const y = termValueYear(t.value);
      return y >= currentYear && y <= currentYear + 1;
    });

    if (relevantTerms.length === 0) {
      errors.push("No relevant terms found");
      console.log("  ⚠ No relevant terms");
      return { slug, sections, errors };
    }
    console.log(
      `  ${relevantTerms.length} terms: ${relevantTerms.map((t) => t.label).join(", ")}`
    );

    // Get departments
    const depts = await page.$$eval("#pg0_V_ddlDept option", (opts) =>
      opts
        .map((o) => ({
          value: (o as HTMLOptionElement).value,
          label: o.textContent?.trim() ?? "",
        }))
        .filter((o) => o.value !== "")
    );
    console.log(`  ${depts.length} departments`);

    for (const term of relevantTerms) {
      const termCode = termValueToCode(term.value);
      const termSections: CourseSection[] = [];
      console.log(`  \n  📅 ${term.label} (${termCode})`);

      for (const dept of depts) {
        try {
          // Navigate fresh per-dept — ASP.NET WebForms postback state is
          // fragile after the first search replaces the page.
          await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 30_000,
          });
          await page.waitForTimeout(1000);

          await page.selectOption("#pg0_V_ddlTerm", term.value);
          await page.selectOption("#pg0_V_ddlDept", dept.value);

          // Click search — triggers full-page postback
          await page.click("#pg0_V_btnSearch");

          // Wait for the result table — 5s is enough; postback usually
          // completes in 2-3s and the table appears immediately.
          await page.waitForSelector("#pg0_V_dgCourses", { timeout: 5_000 }).catch(() => {});
          await page.waitForTimeout(300);

          // Check if results table exists
          const hasTable = await page.$("#pg0_V_dgCourses");
          if (!hasTable) continue;

          // Extract rows
          const rows = await page.evaluate(() => {
            const table = document.getElementById(
              "pg0_V_dgCourses"
            ) as HTMLTableElement;
            if (!table) return [];
            const result: string[][] = [];
            const trs = table.querySelectorAll("tr");
            trs.forEach((tr) => {
              if (tr.className.includes("subItem")) return;
              const tds = tr.querySelectorAll("td");
              if (tds.length >= 11) {
                result.push(
                  Array.from(tds).map((td) => td.textContent?.trim() || "")
                );
              }
            });
            return result;
          });

          let deptCount = 0;
          for (const row of rows) {
            const section = parseRow(row, slug, termCode);
            if (section) {
              termSections.push(section);
              deptCount++;
            }
          }
          if (deptCount > 0) {
            process.stdout.write(`    ${dept.value}: ${deptCount}  `);
          }
        } catch (err) {
          console.log(`\n    ⚠ ${dept.value} error: ${err instanceof Error ? err.message : err}`);
        }
      }

      if (termSections.length > 0) {
        console.log(`\n    → ${termSections.length} sections`);
        sections.push(...termSections);

        // Write to file
        const outDir = path.join("data", "mo", "courses", slug);
        fs.mkdirSync(outDir, { recursive: true });
        const outFile = path.join(outDir, `${termCode}.json`);
        fs.writeFileSync(outFile, JSON.stringify(termSections, null, 2));
        console.log(`    → wrote ${outFile}`);
      } else {
        console.log(`\n    → 0 sections`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(msg);
    console.error(`  ❌ ${msg}`);
  } finally {
    await page.close();
  }

  return { slug, sections, errors };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const collegeFilter = args
    .find((a) => a.startsWith("--college="))
    ?.split("=")[1];

  const hosts = collegeFilter
    ? Object.fromEntries(
        Object.entries(HOSTS).filter(([k]) => k === collegeFilter)
      )
    : HOSTS;

  if (Object.keys(hosts).length === 0) {
    console.error(`No matching college for --college=${collegeFilter}`);
    process.exit(1);
  }

  console.log("📚 MO Jenzabar ICS scraper (Course Schedules portlet)");
  console.log(`   Colleges: ${Object.keys(hosts).length}`);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  let grandTotal = 0;
  const results: { slug: string; count: number; errors: string[] }[] = [];

  for (const [slug, url] of Object.entries(hosts)) {
    const result = await scrapeCollege(slug, url, ctx);
    grandTotal += result.sections.length;
    results.push({
      slug,
      count: result.sections.length,
      errors: result.errors,
    });
  }

  await browser.close();

  console.log(
    `\n✅ Done — ${grandTotal} sections across ${results.length} colleges.`
  );
  for (const r of results) {
    const status = r.errors.length > 0 ? `⚠ ${r.errors.join("; ")}` : "✓";
    console.log(`   ${r.slug}: ${r.count} sections ${status}`);
  }
}

main().catch((err) => {
  console.error("❌ MO Jenzabar ICS scraper failed:", err);
  process.exit(1);
});

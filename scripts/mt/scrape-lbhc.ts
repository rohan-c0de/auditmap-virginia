/**
 * Little Big Horn College — Jenzabar ICS Course_Search scraper
 *
 * LBHC (Crow Agency, MT) runs Jenzabar ICS at cloudram.lbhc.edu/ICS.
 * The Course_Search portlet is publicly accessible without login.
 *
 * Discovered via the 2026-05-30 fingerprint re-baseline (#456 follow-up):
 * the original sweep missed the non-canonical host pattern
 * `cloudram.<domain>` (vs. the typical `my.<domain>` or `portal.<domain>`).
 *
 * The portal uses ASP.NET WebForms (VIEWSTATE-based). Crucially, there is no
 * EVENTVALIDATION field — a standard GET+POST with the VIEWSTATE from the
 * initial page load is sufficient to run the course search. No Playwright
 * or browser automation required (http runner).
 *
 * Term model: LBHC uses academic-year labeling ("2025-26 Academic Year Fall"
 * = Fall 2025 semester, standard code 2025FA). The dropdown term list is
 * read live on each scrape run to pick up new terms automatically.
 *
 * Data columns: course code+section (e.g. "AC 105 (1)"), course name,
 * faculty (needs "Show MyInfo popup…" suffix stripped), schedule
 * ("Tue, Thu 09:00 AM - 10:20 AM"), description.
 *
 * Usage:
 *   npx tsx scripts/mt/scrape-lbhc.ts
 *   npx tsx scripts/mt/scrape-lbhc.ts --no-import
 */

import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";

const BASE = "https://cloudram.lbhc.edu";
const SEARCH_URL = `${BASE}/ICS/Course_Search.jnz`;
const STATE = "mt";
const SLUG = "little-big-horn-college";
const OUT_DIR = path.join(process.cwd(), "data", STATE, "courses", SLUG);
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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
  mode: string;
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Map academic-year term label → standard code (2025FA, 2026SP, etc.). */
function labelToStandard(label: string): string | null {
  const yearMatch = label.match(/(\d{4})-\d{2}/);
  const year = yearMatch ? parseInt(yearMatch[1]) : null;
  if (!year) return null;
  const l = label.toLowerCase();
  if (l.includes("fall")) return `${year}FA`;
  if (l.includes("spring")) return `${year + 1}SP`;
  if (l.includes("summer")) return `${year + 1}SU`;
  return null;
}

/** Convert day names to standard abbreviated form. */
function parseDays(raw: string): string {
  if (!raw || raw === "Unknown") return "";
  return raw
    .split(",")
    .map((d) => {
      const t = d.trim().toLowerCase();
      if (t.startsWith("mon")) return "M";
      if (t.startsWith("tue")) return "T";
      if (t.startsWith("wed")) return "W";
      if (t.startsWith("thu")) return "Th";
      if (t.startsWith("fri")) return "F";
      if (t.startsWith("sat")) return "Sa";
      if (t.startsWith("sun")) return "Su";
      return t;
    })
    .join("");
}

/** "Tue, Thu 09:00 AM - 10:20 AM" → {days, start, end} */
function parseSchedule(raw: string): { days: string; start: string; end: string } {
  if (!raw || raw === "Unknown") return { days: "", start: "", end: "" };
  // Split on the time range separator
  const timeMatch = raw.match(
    /^([A-Za-z,\s]+?)\s+(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/i
  );
  if (!timeMatch) return { days: parseDays(raw), start: "", end: "" };
  return {
    days: parseDays(timeMatch[1]),
    start: timeMatch[2].trim(),
    end: timeMatch[3].trim(),
  };
}

/** "AC 105 (1)" → {prefix: "AC", number: "105", section: "01"} */
function parseCourseCode(raw: string): { prefix: string; number: string; section: string } | null {
  const m = raw.match(/^([A-Z]+)\s+(\d+\w*)\s*\((\d+)\)$/i);
  if (!m) return null;
  return {
    prefix: m[1].toUpperCase(),
    number: m[2].toUpperCase(),
    section: m[3].padStart(2, "0"),
  };
}

/** Strip "Show MyInfo popup for ..." suffix from faculty name. */
function cleanInstructor(raw: string): string | null {
  const cleaned = raw.replace(/Show MyInfo popup.*$/i, "").trim();
  return cleaned || null;
}

async function fetchPage(url: string): Promise<{ html: string; cookie: string }> {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" } });
  const cookie =
    r.headers
      .getSetCookie?.()
      ?.map((c) => c.split(";")[0])
      .join("; ") ?? (r.headers.get("set-cookie") ?? "").split(";")[0];
  return { html: await r.text(), cookie };
}

async function searchTerm(
  termId: string,
  cookie: string
): Promise<{ html: string }> {
  // Need a fresh VIEWSTATE for each search
  const { html: freshHtml, cookie: newCookie } = await fetchPage(SEARCH_URL);
  const vs = freshHtml.match(/name="__VIEWSTATE"[^>]+value="([^"]+)"/)?.[1] ?? "";
  const vsg = freshHtml.match(/name="__VIEWSTATEGENERATOR"[^>]+value="([^"]+)"/)?.[1] ?? "";
  const bref = freshHtml.match(/name="___BrowserRefresh"[^>]+value="([^"]+)"/)?.[1] ?? "";

  const body = new URLSearchParams({
    "_scriptManager_HiddenField": "",
    "__EVENTTARGET": "",
    "__EVENTARGUMENT": "",
    "__VIEWSTATE": vs,
    "__VIEWSTATEGENERATOR": vsg,
    "___BrowserRefresh": bref,
    "pg0$V$CourseTitleTextBox": "",
    "pg0$V$CourseCodeTextBox": "",
    "pg0$V$FacultyLastNameTextBox": "",
    "pg0$V$TermDropDownList": termId,
    "pg0$V$CourseDescriptionTextBox": "",
    "pg0$V$CourseSearchButton": "Search",
  });

  const r = await fetch(SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": UA,
      Cookie: newCookie || cookie,
    },
    body: body.toString(),
  });
  return { html: await r.text() };
}

async function main() {
  const args = process.argv.slice(2);
  const noImport = args.includes("--no-import");

  // Step 1: Load search page, get terms + session cookie
  console.log(`\nScraping ${SLUG} (${BASE})…`);
  const { html: indexHtml, cookie } = await fetchPage(SEARCH_URL);
  const $ = cheerio.load(indexHtml);

  // Extract available terms from dropdown
  const now = new Date();
  const terms: { id: string; label: string; standard: string }[] = [];
  $("select#pg0_V_TermDropDownList option, select[name='pg0$V$TermDropDownList'] option").each((_i, el) => {
    const id = $(el).attr("value") ?? "";
    const label = $(el).text().trim();
    if (!id || label.toLowerCase() === "all") return;
    const standard = labelToStandard(label);
    if (!standard) return;
    // Only include current or future terms (year >= current year - 1 to catch spring of current AY)
    const termYear = parseInt(standard.slice(0, 4));
    if (termYear < now.getFullYear() - 1) return;
    terms.push({ id, label, standard });
  });

  // Keep at most the 3 most recent terms (current AY fall/spring/summer)
  const recentTerms = terms.slice(0, 3);
  console.log(
    `  Terms: ${recentTerms.map((t) => `${t.label} → ${t.standard}`).join(", ")}`
  );

  fs.mkdirSync(OUT_DIR, { recursive: true });
  let grandTotal = 0;

  for (const term of recentTerms) {
    console.log(`\n  Scraping ${term.label}…`);
    const { html } = await searchTerm(term.id, cookie);
    const $r = cheerio.load(html);

    const sections: CourseSection[] = [];
    $r("tr").each((_i, row) => {
      const cells: string[] = [];
      $r(row)
        .find("td,th")
        .each((_j, c) => { cells.push($r(c).text().trim().replace(/\s+/g, " ")); });
      if (cells.length < 4) return;
      if (cells[0].toLowerCase().includes("course code")) return; // header

      const parsed = parseCourseCode(cells[0]);
      if (!parsed) return;

      const schedule = parseSchedule(cells[3] ?? "");
      const isOnline = schedule.days === "" && cells[3] !== "Unknown";
      const mode =
        schedule.days === "" ? "online" : "in-person";

      sections.push({
        college_code: SLUG,
        term: term.standard,
        course_prefix: parsed.prefix,
        course_number: parsed.number,
        course_title: (cells[1] ?? "").replace(/Show MyInfo.*$/i, "").trim(),
        credits: 0, // Jenzabar ICS Course_Search doesn't show credits in this view
        crn: `${parsed.prefix}${parsed.number}-${parsed.section}`,
        days: schedule.days,
        start_time: schedule.start,
        end_time: schedule.end,
        start_date: "",
        location: "",
        campus: "Main Campus",
        mode,
        instructor: cleanInstructor(cells[2] ?? ""),
        seats_open: null,
        seats_total: null,
        prerequisite_text: null,
        prerequisite_courses: [],
      });
    });

    if (sections.length === 0) {
      console.log(`    No sections found — skipping ${term.standard}`);
      continue;
    }

    const outFile = path.join(OUT_DIR, `${term.standard}.json`);
    fs.writeFileSync(outFile, JSON.stringify(sections, null, 2));
    console.log(`    → ${sections.length} sections written to ${term.standard}.json`);
    grandTotal += sections.length;
    await sleep(500);
  }

  console.log(`\n✓ ${SLUG}: ${grandTotal} total sections`);

  if (!noImport && grandTotal > 0) {
    const { importCoursesToSupabase } = await import("../lib/supabase-import");
    await importCoursesToSupabase(STATE);
  }
}

main().catch((e) => {
  console.error("❌ LBHC scraper failed:", e);
  process.exit(1);
});

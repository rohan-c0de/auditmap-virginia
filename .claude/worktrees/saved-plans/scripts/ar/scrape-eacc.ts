/**
 * East Arkansas Community College — Jenzabar JICS AddDrop_Courses scraper.
 *
 * Why bespoke (not the shared scrape-jenzabar lib): EACC publicly exposes
 * the AddDrop_Courses portlet (no auth) instead of Student_Registration.
 * Those two Jenzabar portlets have completely different DOM:
 *   AddDrop_Courses        Student_Registration (shared lib targets this)
 *   --------------         --------------------
 *   #pg0_V_ddlTerm         #stuRegTermSelect
 *   #pg0_V_btnSearch       click-search-courses (different button)
 *   #pg0_V_dgCourses       #CourseSearchResultsTable
 *   no pagination          MAX_PAGES paginated
 *
 * Source URL:
 *   https://my.eacc.edu/ICS/Course_Search.jnz?portlet=AddDrop_Courses&screen=Advanced+Course+Search&screenType=next
 *
 * Form behavior: term dropdown auto-postbacks on change. Click search to
 * render results into #pg0_V_dgCourses. No pagination — the entire term
 * is one page (EACC is small; Fall 2026 = ~20 sections).
 *
 * Term encoding: dropdown values are `YYYY;SS` where YYYY is the academic
 * year's ending year and SS is the season ("FA", "SP", "S1", "S2", "T1",
 * "AT", "TS", "TF", "AF", "IS"). E.g. `2027;FA` = 2026-2027 Fall = Fall 2026.
 *
 * Output schema matches the rest of the corpus: data/ar/courses/
 *   east-arkansas-community-college/{term}.json
 *
 * Usage:
 *   npx tsx scripts/ar/scrape-eacc.ts                 # all current+next terms
 *   npx tsx scripts/ar/scrape-eacc.ts --term 2027FA
 */
import * as fs from "fs";
import * as path from "path";
import { chromium, type Page } from "playwright";

const SLUG = "east-arkansas-community-college";
const STATE = "ar";
const SEARCH_URL =
  "https://my.eacc.edu/ICS/Course_Search.jnz?portlet=AddDrop_Courses&screen=Advanced+Course+Search&screenType=next";
const COURSES_DIR = path.join(process.cwd(), "data", STATE, "courses", SLUG);

type CourseMode = "in-person" | "online" | "hybrid" | "remote";

interface CourseSection {
  college_code: string;
  term: string;
  course_prefix: string;
  course_number: string;
  course_title: string;
  credits: number;
  crn: string;
  days: string | null;
  start_time: string | null;
  end_time: string | null;
  start_date: string | null;
  location: string | null;
  campus: string | null;
  mode: CourseMode | null;
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: null;
  prerequisite_courses: [];
}

interface RawRow {
  courseCode: string; // "ABR 1103 15" — prefix, number, section
  title: string;
  faculty: string;
  seats: string; // "10/10"
  status: string;
  schedule: string; // "MTWRF 12:45 PM-2:10 PM; Forrest City Campus"
  credits: string;
  beginDate: string; // "8/24/2026"
  endDate: string;
}

// "2027;FA" → "2026FA" (Fall 2026); "2027;SP" → "2027SP" (Spring 2027);
// "2027;S1" → "2026S1" (Summer 1 2026); "2027;S2" → "2026S2".
// EACC encodes YYYY = academic year's ending year. Fall = first half (subtract 1),
// Spring/Summer = second half (use as-is).
const SEASON_REMAP: Record<string, { season: string; yearDelta: number }> = {
  FA: { season: "FA", yearDelta: -1 },
  AF: { season: "FA", yearDelta: -1 }, // Accelerated Fall
  TF: { season: "FA", yearDelta: -1 }, // Special Fall
  SP: { season: "SP", yearDelta: 0 },
  AT: { season: "SP", yearDelta: 0 }, // Accelerated Spring
  TS: { season: "SP", yearDelta: 0 }, // Special Spring
  IS: { season: "SP", yearDelta: 0 }, // Intersession (between Fall and Spring)
  S1: { season: "S1", yearDelta: 0 }, // Summer Term 1
  S2: { season: "S2", yearDelta: 0 }, // Summer Term 2
  T1: { season: "S1", yearDelta: 0 }, // Special Summer 1
  T2: { season: "S2", yearDelta: 0 }, // Special Summer 2
};

function termValueToCode(value: string): string | null {
  const m = value.match(/^(\d{4});([A-Z]{1,3})$/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const seasonRaw = m[2];
  const remap = SEASON_REMAP[seasonRaw];
  if (!remap) return null;
  return `${year + remap.yearDelta}${remap.season}`;
}

// "ABR 1103 15" → { prefix: "ABR", number: "1103", section: "15" }
function parseCourseCode(s: string): { prefix: string; number: string; section: string } | null {
  const m = s.trim().match(/^([A-Z]{2,5})\s+([0-9A-Z]+)\s+([0-9A-Z]+)$/);
  return m ? { prefix: m[1], number: m[2], section: m[3] } : null;
}

// "10/10" → { open: 10, total: 10 }
function parseSeats(s: string): { open: number | null; total: number | null } {
  const m = s.trim().match(/^(\d+)\s*\/\s*(\d+)/);
  if (!m) return { open: null, total: null };
  return { open: parseInt(m[1], 10), total: parseInt(m[2], 10) };
}

// "MTWRF 12:45 PM-2:10 PM; Forrest City Campus, Technical Instruction Building 2"
function parseSchedule(s: string): {
  days: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  campus: string | null;
  mode: CourseMode | null;
} {
  if (!s.trim()) {
    return { days: null, start_time: null, end_time: null, location: null, campus: null, mode: null };
  }
  // Split first meeting from semicolon-separated location.
  // Pattern: "<days> <start>-<end>; <campus>[, <room>]"
  const semiIdx = s.indexOf(";");
  const timepart = semiIdx >= 0 ? s.slice(0, semiIdx).trim() : s.trim();
  const locpart = semiIdx >= 0 ? s.slice(semiIdx + 1).trim() : "";

  let days: string | null = null;
  let start_time: string | null = null;
  let end_time: string | null = null;
  // "MTWRF 12:45 PM-2:10 PM" or "F 8:00 AM-12:00 PM"
  const tm = timepart.match(/^([MTWRFSU]+)\s+(\d{1,2}:\d{2}\s*[AP]M)-(\d{1,2}:\d{2}\s*[AP]M)/);
  if (tm) {
    days = tm[1];
    start_time = tm[2].replace(/\s+/g, " ");
    end_time = tm[3].replace(/\s+/g, " ");
  } else if (/^[MTWRFSU]+$/.test(timepart)) {
    days = timepart;
  }

  let campus: string | null = null;
  let location: string | null = null;
  if (locpart) {
    const commaIdx = locpart.indexOf(",");
    if (commaIdx >= 0) {
      campus = locpart.slice(0, commaIdx).trim();
      location = locpart.slice(commaIdx + 1).trim();
    } else {
      campus = locpart;
    }
  }

  // Mode inference from location/days
  let mode: CourseMode | null = null;
  const lcSched = s.toLowerCase();
  if (lcSched.includes("online") || lcSched.includes("internet") || lcSched.includes("web")) {
    mode = "online";
  } else if (lcSched.includes("hybrid") || lcSched.includes("blended")) {
    mode = "hybrid";
  } else if (days || campus) {
    mode = "in-person";
  }

  return { days, start_time, end_time, location, campus, mode };
}

// "8/24/2026" → "2026-08-24"
function parseDate(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const mm = m[1].padStart(2, "0");
  const dd = m[2].padStart(2, "0");
  return `${m[3]}-${mm}-${dd}`;
}

async function harvestTermValues(page: Page): Promise<{ value: string; label: string }[]> {
  return page.$$eval("#pg0_V_ddlTerm option", (os) =>
    os.map((o) => ({
      value: (o as HTMLOptionElement).value,
      label: o.textContent?.trim() ?? "",
    })),
  );
}

async function harvestRows(page: Page): Promise<RawRow[]> {
  return page.$$eval("#pg0_V_dgCourses tbody tr", (trs) => {
    const out: {
      courseCode: string;
      title: string;
      faculty: string;
      seats: string;
      status: string;
      schedule: string;
      credits: string;
      beginDate: string;
      endDate: string;
    }[] = [];
    for (const tr of trs) {
      // Skip "subItem" bookstore-link rows (hidden, just a bookstore link).
      if (tr.classList.contains("subItem")) continue;
      const tds = Array.from(tr.querySelectorAll(":scope > td"));
      if (tds.length < 11) continue;
      const link = tds[2].querySelector("a");
      const courseCode = link?.textContent?.trim() ?? "";
      if (!courseCode) continue;
      out.push({
        courseCode,
        title: tds[3].textContent?.trim() ?? "",
        faculty: (tds[4].textContent?.trim() ?? "").replace(/\s+/g, " "),
        seats: tds[5].textContent?.trim() ?? "",
        status: tds[6].textContent?.trim() ?? "",
        schedule: tds[7].textContent?.trim() ?? "",
        credits: tds[8].textContent?.trim() ?? "",
        beginDate: tds[9].textContent?.trim() ?? "",
        endDate: tds[10].textContent?.trim() ?? "",
      });
    }
    return out;
  });
}

function rowToSection(r: RawRow, termCode: string): CourseSection | null {
  const cc = parseCourseCode(r.courseCode);
  if (!cc) return null;
  const seats = parseSeats(r.seats);
  const sched = parseSchedule(r.schedule);
  const credits = parseFloat(r.credits) || 0;
  return {
    college_code: SLUG,
    term: termCode,
    course_prefix: cc.prefix,
    course_number: cc.number,
    course_title: r.title,
    credits,
    crn: `${cc.prefix}-${cc.number}-${cc.section}`,
    days: sched.days,
    start_time: sched.start_time,
    end_time: sched.end_time,
    start_date: parseDate(r.beginDate),
    location: sched.location,
    campus: sched.campus,
    mode: sched.mode,
    instructor: r.faculty || null,
    seats_open: seats.open,
    seats_total: seats.total,
    prerequisite_text: null,
    prerequisite_courses: [],
  };
}

// Pick the term values whose normalized code is in the current/upcoming
// calendar window. Today is 2026-05-24 so we want Summer 2026, Fall 2026,
// Spring 2027 — anything earlier is historical and gets dropped.
function pickActiveTerms(
  all: { value: string; label: string }[],
  override?: string,
): { value: string; label: string; code: string }[] {
  const out: { value: string; label: string; code: string }[] = [];
  const seen = new Set<string>();
  const currentYear = new Date().getFullYear();
  for (const t of all) {
    const code = termValueToCode(t.value);
    if (!code) continue;
    if (override && code !== override) continue;
    const year = parseInt(code.slice(0, 4), 10);
    if (year < currentYear) continue;
    // Keep only one entry per normalized code (skip duplicate sub-windows).
    if (seen.has(code)) continue;
    seen.add(code);
    out.push({ value: t.value, label: t.label, code });
  }
  return out;
}

async function scrapeTerm(
  page: Page,
  term: { value: string; label: string; code: string },
): Promise<CourseSection[]> {
  await page.selectOption("#pg0_V_ddlTerm", term.value);
  // Term dropdown auto-postbacks; let it settle.
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(1500);
  await page.click("#pg0_V_btnSearch");
  await page.waitForLoadState("networkidle").catch(() => undefined);
  // Wait for results to render (or for a "no rows" state).
  await page
    .waitForFunction(
      () => document.querySelector("#pg0_V_dgCourses") !== null,
      { timeout: 25_000 },
    )
    .catch(() => undefined);
  await page.waitForTimeout(1500);
  const rows = await harvestRows(page);
  const out: CourseSection[] = [];
  for (const r of rows) {
    const sec = rowToSection(r, term.code);
    if (sec) out.push(sec);
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const termIdx = args.indexOf("--term");
  const termOverride = termIdx >= 0 ? args[termIdx + 1] : undefined;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);

  try {
    console.log(`loading ${SEARCH_URL}`);
    await page.goto(SEARCH_URL, { waitUntil: "networkidle" });
    const allTerms = await harvestTermValues(page);
    const active = pickActiveTerms(allTerms, termOverride);
    if (active.length === 0) {
      console.error(
        `no active terms matched (override=${termOverride ?? "<none>"}). Available: ${allTerms.map((t) => `${t.value}=${termValueToCode(t.value) ?? "?"}`).join(", ")}`,
      );
      process.exit(1);
    }
    console.log(
      `active terms: ${active.map((t) => `${t.code} (${t.label})`).join(", ")}`,
    );

    fs.mkdirSync(COURSES_DIR, { recursive: true });
    let total = 0;
    // Drop terms whose latest section start_date is more than 21 days in the
    // past (issue #173 pattern). EACC's "Accelerated Spring" maps to the
    // same 2026SP code as regular Spring, so without this guard a March
    // 2026 mini-term keeps re-publishing into the corpus after Spring ended.
    const STALE_THRESHOLD_MS = 21 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    for (const term of active) {
      console.log(`\n--- ${term.code} (${term.label}) ---`);
      try {
        const sections = await scrapeTerm(page, term);
        if (sections.length === 0) {
          console.log("  0 sections; skipping write");
          continue;
        }
        const latestStart = Math.max(
          ...sections
            .map((s) => (s.start_date ? Date.parse(s.start_date) : NaN))
            .filter((n) => !Number.isNaN(n)),
        );
        if (Number.isFinite(latestStart) && now - latestStart > STALE_THRESHOLD_MS) {
          console.log(
            `  skip: latest start_date ${new Date(latestStart).toISOString().slice(0, 10)} is >21 days in the past`,
          );
          continue;
        }
        const out = path.join(COURSES_DIR, `${term.code}.json`);
        fs.writeFileSync(out, JSON.stringify(sections, null, 2) + "\n");
        console.log(`  ${sections.length} sections → ${out}`);
        total += sections.length;
      } catch (e) {
        console.error(`  error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    console.log(`\n=== Done: ${total} sections across ${active.length} terms ===`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

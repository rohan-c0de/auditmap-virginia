/**
 * scrape-wvup.ts
 *
 * Scrapes WVU at Parkersburg course sections from the custom XML schedule
 * system at schedules.wvup.edu.
 *
 * API: POST https://schedules.wvup.edu/schedule/dosql/2.php
 *      body: q=TERMCODE||   (e.g. q=202701||)
 *      requires: Referer: https://schedules.wvup.edu/schedule/schedule.php?...
 *
 * Response: XML <info> containing <row> elements per department.
 * Each row's <course_info> holds ^^-separated sections; each section is
 * ||-separated with the following positions:
 *   0  %%seats_avail%%seats_total
 *   1  CRN
 *   2  subject prefix (e.g. ACCT)
 *   3  course number (e.g. 201)
 *   4  "TITLE,credits  "
 *   5  type (Lecture / Online / Hybrid / Lab / …)
 *   6  "DAYS%%TIME%%INSTRUCTOR%%ROOM%%LOCATION%%START_DATE"
 *   7  (internal code)
 *   8  "PART_OF_TERM,(START_DATE - END_DATE)"
 *   9  notes (often empty)
 *   10 more notes (often empty)
 *   11 course description
 *   12-15 (empty)
 *   16 prerequisites text ($$OR / $$AND separated; empty if none)
 *   17 corequisites text (often same as prereqs; empty if none)
 *
 * Term codes: YYYYSS where SS=01(Fall)/02(Spring)/03(Summer), year is
 * calendar year of the fall semester + 1 (e.g. 202701 = Fall 2026).
 *
 * Usage:
 *   npx tsx scripts/wv/scrape-wvup.ts
 *   npx tsx scripts/wv/scrape-wvup.ts --no-import
 */

import * as fs from "fs";
import * as path from "path";

const BASE = "https://schedules.wvup.edu/schedule";
const REFERER = `${BASE}/schedule.php`;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const SLUG = "wvup";
const STATE = "wv";

// How many recent/upcoming terms to keep (current + 1 ahead)
const MAX_TERMS = 3;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Section {
  college_code: string;
  term: string;
  course_prefix: string;
  course_number: string;
  course_title: string;
  credits: number | null;
  crn: string;
  days: string;
  start_time: string;
  end_time: string;
  start_date: string;
  end_date: string;
  location: string;
  campus: string;
  mode: string;
  instructor: string;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string;
  prerequisite_courses: string[];
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function postXml(path_: string, body: string): Promise<string> {
  const url = `${BASE}/${path_}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "User-Agent": UA,
          "Content-Type": "application/x-www-form-urlencoded",
          "Referer": REFERER,
          "Origin": "https://schedules.wvup.edu",
        },
        body,
      });
      if (res.ok) return res.text();
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return "";
    } catch (e) {
      if (attempt === 2) throw e;
      await sleep(1000 * (attempt + 1));
    }
  }
  return "";
}

// ---------------------------------------------------------------------------
// Term discovery
// ---------------------------------------------------------------------------

/**
 * Parse the term_codes field: "202801|Fall 2027^202703|Summer 2027^..."
 * Return sorted descending (newest first).
 */
function parseTermCodes(termCodes: string): Array<{ code: string; desc: string }> {
  return termCodes
    .split("^")
    .filter(Boolean)
    .map((t) => {
      const [code, ...rest] = t.split("|");
      return { code: code.trim(), desc: rest.join("|").trim() };
    })
    .filter((t) => t.code.match(/^\d{6}$/))
    .sort((a, b) => Number(b.code) - Number(a.code));
}

/**
 * Map WVUP term code to canonical term key (e.g. 202701 → 2026FA).
 * WVUP uses academic-year notation: the YEAR digit is calendar_year+1 for Fall.
 */
function termCodeToKey(code: string): string {
  const year = parseInt(code.slice(0, 4), 10);
  const semester = code.slice(4, 6);
  if (semester === "01") return `${year - 1}FA`; // 202701 → 2026FA
  if (semester === "02") return `${year}SP`;      // 202602 → 2026SP
  if (semester === "03") return `${year}SU`;      // 202603 → 2026SU
  return `${year}XX`;
}

async function getRecentTerms(): Promise<Array<{ code: string; key: string; desc: string }>> {
  // dosql/1.php returns the current active term in <term_code> and a full list
  // in <term_codes>. We anchor on the current term and take a window of
  // MAX_TERMS terms around it, skipping empties.
  const xml = await postXml("dosql/1.php", "q=202701%7C%7C");
  const currentMatch = xml.match(/<term_code>(\d{6})<\/term_code>/);
  const listMatch = xml.match(/<term_codes>([^<]+)<\/term_codes>/);
  if (!listMatch) throw new Error("dosql/1.php: no term_codes in response");

  const currentCode = currentMatch?.[1] ?? "";
  const all = parseTermCodes(listMatch[1]);

  // Find the index of the current term in the sorted-descending list
  const currentIdx = all.findIndex((t) => t.code === currentCode);
  // Start one ahead of current (next semester open for registration) and
  // go back to include current + past terms
  const startIdx = Math.max(0, currentIdx - 1);
  const candidates = all.slice(startIdx, startIdx + MAX_TERMS + 3);

  return candidates.map((t) => ({ ...t, key: termCodeToKey(t.code) }));
}

// ---------------------------------------------------------------------------
// Section parsing
// ---------------------------------------------------------------------------

const CODE_RE = /\b([A-Z]{2,5})\s*(\d{3,4}[A-Z]?)\b/g;

function extractCourses(text: string): string[] {
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  CODE_RE.lastIndex = 0;
  while ((m = CODE_RE.exec(text)) !== null) {
    found.add(`${m[1]} ${m[2]}`);
  }
  return Array.from(found).sort();
}

function cleanText(raw: string): string {
  return raw
    .replace(/\$\$OR/g, " OR ")
    .replace(/\$\$AND/g, " AND ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.;,]\s*$/, "")
    .trim();
}

function parseTime(raw: string): { start: string; end: string } {
  // "09:30 - 10:45 am" → start="09:30 am" end="10:45 am"
  // "11:00 - 12:15 pm" → start="11:00 am" end="12:15 pm"  (suffix on end only)
  // "Online" or "" → both empty
  if (!raw || raw.toLowerCase() === "online") return { start: "", end: "" };
  const m = raw.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (!m) return { start: raw.trim(), end: "" };
  const endHour = parseInt(m[3], 10);
  const suffix = (m[5] ?? "").toLowerCase();
  // End time uses the explicit suffix (or leaves bare if absent)
  const endSuffix = suffix ? ` ${suffix}` : "";
  const end = `${m[3]}:${m[4]}${endSuffix}`;
  // Start time: if the range crosses noon (e.g. "11:00 - 12:15 pm"), start is AM.
  // Any other pm range ("04:00 - 07:30 pm") keeps both as pm.
  const startHour = parseInt(m[1], 10);
  let startSuffix = endSuffix;
  if (suffix === "pm" && startHour < 12 && endHour === 12) startSuffix = " am";
  const start = `${m[1]}:${m[2]}${startSuffix}`;
  return { start, end };
}

function parseSection(raw: string, termKey: string): Section | null {
  const parts = raw.split("||");
  if (parts.length < 9) return null;

  // Position 0: %%seats_avail%%seats_total
  const seatsParts = (parts[0] || "").split("%%").filter(Boolean);
  const seatsOpen = parseInt(seatsParts[0] ?? "", 10);
  const seatsTotal = parseInt(seatsParts[1] ?? "", 10);

  const crn = (parts[1] || "").trim();
  const prefix = (parts[2] || "").trim().toUpperCase();
  const number = (parts[3] || "").trim();
  const titleCredits = (parts[4] || "").trim();

  if (!crn || !prefix || !number) return null;

  // Title and credits: "PRIN OF ACCOUNTING 1,3  " → title="PRIN OF ACCOUNTING 1", credits=3
  const titleMatch = titleCredits.match(/^(.*?),\s*(\d+(?:\.\d+)?)\s*$/);
  const title = titleMatch ? titleMatch[1].trim() : titleCredits.replace(/,\s*\d+\s*$/, "").trim();
  const credits = titleMatch ? parseFloat(titleMatch[2]) : null;

  const mode = (parts[5] || "").trim();

  // Position 6: "DAYS%%TIME%%INSTRUCTOR%%ROOM%%LOCATION%%START_DATE"
  const mtg = (parts[6] || "").split("%%");
  const days = (mtg[0] || "").trim();
  const timeRaw = (mtg[1] || "").trim();
  const instructor = (mtg[2] || "").trim();
  const location = (mtg[4] || "").replace(/\(MAIN CAMPUS\)/gi, "").replace(/\(MAIN\)/gi, "").trim();
  const startDate = (mtg[5] || "").trim();

  // Position 8: "FULL TERM,(08-17-2026 - 12-11-2026)"
  const termPart = parts[8] || "";
  const dateMatch = termPart.match(/\((\d{2}-\d{2}-\d{4})\s*-\s*(\d{2}-\d{2}-\d{4})\)/);
  const endDate = dateMatch ? dateMatch[2] : "";

  const { start: startTime, end: endTime } = parseTime(timeRaw);

  // Prereqs at position 16
  const prereqRaw = cleanText(parts[16] || "");
  const prereqCourses = prereqRaw ? extractCourses(prereqRaw) : [];

  return {
    college_code: SLUG,
    term: termKey,
    course_prefix: prefix,
    course_number: number,
    course_title: title,
    credits: isNaN(credits as number) ? null : credits,
    crn,
    days,
    start_time: startTime,
    end_time: endTime,
    start_date: startDate || (dateMatch ? dateMatch[1] : ""),
    end_date: endDate,
    location,
    campus: "Main Campus",
    mode,
    instructor,
    seats_open: isNaN(seatsOpen) ? null : seatsOpen,
    seats_total: isNaN(seatsTotal) ? null : seatsTotal,
    prerequisite_text: prereqRaw,
    prerequisite_courses: prereqCourses,
  };
}

function parseDeptXml(xml: string, termKey: string): Section[] {
  const sections: Section[] = [];
  // Extract each <row>'s <course_info>
  const rowRe = /<course_info>([\s\S]*?)<\/course_info>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(xml)) !== null) {
    const courseInfo = m[1]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"');
    // Split into individual sections by ^^
    const rawSections = courseInfo.split("^^").filter((s) => s.trim());
    for (const raw of rawSections) {
      // Skip "X,Crosslisted Course" headers
      if (raw.startsWith("X,")) continue;
      const s = parseSection(raw.trim(), termKey);
      if (s) sections.push(s);
    }
  }
  return sections;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const noImport = args.includes("--no-import");

  console.log("WVU Parkersburg course scraper (custom XML schedule)");

  const terms = await getRecentTerms();
  console.log(`  Terms: ${terms.map((t) => `${t.key} (${t.desc})`).join(", ")}`);

  const outDir = path.join(process.cwd(), "data", STATE, "courses", SLUG);
  fs.mkdirSync(outDir, { recursive: true });

  let written = 0;
  for (const term of terms) {
    if (written >= MAX_TERMS) break;
    console.log(`\n[${term.key}] Fetching (term code ${term.code})...`);
    const xml = await postXml("dosql/2.php", `q=${term.code}%7C%7C`);
    const sections = parseDeptXml(xml, term.key);
    console.log(`  Parsed ${sections.length} sections`);
    if (sections.length === 0) {
      console.log(`  Skipping (empty)`);
      continue;
    }

    const outPath = path.join(outDir, `${term.key}.json`);
    fs.writeFileSync(outPath, JSON.stringify(sections, null, 2));
    console.log(`  Wrote ${outPath}`);
    written++;
    await sleep(500);
  }

  console.log("\nDone.");

  if (!noImport) {
    console.log("  (Supabase import skipped — run with --no-import is default for now)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

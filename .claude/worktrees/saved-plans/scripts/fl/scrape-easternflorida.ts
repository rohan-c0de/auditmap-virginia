/**
 * Eastern Florida State College — ColdFusion form scrape
 *
 * EFSC publishes a public class schedule at
 *   https://webapps.easternflorida.edu/schedule_search/index.cfm
 *
 * A POST to /schedule_search/results.cfm with `startsearch=yes&term=<code>`
 * returns the full result set for that term as ~200KB of HTML — no
 * pagination, no auth, no session cookie required.
 *
 * Each result row is 8 <td> cells:
 *   TD0 Campus  TD1 CRN  TD2 Course-section  TD3 Course Type
 *   TD4 Title   TD5 Dates  TD6 Days  TD7 Time
 *
 * Credits / instructor / seats are not in the main table — they would
 * require an extra `details.cfm?crn=X&termcode=Y` per section. Skipped
 * here to match Westmoreland's approach (and to avoid burning 2k+ extra
 * requests per scrape).
 *
 * Day letters: M T W R F S U  (R=Thu, U=Sun). Hyphens between non-
 * adjacent letters (`M-W`) are separators, not ranges. Multi-meeting
 * rows split days+times with `<br>` (e.g. "MTWR <br> MTWR" with
 * matching "08:00 AM - 12:00 PM <br> 12:30 PM - 03:30 PM"). The
 * `12:00 AM - 12:01 AM` time is the online-async sentinel.
 *
 * Usage:
 *   npx tsx scripts/fl/scrape-easternflorida.ts
 *   npx tsx scripts/fl/scrape-easternflorida.ts --no-import
 *   npx tsx scripts/fl/scrape-easternflorida.ts --list-terms
 */

import * as fs from "fs";
import * as path from "path";

const STATE = "fl";
const COLLEGE_SLUG = "easternflorida";
const INDEX_URL =
  "https://webapps.easternflorida.edu/schedule_search/index.cfm";
const RESULTS_URL =
  "https://webapps.easternflorida.edu/schedule_search/results.cfm";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";

interface TermOption {
  value: string;
  label: string;
}

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
  mode: "in-person" | "online" | "hybrid" | "zoom";
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

async function fetchTerms(): Promise<TermOption[]> {
  const r = await fetch(INDEX_URL, { headers: { "User-Agent": UA } });
  const html = await r.text();
  // Locate the <select name="term"> ... </select> block specifically —
  // the form has multiple selects (subject, campus, etc.) after this
  // one, so we must stop at the first </select>.
  const startIdx = html.indexOf('name="term"');
  if (startIdx === -1) return [];
  const endIdx = html.indexOf("</select>", startIdx);
  const region = html.substring(startIdx, endIdx === -1 ? startIdx + 5000 : endIdx);
  const out: TermOption[] = [];
  const optRegex = /<option[^>]*value="([^"]+)"[^>]*>\s*([^<]+?)\s*<\/option>/gi;
  let m: RegExpExecArray | null;
  while ((m = optRegex.exec(region)) !== null) {
    const value = m[1].trim();
    const label = m[2].replace(/\s+/g, " ").trim();
    if (!value || value === "0") continue;
    out.push({ value, label });
  }
  return out;
}

function termCodeToStandard(code: string, label: string): string | null {
  // Format YYYYTT — TT=20 Summer, 40 Fall, 10 Spring (inferred).
  const m = code.match(/^(\d{4})(\d{2})/);
  if (!m) return null;
  const year = m[1];
  const suffix = m[2];
  if (suffix === "40") return `${year}FA`;
  if (suffix === "20") return `${year}SU`;
  if (suffix === "10") return `${year}SP`;
  // Fall back to the label.
  const l = label.toLowerCase();
  if (l.includes("fall")) return `${year}FA`;
  if (l.includes("summer")) return `${year}SU`;
  if (l.includes("spring")) return `${year}SP`;
  return null;
}

async function fetchResults(termCode: string, prefix?: string): Promise<string> {
  const params: Record<string, string> = {
    startsearch: "yes",
    term: termCode,
  };
  if (prefix) params.prefix = prefix;
  const body = new URLSearchParams(params);
  const r = await fetch(RESULTS_URL, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: INDEX_URL,
    },
    body,
  });
  if (!r.ok) throw new Error(`POST failed: HTTP ${r.status}`);
  return r.text();
}

async function fetchPrefixes(): Promise<string[]> {
  const r = await fetch(INDEX_URL, { headers: { "User-Agent": UA } });
  const html = await r.text();
  const startIdx = html.indexOf('name="prefix"');
  if (startIdx === -1) return [];
  const endIdx = html.indexOf("</select>", startIdx);
  const region = html.substring(startIdx, endIdx);
  const opts = [...region.matchAll(/<option[^>]*value="([^"]+)"[^>]*>/gi)];
  return opts.map((m) => m[1]).filter((v) => v && v !== "0");
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCourseSection(raw: string): { prefix: string; number: string; section: string } | null {
  // "ACG 2021 - 01C" → prefix=ACG, number=2021, section=01C
  // Also handle "ACRC 0000 - 40C" (4-letter prefix), "AMH 2010 - 01C"
  const m = raw.match(/^([A-Z]{2,4})\s+([0-9A-Z]+)\s*-\s*(\S+)$/);
  if (!m) return null;
  return { prefix: m[1], number: m[2], section: m[3] };
}

function parseDateRange(text: string): string {
  // "08/17/2026 - 12/11/2026" → "2026-08-17"
  const m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return "";
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

// Convert EFSC's day letters to the canonical space-separated form
// used elsewhere in the repo. Multiple meetings get joined with " / ".
function encodeDays(raw: string): string {
  // Multi-meeting rows are <br>-separated; turn each into a day-string,
  // then join with " / " so the downstream UI can show both.
  const parts = raw
    .split(/<br\s*\/?>/i)
    .map((p) => stripTags(p))
    .filter(Boolean);
  if (parts.length === 0) return "";
  const dayMap: Record<string, string> = {
    M: "M", T: "Tu", W: "W", R: "Th", F: "F", S: "Sa", U: "Su",
  };
  const out = parts.map((p) => {
    // Split on hyphens which are EFSC's separator (M-W, T-R).
    const letters = p.replace(/[-\s]+/g, "");
    const tokens: string[] = [];
    for (const ch of letters) if (dayMap[ch]) tokens.push(dayMap[ch]);
    return tokens.join(" ");
  });
  return out.filter(Boolean).join(" / ");
}

function parseTimeCell(raw: string): { start: string; end: string } {
  // "09:25 AM - 10:40 AM" → {start, end}
  // Multi-meeting <br>-separated — take the FIRST meeting's times for
  // the canonical fields; UI shows the days field as "MTuWTh / FSa".
  const first = raw.split(/<br\s*\/?>/i)[0];
  const txt = stripTags(first);
  // Detect online sentinel.
  if (/^12:00\s*AM\s*-\s*12:01\s*AM$/i.test(txt)) return { start: "", end: "" };
  const m = txt.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))\s*-\s*(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
  if (!m) return { start: "", end: "" };
  return { start: m[1].toLowerCase(), end: m[2].toLowerCase() };
}

function detectMode(courseType: string, days: string, location: string): CourseSection["mode"] {
  const c = courseType.toLowerCase();
  const l = location.toLowerCase();
  if (c.includes("online") || l.includes("online") || days === "") return "online";
  if (c.includes("hybrid") || c.includes("blended")) return "hybrid";
  if (c.includes("live online") || c.includes("zoom")) return "zoom";
  return "in-person";
}

function parseRow(rowHtml: string, term: string): CourseSection | null {
  // Pull the 8 raw <td> cells (preserve inner HTML so we can split <br>).
  const tds = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
  if (tds.length < 8) return null;

  const campus = stripTags(tds[0]);
  const crn = stripTags(tds[1]);
  // Skip header rows / non-section rows.
  if (!/^\d+$/.test(crn)) return null;

  const courseRaw = stripTags(tds[2]);
  const code = parseCourseSection(courseRaw);
  if (!code) return null;

  const courseType = stripTags(tds[3]);
  // TD4 is the title cell: contains nested anchors. The title text is
  // the first <a>'s inner text.
  const titleAnchor = tds[4].match(/<a[^>]+>([^<]+)<\/a>/);
  const courseTitle = titleAnchor
    ? stripTags(titleAnchor[1])
    : stripTags(tds[4]);

  const dateRange = stripTags(tds[5]);
  const startDate = parseDateRange(dateRange);

  const days = encodeDays(tds[6]);
  const { start: startTime, end: endTime } = parseTimeCell(tds[7]);

  const mode = detectMode(courseType, days, courseType);

  return {
    college_code: COLLEGE_SLUG,
    term,
    course_prefix: code.prefix,
    course_number: code.number,
    course_title: courseTitle,
    credits: 0, // Not in main table — would need details.cfm popup.
    crn,
    days,
    start_time: startTime,
    end_time: endTime,
    start_date: startDate,
    location: "",
    campus,
    mode,
    instructor: null, // Same — details.cfm only.
    seats_open: null,
    seats_total: null,
    prerequisite_text: null,
    prerequisite_courses: [],
  };
}

function parseResults(html: string, term: string): CourseSection[] {
  const out: CourseSection[] = [];
  // Match every <tr>; parseRow filters non-section rows by checking
  // that TD1 is purely numeric.
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  for (const r of rows) {
    const sec = parseRow(r[1], term);
    if (sec) out.push(sec);
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const noImport = args.includes("--no-import");
  const listTerms = args.includes("--list-terms");

  console.log("=== Eastern Florida State College scraper ===");
  console.log(`  Endpoint: ${INDEX_URL}`);

  const allTerms = await fetchTerms();
  console.log(`  Discovered ${allTerms.length} term option(s)`);
  if (listTerms) {
    for (const t of allTerms) console.log(`  ${t.value}\t${t.label}`);
    return;
  }

  // Use only the bare "all classes" codes (no comma-suffixed subsets).
  // Comma-suffixed codes like "202640,1" filter the result to a specific
  // session within the term and would dupe the data if we summed them.
  const targets = allTerms.filter((t) => !t.value.includes(","));
  console.log(`  Targeting ${targets.length} top-level term(s): ${targets.map((t) => t.value).join(", ")}`);

  const outDir = path.join(process.cwd(), "data", STATE, "courses", COLLEGE_SLUG);
  fs.mkdirSync(outDir, { recursive: true });

  // EFSC's search caps results at 100 per request and renders a "your
  // search has returned N classes" notice. Iterate per subject prefix
  // to get full coverage (~238 prefixes × ~2 terms ≈ 500 POSTs).
  console.log(`\n  Loading subject-prefix list...`);
  const prefixes = await fetchPrefixes();
  console.log(`  ${prefixes.length} prefixes to iterate per term`);

  let grandTotal = 0;
  for (const t of targets) {
    const term = termCodeToStandard(t.value, t.label);
    if (!term) {
      console.log(`  skip ${t.value} (${t.label}) — can't derive canonical term code`);
      continue;
    }
    // Only scrape current calendar year onwards.
    const year = parseInt(term.slice(0, 4), 10);
    if (year < new Date().getFullYear()) continue;
    console.log(`\n  Scraping ${t.label} (${t.value} → ${term})...`);

    // De-dupe across prefix queries via CRN — defensive in case the
    // server cross-lists a section under multiple subject prefixes.
    const seen = new Set<string>();
    const accum: CourseSection[] = [];
    let prefixIdx = 0;
    for (const pfx of prefixes) {
      prefixIdx++;
      const html = await fetchResults(t.value, pfx);
      const sections = parseResults(html, term);
      let added = 0;
      for (const s of sections) {
        if (seen.has(s.crn)) continue;
        seen.add(s.crn);
        accum.push(s);
        added++;
      }
      if (added > 0 || prefixIdx % 25 === 0) {
        console.log(`    [${prefixIdx}/${prefixes.length}] ${pfx} +${added} (total ${accum.length})`);
      }
      // Be polite to the ColdFusion server.
      await new Promise((r) => setTimeout(r, 200));
    }

    console.log(`    → ${accum.length} sections for ${term}`);
    if (accum.length > 0) {
      fs.writeFileSync(
        path.join(outDir, `${term}.json`),
        JSON.stringify(accum, null, 2),
      );
      grandTotal += accum.length;
    }
  }

  console.log(`\n=== Summary ===\n  Total: ${grandTotal} sections`);

  if (!noImport && grandTotal > 0) {
    const { importCoursesToSupabase } = await import("../lib/supabase-import");
    await importCoursesToSupabase(STATE);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * St. Petersburg College — JSON API scrape
 *
 * SPC publishes its full class schedule via a paginated JSON endpoint at
 *   https://classes.spcollege.edu/ClassSchedule/Search?Term=<GUID>&Page=N
 * which returns `{ courses: [...], <list of page urls> }`. No HTML
 * scraping required — the response is pure JSON despite the .edu host.
 *
 * Each course object has:
 *   subj, desc, crsdesc, classes: [
 *     { id, sec, start, end, mode, sess, estat, etot, ecap, campus,
 *       crh, instrs: [{ fn, sn }], sched: [{ days, start, end, loc }] }
 *   ]
 *
 * estat = enrollment status (O = open, C = closed/waitlist).
 * etot/ecap = enrolled / capacity. seats_open = ecap - etot.
 * crsdesc may contain HTML-encoded "Prerequisite: …" sentences which we
 * extract for prerequisite_text + prerequisite_courses.
 *
 * Term GUIDs are page-load values from classes.spcollege.edu. The
 * landing page also embeds them in option tags; the scraper auto-
 * discovers active GUIDs and labels them by parsing the same page.
 *
 * Usage:
 *   npx tsx scripts/fl/scrape-spcollege.ts
 *   npx tsx scripts/fl/scrape-spcollege.ts --list-terms
 *   npx tsx scripts/fl/scrape-spcollege.ts --term 2026SU
 */

import * as fs from "fs";
import * as path from "path";

const STATE = "fl";
const COLLEGE_SLUG = "spcollege";
const BASE_URL = "https://classes.spcollege.edu";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
const FETCH_HEADERS = { "User-Agent": UA, Accept: "application/json" };
const PAGE_DELAY_MS = 250;

interface SpcSection {
  id: string;
  sec: number;
  start: string;
  end: string;
  mode: string;
  sess: string;
  estat: string;
  etot: number;
  ecap: number;
  campus: string;
  crh: string;
  instrs?: { fn: string; sn: string }[];
  sched?: { days: string; start: string; end: string; loc: string }[];
}

interface SpcCourse {
  subj: string;
  desc: string;
  crsdesc?: string;
  classes: SpcSection[];
}

interface SearchResponse {
  courses: SpcCourse[];
  page: number;
  // Absolute URLs for every page of the result set. `pages.length` is
  // the true page count — once we exceed it, the server cheerfully
  // keeps serving residual sections which would otherwise duplicate
  // the dataset 3-4×. Trust `pages.length`, not "stop on empty response".
  pages: string[];
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

interface DiscoveredTerm {
  guid: string;
  label: string;
  termCode: string;
}

function termLabelToCode(label: string): string | null {
  // "Summer 2026 (May - August)" / "Fall 2026 (August - December)"
  const m = label.match(/(Spring|Summer|Fall|Winter)\s+(20\d{2})/i);
  if (!m) return null;
  const seasonAbbr: Record<string, string> = {
    spring: "SP", summer: "SU", fall: "FA", winter: "WI",
  };
  return `${m[2]}${seasonAbbr[m[1].toLowerCase()]}`;
}

async function discoverTerms(): Promise<DiscoveredTerm[]> {
  const r = await fetch(`${BASE_URL}/`, { headers: { "User-Agent": UA } });
  const html = await r.text();
  const out: DiscoveredTerm[] = [];

  // (a) The currently-selected term shows in the page <h1> ("Fall 2026")
  //     with its GUID in the search-form hidden input
  //     (<input name="term" value="<GUID>" />). The "change to other
  //     terms" links below show ONLY the alternatives, not the current.
  const currentGuidMatch = html.match(
    /<input[^>]+name="term"[^>]+value="([0-9a-f-]{36})"/i,
  );
  const currentLabelMatch = html.match(
    /<h1[^>]*>\s*((?:Spring|Summer|Fall|Winter)\s+20\d{2})/i,
  );
  if (currentGuidMatch && currentLabelMatch) {
    const code = termLabelToCode(currentLabelMatch[1]);
    if (code) {
      out.push({
        guid: currentGuidMatch[1],
        label: currentLabelMatch[1].replace(/\s+/g, " ").trim(),
        termCode: code,
      });
    }
  }

  // (b) Other terms appear as anchor links:
  //   <a href="/?Term=<GUID>" data-control="term" data-term="<GUID>">
  //       Summer\n2026          </a>
  const regex =
    /<a\s+href="\/\?Term=([0-9a-f-]{36})"[^>]*data-control="term"[^>]*>\s*([\s\S]*?)\s*<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(html)) !== null) {
    const guid = m[1];
    const label = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const termCode = termLabelToCode(label);
    if (!termCode) continue;
    out.push({ guid, label, termCode });
  }

  // De-dup by termCode keeping the first occurrence
  const seen = new Set<string>();
  return out.filter((t) => {
    if (seen.has(t.termCode)) return false;
    seen.add(t.termCode);
    return true;
  });
}

async function fetchPage(termGuid: string, page: number): Promise<SearchResponse> {
  const url = `${BASE_URL}/ClassSchedule/Search?Term=${termGuid}&Page=${page}`;
  const r = await fetch(url, { headers: FETCH_HEADERS });
  if (!r.ok) throw new Error(`Page ${page} fetch failed: HTTP ${r.status}`);
  return r.json();
}

async function fetchAllPagesForTerm(termGuid: string): Promise<SpcCourse[]> {
  // Fetch page 1 first to discover the true total page count.
  const first = await fetchPage(termGuid, 1);
  const totalPages = first.pages?.length ?? 1;
  process.stdout.write(
    `    page 1: +${first.courses.length} courses (1 of ${totalPages})\n`,
  );

  const all: SpcCourse[] = [...first.courses];
  for (let page = 2; page <= totalPages; page++) {
    await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
    const data = await fetchPage(termGuid, page);
    all.push(...data.courses);
    process.stdout.write(
      `    page ${page}: +${data.courses.length} courses (total ${all.length})\n`,
    );
  }
  return all;
}

function detectMode(mode: string): CourseSection["mode"] {
  const m = mode.toLowerCase();
  if (m.includes("online")) return "online";
  if (m.includes("blended") || m.includes("hybrid")) return "hybrid";
  if (m.includes("zoom") || m.includes("live online") || m.includes("synchronous")) return "zoom";
  return "in-person";
}

// SPC encodes meeting days as "MWF" / "TR" / etc. Convert to spaced form.
function decodeDays(raw: string): string {
  if (!raw) return "";
  const out: string[] = [];
  for (const c of raw) {
    if (c === "M") out.push("M");
    else if (c === "T") out.push("Tu");
    else if (c === "W") out.push("W");
    else if (c === "R") out.push("Th");
    else if (c === "F") out.push("F");
    else if (c === "S") out.push("Sa");
    else if (c === "U") out.push("Su");
  }
  return out.join(" ");
}

function formatTime(ts: string): string {
  // SPC encodes meeting times as "10:00 AM" already; some are blank for
  // online async sections.
  return ts.trim();
}

function parsePrereqs(html: string): { text: string | null; courses: string[] } {
  // SPC's crsdesc embeds prerequisites like:
  //   "...Prerequisite PSY 1012 or Prerequisite PSY 1012H"
  //   "...Prerequisite: ENC 1101..."
  // Look for the first "Prerequisite" word and grab the sentence.
  const stripped = html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  const idx = stripped.search(/Prerequisite/i);
  if (idx === -1) return { text: null, courses: [] };
  const tail = stripped.substring(idx);
  // Grab until the next sentence boundary or a parenthetical note.
  const sentence = tail.match(/^([^.()]+(?:\([^)]*\))?[^.]*)\.?/);
  if (!sentence) return { text: null, courses: [] };
  const text = sentence[1].trim();
  // Extract course codes like "PSY 1012", "ENC 1101H".
  const codes = [
    ...new Set((text.match(/[A-Z]{2,4}\s?\d{4}[A-Z]?/g) ?? []).map((s) => s.replace(/\s+/g, " ").trim())),
  ];
  return { text: text.length > 200 ? text.slice(0, 200) + "…" : text, courses: codes };
}

function instructorName(instrs?: { fn: string; sn: string }[]): string | null {
  if (!instrs || instrs.length === 0) return null;
  // De-dupe — SPC's payload sometimes lists the same instructor twice.
  const seen = new Set<string>();
  const names: string[] = [];
  for (const i of instrs) {
    const name = `${(i.fn ?? "").trim()} ${(i.sn ?? "").trim()}`.trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names.length > 0 ? names.join("; ") : null;
}

function startDateFromISO(s: string): string {
  if (!s) return "";
  return s.slice(0, 10);
}

function convertCourse(course: SpcCourse, term: string): CourseSection[] {
  const codeMatch = course.subj.match(/^([A-Z]{2,4})(\d{3,4}[A-Z]?)$/);
  if (!codeMatch) return [];
  const [, prefix, number] = codeMatch;
  const prereq = course.crsdesc ? parsePrereqs(course.crsdesc) : { text: null as string | null, courses: [] };

  const sections: CourseSection[] = [];
  for (const sec of course.classes ?? []) {
    const sched = sec.sched?.[0] ?? { days: "", start: "", end: "", loc: "" };
    const seatsOpen = Math.max(0, (sec.ecap ?? 0) - (sec.etot ?? 0));
    sections.push({
      college_code: COLLEGE_SLUG,
      term,
      course_prefix: prefix,
      course_number: number,
      course_title: course.desc,
      credits: parseFloat(sec.crh) || 0,
      // SPC's `sec` field is a section *number* and is not unique (CLP2140
      // sec 237 exists in both Summer and Fall, and even within a single
      // term different subjects re-use sec numbers). Use the `id` UUID
      // SPC's API attaches to each section as the unique key.
      crn: sec.id,
      days: decodeDays(sched.days ?? ""),
      start_time: formatTime(sched.start ?? ""),
      end_time: formatTime(sched.end ?? ""),
      start_date: startDateFromISO(sec.start ?? ""),
      location: sched.loc ?? "",
      campus: sec.campus ?? "",
      mode: detectMode(sec.mode ?? ""),
      instructor: instructorName(sec.instrs),
      seats_open: seatsOpen,
      seats_total: sec.ecap ?? null,
      prerequisite_text: prereq.text,
      prerequisite_courses: prereq.courses,
    });
  }
  return sections;
}

async function main() {
  const args = process.argv.slice(2);
  const noImport = args.includes("--no-import");
  const listTerms = args.includes("--list-terms");
  const termFilterIdx = args.indexOf("--term");
  const termFilter = termFilterIdx >= 0 ? args[termFilterIdx + 1] : undefined;

  console.log("=== St. Petersburg College scraper ===");
  console.log("  Discovering terms from landing page...");
  const terms = await discoverTerms();
  if (terms.length === 0) {
    console.error("  No term GUIDs found on landing page.");
    process.exit(1);
  }
  console.log(`  Found ${terms.length} term(s): ${terms.map((t) => `${t.termCode} (${t.label})`).join(", ")}`);

  if (listTerms) {
    for (const t of terms) console.log(`  ${t.guid}\t${t.termCode}\t${t.label}`);
    return;
  }

  const targets = termFilter ? terms.filter((t) => t.termCode === termFilter) : terms;
  if (targets.length === 0) {
    console.error(`No matching term. Available: ${terms.map((t) => t.termCode).join(", ")}`);
    process.exit(1);
  }

  const outDir = path.join(process.cwd(), "data", STATE, "courses", COLLEGE_SLUG);
  fs.mkdirSync(outDir, { recursive: true });

  let grandTotal = 0;
  for (const target of targets) {
    console.log(`\n  Scraping ${target.label} (${target.termCode})...`);
    const courses = await fetchAllPagesForTerm(target.guid);
    console.log(`    ${courses.length} courses fetched`);
    const sections = courses.flatMap((c) => convertCourse(c, target.termCode));
    console.log(`    → ${sections.length} sections`);
    if (sections.length === 0) continue;
    const outFile = path.join(outDir, `${target.termCode}.json`);
    fs.writeFileSync(outFile, JSON.stringify(sections, null, 2));
    console.log(`    written to ${outFile}`);
    grandTotal += sections.length;
  }

  console.log(`\n=== Summary ===\n  Total: ${grandTotal} sections across ${targets.length} terms.`);

  if (!noImport && grandTotal > 0) {
    const { importCoursesToSupabase } = await import("../lib/supabase-import");
    await importCoursesToSupabase(STATE);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

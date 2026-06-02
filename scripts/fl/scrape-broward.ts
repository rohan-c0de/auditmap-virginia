/**
 * Broward College — FCCSC servlet scrape
 *
 * Broward's public class schedule lives at
 *   https://mybc.broward.edu/FCCSC/registration/classschedules.jsp
 *
 * A GET to the JSP yields the search form plus three cookies — JSESSIONID
 * and two F5/Volterra WAF tokens (TS0176fb71 + TS01dc4fc6). The actual
 * results come from a POST to
 *   /FCCSC/servlet/registration.IAS012N2s?from=registration/coursearch.jsp
 * which 302s to ...IAS012N3s (must follow). One POST returns the
 * sections for ONE subject prefix; there's no "all subjects" query, so
 * we iterate over the 130-ish coursePrefix values pulled from the
 * search-page <select>.
 *
 * Each result row is exactly 20 <td> cells:
 *   TD0 Add-to-Cart    TD1 CRN+link      TD2 Course ID
 *   TD3 Campus         TD4 Bldg/Room     TD5 Session #
 *   TD6 Start (MM/DD/YY)  TD7 End         TD8 Time start
 *   TD9 "-"            TD10 Time end     TD11–17 = U M T W R F S
 *   TD18 Seats Left    TD19 Instructor link
 *
 * Online sentinel: TD4 = "stars-slash-stars" (literal `***` and three
 * more stars separated by a forward slash) OR TD8 = "stars" OR TDs
 * 11-17 spelling "ONLINE" letter-by-letter. Day letters M T W R F S U
 * (R=Thu, U=Sun).
 *
 * Usage:
 *   npx tsx scripts/fl/scrape-broward.ts
 *   npx tsx scripts/fl/scrape-broward.ts --no-import
 *   npx tsx scripts/fl/scrape-broward.ts --list-terms
 *   npx tsx scripts/fl/scrape-broward.ts --term 20263 --prefix ENC
 */

import * as fs from "fs";
import * as path from "path";

const STATE = "fl";
const COLLEGE_SLUG = "broward";
const BASE = "https://mybc.broward.edu";
const SEARCH_URL = `${BASE}/FCCSC/registration/classschedules.jsp`;
const RESULTS_URL = `${BASE}/FCCSC/servlet/registration.IAS012N2s?from=registration/coursearch.jsp`;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
const POST_DELAY_MS = 400;

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

interface Session {
  cookie: string;
  terms: TermOption[];
  prefixes: string[];
}

function termCodeToStandard(code: string, label: string): string | null {
  // Broward uses YYYY + single-digit suffix:
  //   1=Spring, 2=Summer, 3=Summer-2 (the "20263" we observed), 4=Fall
  // Label is authoritative — derive season from there.
  const yearMatch = code.match(/^(\d{4})\d/);
  if (!yearMatch) return null;
  const year = yearMatch[1];
  const l = label.toLowerCase();
  if (l.includes("fall")) return `${year}FA`;
  if (l.includes("summer")) return `${year}SU`;
  if (l.includes("spring")) return `${year}SP`;
  if (l.includes("winter")) return `${year}WI`;
  return null;
}

async function bootstrap(): Promise<Session> {
  // GET the JSP, capture cookies + form options.
  const r = await fetch(SEARCH_URL, { headers: { "User-Agent": UA } });
  const html = await r.text();
  const setCookies = r.headers.getSetCookie?.() ?? [];
  const cookie = setCookies.map((c) => c.split(";")[0]).join("; ");
  if (!cookie) throw new Error("No cookies received from bootstrap GET");

  // The form has three <select name="term"> blocks (Subject search,
  // Course ID search, and the redirect placeholder). The most
  // informative is the Subject-of-interest variant — its <option>
  // labels include the year+date range ("Summer 2026 : 05/12/26 to
  // 08/04/26"). Scan ALL of them, dedupe by value, and prefer the
  // label that looks like "{Season} {Year}".
  const terms: TermOption[] = [];
  const seenTerms = new Map<string, TermOption>();
  const selectRegex = /<select[^>]+name="term"[^>]*>([\s\S]*?)<\/select>/gi;
  let selectMatch: RegExpExecArray | null;
  while ((selectMatch = selectRegex.exec(html)) !== null) {
    const region = selectMatch[1];
    const optRegex = /<option[^>]*value="([^"]+)"[^>]*>\s*([\s\S]*?)\s*<\/option>/gi;
    let m: RegExpExecArray | null;
    while ((m = optRegex.exec(region)) !== null) {
      const v = m[1].trim();
      if (!v || v === "0") continue;
      const label = m[2].replace(/\s+/g, " ").trim();
      const existing = seenTerms.get(v);
      // Prefer a label that includes a 4-digit year and a season word
      // — that's the Subject-of-interest variant.
      const isRich =
        /20\d{2}/.test(label) && /(spring|summer|fall|winter)/i.test(label);
      if (!existing || (isRich && !/20\d{2}/.test(existing.label))) {
        seenTerms.set(v, { value: v, label });
      }
    }
  }
  for (const t of seenTerms.values()) terms.push(t);

  // Extract coursePrefix <option>s (skip the empty "any subject" entry).
  const pfxSelectStart = html.indexOf('name="coursePrefix"');
  const pfxSelectEnd = html.indexOf("</select>", pfxSelectStart);
  const pfxRegion = html.substring(pfxSelectStart, pfxSelectEnd);
  const prefixes: string[] = [];
  const pfxRegex = /<option[^>]*value="([^"]+)"[^>]*>/gi;
  let pfxMatch: RegExpExecArray | null;
  while ((pfxMatch = pfxRegex.exec(pfxRegion)) !== null) {
    const v = pfxMatch[1].trim();
    if (!v || v.toLowerCase() === "filter01") continue;
    prefixes.push(v);
  }

  return { cookie, terms, prefixes };
}

async function fetchSubjectResults(
  session: Session,
  termCode: string,
  prefix: string,
): Promise<string> {
  const body = new URLSearchParams({
    delivery: "**",
    campus: "ANY",
    coursePrefix: prefix,
    term: termCode,
  });
  const r = await fetch(RESULTS_URL, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: session.cookie,
      Referer: SEARCH_URL,
    },
    body,
    redirect: "follow",
  });
  if (!r.ok) throw new Error(`POST failed for ${prefix} ${termCode}: HTTP ${r.status}`);
  return r.text();
}

function stripTags(s: string): string {
  return s
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCourseId(raw: string): { prefix: string; number: string } | null {
  // ENC0017C / ENC1101 — 3-4 letter prefix + 4 digit number + optional letter
  const m = raw.match(/^([A-Z]{3,4})(\d{4})[A-Z]?$/);
  if (!m) return null;
  return { prefix: m[1], number: m[2] };
}

function parseDate2Year(raw: string): string {
  // "05/12/26" → "2026-05-12"
  const m = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{2})/);
  if (!m) return "";
  const yy = parseInt(m[3], 10);
  const yyyy = yy >= 50 ? 1900 + yy : 2000 + yy;
  return `${yyyy}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function parseSeats(raw: string): number | null {
  const m = raw.match(/^\d+$/);
  return m ? parseInt(raw, 10) : null;
}

function encodeDays(td11to17: string[]): string {
  // [U M T W R F S] → "Su M Tu W Th F Sa" (only present-day-letters)
  // Online rows spell "ONLINE" — detect and return "" for that case.
  const joined = td11to17.map((t) => stripTags(t)).join("");
  if (joined.toUpperCase() === "ONLINE") return "";
  const dayMap: Record<string, string> = {
    U: "Su", M: "M", T: "Tu", W: "W", R: "Th", F: "F", S: "Sa",
  };
  const positions = ["U", "M", "T", "W", "R", "F", "S"];
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const cell = stripTags(td11to17[i] ?? "");
    if (cell === positions[i]) out.push(dayMap[cell]);
  }
  return out.join(" ");
}

function detectMode(
  campus: string,
  bldgRoom: string,
  timeStart: string,
  days: string,
): CourseSection["mode"] {
  const c = campus.toLowerCase();
  if (c.includes("online") || bldgRoom === "***/***" || timeStart === "***" || days === "") return "online";
  return "in-person";
}

function parseRow(rowHtml: string, term: string): CourseSection | null {
  // Pull raw <td>s — note Broward uses commented-out duplicate <a> tags
  // we strip via stripTags's comment removal.
  const tds = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
  if (tds.length < 20) return null;

  // TD1 contains "<CRN> <a href='...?RefNum=XXXX...'>...</a>" — the
  // RefNum query param is the safer source for the CRN.
  const refNumMatch = tds[1].match(/RefNum=(\d+)/);
  const tdCrnText = stripTags(tds[1]);
  const crn = refNumMatch ? refNumMatch[1] : (tdCrnText.match(/\d{4,7}/)?.[0] ?? "");
  if (!/^\d{4,7}$/.test(crn)) return null;

  const courseId = stripTags(tds[2]);
  const code = parseCourseId(courseId);
  if (!code) return null;

  const campus = stripTags(tds[3]);
  const bldgRoom = stripTags(tds[4]);
  const startDate = parseDate2Year(stripTags(tds[6]));
  const timeStart = stripTags(tds[8]);
  const timeEnd = stripTags(tds[10]);
  const days = encodeDays(tds.slice(11, 18));
  const seatsLeft = parseSeats(stripTags(tds[18]));
  const instructor = stripTags(tds[19]) || null;

  const mode = detectMode(campus, bldgRoom, timeStart, days);
  const isOnlineSentinel = timeStart === "***";

  return {
    college_code: COLLEGE_SLUG,
    term,
    course_prefix: code.prefix,
    course_number: code.number,
    course_title: "", // Not present in the row — would need separate detail fetch.
    credits: 0,
    crn,
    days,
    start_time: isOnlineSentinel ? "" : timeStart.toLowerCase(),
    end_time: isOnlineSentinel ? "" : timeEnd.toLowerCase(),
    start_date: startDate,
    location: bldgRoom === "***/***" ? "" : bldgRoom,
    campus,
    mode,
    instructor: instructor && instructor !== "" ? instructor : null,
    seats_open: seatsLeft,
    seats_total: null,
    prerequisite_text: null,
    prerequisite_courses: [],
  };
}

function parseResults(html: string, term: string): CourseSection[] {
  const out: CourseSection[] = [];
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  for (const r of rows) {
    const sec = parseRow(r[1], term);
    if (sec) out.push(sec);
  }
  return out;
}

function pickTargetTerms(terms: TermOption[]): TermOption[] {
  // Broward currently exposes only the active term. Keep terms whose
  // label year is the current calendar year or later (defensive against
  // the form sometimes showing past terms during a transition).
  const currentYear = new Date().getFullYear();
  return terms.filter((t) => {
    const m = t.label.match(/20\d{2}/);
    if (!m) return false;
    return parseInt(m[0], 10) >= currentYear;
  });
}

async function main() {
  const args = process.argv.slice(2);
  const noImport = args.includes("--no-import");
  const listTerms = args.includes("--list-terms");
  const termArgIdx = args.indexOf("--term");
  const termFilter = termArgIdx >= 0 ? args[termArgIdx + 1] : undefined;
  const prefixArgIdx = args.indexOf("--prefix");
  const prefixFilter = prefixArgIdx >= 0 ? args[prefixArgIdx + 1] : undefined;

  console.log("=== Broward College scraper ===");
  console.log(`  Endpoint: ${SEARCH_URL}`);

  const session = await bootstrap();
  console.log(
    `  Bootstrap OK (cookie ${session.cookie.length} chars, ${session.terms.length} terms, ${session.prefixes.length} prefixes)`,
  );

  if (listTerms) {
    for (const t of session.terms) console.log(`  ${t.value}\t${t.label}`);
    return;
  }

  const targets = termFilter
    ? session.terms.filter((t) => t.value === termFilter)
    : pickTargetTerms(session.terms);

  if (targets.length === 0) {
    console.error(
      `No matching terms. Available: ${session.terms.map((t) => t.value).join(", ")}`,
    );
    process.exit(1);
  }

  const prefixes = prefixFilter ? [prefixFilter] : session.prefixes;
  console.log(`  Targeting ${targets.length} term(s) × ${prefixes.length} prefix(es)`);

  const outDir = path.join(process.cwd(), "data", STATE, "courses", COLLEGE_SLUG);
  fs.mkdirSync(outDir, { recursive: true });

  let grandTotal = 0;
  for (const t of targets) {
    const term = termCodeToStandard(t.value, t.label);
    if (!term) {
      console.log(`  skip ${t.value} (${t.label}) — can't derive canonical term code`);
      continue;
    }
    console.log(`\n  Scraping ${t.label} (${t.value} → ${term})...`);
    const seen = new Set<string>();
    const accum: CourseSection[] = [];
    let prefixIdx = 0;
    for (const pfx of prefixes) {
      prefixIdx++;
      try {
        const html = await fetchSubjectResults(session, t.value, pfx);
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
      } catch (e) {
        console.error(`    [${prefixIdx}/${prefixes.length}] ${pfx} FAILED: ${e instanceof Error ? e.message : e}`);
      }
      await new Promise((r) => setTimeout(r, POST_DELAY_MS));
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

  // The class-schedule listing carries no course title (rows are written with
  // course_title ""), so enrich from broward's CourseLeaf catalog and drop the
  // untitleable vocational tail BEFORE import — otherwise every (college, term)
  // aborts on the title-required schema check. See enrich-courseleaf-titles.ts.
  if (grandTotal > 0) {
    const { enrichCourseLeafTitles } = await import("./enrich-courseleaf-titles");
    await enrichCourseLeafTitles({
      college: "broward",
      catalogBase: "https://catalog.broward.edu",
      dropUntitled: true,
    });
  }

  if (!noImport && grandTotal > 0) {
    const { importCoursesToSupabase } = await import("../lib/supabase-import");
    await importCoursesToSupabase(STATE);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

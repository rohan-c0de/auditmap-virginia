/**
 * scrape-transfer-trex.ts
 *
 * Scrapes CUNY Transfer Explorer (T-Rex) at https://explorer.cuny.edu to
 * extract every course-to-course transfer equivalency from the 7 CUNY
 * community colleges to all CUNY senior colleges (and a few specialized
 * post-baccalaureate institutions).
 *
 * T-Rex publishes ~1.6 million course equivalencies for the CUNY system,
 * updated daily. This scraper hits the same AJAX endpoints the public
 * search form uses, so no Playwright is required — raw fetch + cheerio
 * is sufficient.
 *
 * Flow per CC:
 *   1. POST /ajax/college_disciplines       → list of subjects (with TOTAL course counts)
 *   2. For each subject:
 *      POST /ajax/college_courses_by_subjects → list of courses (COURSEID, OFFERNBR, CATALOG_NBR)
 *   3. For each course:
 *      GET  /course-transfer/{COURSEID}/{OFFERNBR} → HTML with one accordion card
 *           per destination institution (parsed with cheerio)
 *
 * Destinations include:
 *   - 11 CUNY senior colleges (Baruch, Brooklyn, City, Hunter, John Jay,
 *     Lehman, Medgar Evers, City Tech, Queens, CSI, York)
 *   - The other 6 CCs (filtered out — we want CC → 4yr only)
 *   - Specialized institutions (Graduate Center, SPS, SLU, SPH, Macaulay,
 *     CUNY Law) — kept since they're real transfer destinations
 *
 * Output: data/ny/transfer-equiv.json (deduped by (cc_prefix, cc_number,
 * university, univ_course)) + automatic Supabase import.
 *
 * Usage:
 *   npx tsx scripts/ny/scrape-transfer-trex.ts
 *   npx tsx scripts/ny/scrape-transfer-trex.ts --cc bmcc
 *   npx tsx scripts/ny/scrape-transfer-trex.ts --cc bmcc --subject ENG
 *   npx tsx scripts/ny/scrape-transfer-trex.ts --no-import     # write JSON only
 */

import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";
import { importTransfersToSupabase } from "../lib/supabase-import";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE = "https://explorer.cuny.edu";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Concurrency: 6 in-flight result fetches per CC. T-Rex sits behind a CDN
// and handles modest parallel load comfortably. Per-worker delay of 100ms
// caps the steady-state rate at ~10 req/s across all workers — well below
// any rate-limiting signal we've observed in smoke tests.
const CONCURRENCY = 6;
const DELAY_MS = 100;

// 7 CUNY community colleges keyed by our slug → T-Rex college ID + display name.
// IDs come from the <select id="college"> dropdown on /course-transfer.
// NOTE: Guttman CC's T-Rex code is NCC01 (legacy "New Community College"),
// not GUT01 — verified against the live page.
const SOURCE_CCS: Record<string, { id: string; name: string }> = {
  bmcc: { id: "BMC01", name: "Borough of Manhattan CC" },
  "bronx-cc": { id: "BCC01", name: "Bronx CC" },
  "guttman-cc": { id: "NCC01", name: "Guttman CC" },
  "hostos-cc": { id: "HOS01", name: "Hostos CC" },
  "kingsborough-cc": { id: "KCC01", name: "Kingsborough CC" },
  "laguardia-cc": { id: "LAG01", name: "LaGuardia CC" },
  "queensborough-cc": { id: "QCC01", name: "Queensborough CC" },
};

// Map T-Rex destination college name → our slug + display name. We key by
// name (not ID) because destination cards in result HTML render the
// human-readable name, not the institution code. Names must match exactly
// what the page emits in the <span> after the <strong>course code</strong>.
//
// CC destinations are listed but flagged isCC:true so the scraper filters
// them out (we only want CC → senior/post-bac mappings).
const DEST_COLLEGES: Record<string, { slug: string; name: string; isCC: boolean }> = {
  // 11 senior colleges
  "Baruch College": { slug: "baruch", name: "Baruch College", isCC: false },
  "Brooklyn College": { slug: "brooklyn", name: "Brooklyn College", isCC: false },
  "City College": { slug: "ccny", name: "City College of New York", isCC: false },
  "College of Staten Island": { slug: "csi", name: "College of Staten Island", isCC: false },
  "Hunter College": { slug: "hunter", name: "Hunter College", isCC: false },
  "John Jay College": { slug: "john-jay", name: "John Jay College of Criminal Justice", isCC: false },
  "Lehman College": { slug: "lehman", name: "Lehman College", isCC: false },
  "Medgar Evers College": { slug: "medgar-evers", name: "Medgar Evers College", isCC: false },
  "NYC College of Technology": { slug: "city-tech", name: "NYC College of Technology", isCC: false },
  "Queens College": { slug: "queens", name: "Queens College", isCC: false },
  "York College": { slug: "york", name: "York College", isCC: false },
  // Specialized / post-bac (real transfer destinations, kept)
  "Graduate Center": { slug: "grad-center", name: "CUNY Graduate Center", isCC: false },
  "School of Professional Studies": { slug: "cuny-sps", name: "CUNY School of Professional Studies", isCC: false },
  "School of Labor & Urban Studies": { slug: "cuny-slu", name: "CUNY School of Labor & Urban Studies", isCC: false },
  "School of Public Health": { slug: "cuny-sph", name: "CUNY School of Public Health", isCC: false },
  "School of Medicine": { slug: "cuny-som", name: "CUNY School of Medicine", isCC: false },
  "School of Law": { slug: "cuny-law", name: "CUNY School of Law", isCC: false },
  "Macaulay Honors College": { slug: "macaulay", name: "Macaulay Honors College", isCC: false },
  // 7 community colleges (filtered out)
  "Borough of Manhattan CC": { slug: "bmcc", name: "Borough of Manhattan CC", isCC: true },
  "Bronx CC": { slug: "bronx-cc", name: "Bronx CC", isCC: true },
  "Guttman CC": { slug: "guttman-cc", name: "Guttman CC", isCC: true },
  "Hostos CC": { slug: "hostos-cc", name: "Hostos CC", isCC: true },
  "Kingsborough CC": { slug: "kingsborough-cc", name: "Kingsborough CC", isCC: true },
  "LaGuardia CC": { slug: "laguardia-cc", name: "LaGuardia CC", isCC: true },
  "Queensborough CC": { slug: "queensborough-cc", name: "Queensborough CC", isCC: true },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TransferMapping {
  cc_prefix: string;
  cc_number: string;
  cc_course: string;
  cc_title: string;
  cc_credits: string;
  university: string;
  university_name: string;
  univ_course: string;
  univ_title: string;
  univ_credits: string;
  notes: string;
  no_credit: boolean;
  is_elective: boolean;
}

interface DisciplineRow {
  SUBJECT: string;
  DESCR: string;
  TOTAL: string;
}

interface CourseRow {
  COURSEID: string;
  OFFERNBR: string;
  SUBJECT: string;
  CATALOG_NBR: string;
  TITLE: string;
}

interface ParsedCard {
  courseCode: string;
  title: string;
  collegeName: string;
  credits: string;
  message: string;
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

let cookieJar = "";

async function seedCookies(): Promise<void> {
  const res = await fetch(`${BASE}/course-transfer`, { headers: { "User-Agent": UA, Accept: "text/html" } });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  cookieJar = setCookie.map((c) => c.split(";")[0]).join("; ");
  if (!cookieJar) {
    throw new Error("T-Rex did not return a session cookie — bailing");
  }
}

function ajaxHeaders(): Record<string, string> {
  return {
    "User-Agent": UA,
    Accept: "application/json, text/javascript, */*; q=0.01",
    "X-Requested-With": "XMLHttpRequest",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    Cookie: cookieJar,
    Referer: `${BASE}/course-transfer`,
  };
}

function htmlHeaders(): Record<string, string> {
  return {
    "User-Agent": UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    Cookie: cookieJar,
    Referer: `${BASE}/course-transfer`,
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Retry wrapper for fetch — exponential backoff on 5xx / network errors.
async function retryFetch(url: string, init: RequestInit, label: string, attempts = 3): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      if (res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
      } else {
        return res; // 4xx — don't retry
      }
    } catch (e) {
      lastErr = e;
    }
    await sleep(500 * Math.pow(2, i));
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastErr}`);
}

async function fetchDisciplines(collegeId: string): Promise<DisciplineRow[]> {
  const res = await retryFetch(
    `${BASE}/ajax/college_disciplines`,
    { method: "POST", headers: ajaxHeaders(), body: `college=${encodeURIComponent(collegeId)}` },
    `disciplines(${collegeId})`,
  );
  const json = (await res.json()) as { data: DisciplineRow[] };
  return json.data || [];
}

async function fetchCoursesForSubject(collegeId: string, subject: string): Promise<CourseRow[]> {
  const body =
    `college=${encodeURIComponent(collegeId)}` +
    `&subjects%5B%5D=${encodeURIComponent(subject)}` +
    `&status=active&recentlyoffered=1`;
  const res = await retryFetch(
    `${BASE}/ajax/college_courses_by_subjects`,
    { method: "POST", headers: ajaxHeaders(), body },
    `courses(${collegeId}/${subject})`,
  );
  const json = (await res.json()) as { data: CourseRow[] };
  return json.data || [];
}

async function fetchResultHtml(courseId: string, offerNbr: string): Promise<string> {
  const res = await retryFetch(
    `${BASE}/course-transfer/${courseId}/${offerNbr}`,
    { headers: htmlHeaders() },
    `result(${courseId}/${offerNbr})`,
  );
  return res.text();
}

// ---------------------------------------------------------------------------
// HTML parsing
// ---------------------------------------------------------------------------

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function parseResultPage(html: string): ParsedCard[] {
  const $ = cheerio.load(html);
  const dests: ParsedCard[] = [];
  // Each <div class="tab-pane"> represents one transfer "rule" (most courses
  // have exactly one). Within each tab pane, the structure is:
  //   <h2>If this course is taken…</h2>
  //   <div class="card">  -- source course (skip)
  //   <h2>… This is the credit that will be given upon transfer</h2>
  //   <div class="card">  -- destination 1
  //   <div class="card">  -- destination 2
  //   ...
  $("#nav-rules .tab-pane").each((_, tab) => {
    let pastDivider = false;
    $(tab)
      .children()
      .each((_, el) => {
        const $el = $(el);
        // The cheerio v1 type definitions don't re-export the DOM Element
        // type cleanly, so use a structural cast to read tagName.
        const tag = ((el as { tagName?: string }).tagName || "").toLowerCase();
        if (tag === "h2") {
          if ($el.text().includes("credit that will be given")) pastDivider = true;
          return;
        }
        if (!pastDivider) return; // skip the source card
        if (!$el.hasClass("card")) return;

        const heading = $el.find("h3.accordion-heading .g-line-height-1_2").first();
        const courseCode = heading.find("strong").first().text().trim();
        const headingHtml = heading.html() || "";
        const titleMatch = headingHtml.match(/<\/strong>\s*:\s*([^<]+)/);
        const title = titleMatch ? decodeHtmlEntities(titleMatch[1].trim()) : "";
        const collegeName = heading.find("span").first().text().trim();

        const block = $el.find(".card-block").first();
        let credits = "";
        block.find(".small").each((_, sm) => {
          const t = $(sm).text();
          if (t.startsWith("Credits:")) credits = t.replace("Credits:", "").trim();
        });
        const message = block.find("div[title]").first().text().trim();

        dests.push({ courseCode, title, collegeName, credits, message });
      });
  });
  return dests;
}

// ---------------------------------------------------------------------------
// Mapping a parsed card → TransferMapping (or null if it should be dropped)
// ---------------------------------------------------------------------------

// Strip course code into prefix + number. CUNY senior colleges use varied
// formats: "ENG 2100", "ENGL. 1010", "ENGL 11000", "MATH 499", "ENG 1101".
function splitCourseCode(code: string): { prefix: string; number: string } {
  const cleaned = code.replace(/\./g, "").trim();
  const m = cleaned.match(/^([A-Z]{2,6})\s*([0-9A-Z]+)$/);
  if (m) return { prefix: m[1].toUpperCase(), number: m[2] };
  // Fallback: split on first digit
  const m2 = cleaned.match(/^([A-Z]+)\s*(.+)$/);
  if (m2) return { prefix: m2[1].toUpperCase(), number: m2[2].trim() };
  return { prefix: "", number: cleaned };
}

function classifyDestination(card: ParsedCard): { noCredit: boolean; isElective: boolean } {
  const codeUp = card.courseCode.toUpperCase();
  const titleUp = card.title.toUpperCase();
  const msgUp = card.message.toUpperCase();

  // No credit signals
  const noCredit =
    codeUp.includes("CBA CREDIT") ||                      // "CBA Credit CC - Liberal Arts"
    codeUp.startsWith("BLA ") ||                          // "BLA" = Blanket Article (no credit)
    codeUp.startsWith("BL ") ||
    titleUp.includes("NO CREDIT") ||
    titleUp.includes("NOT EQUIVALENT") ||
    msgUp.includes("NO CREDIT") ||
    msgUp.includes("NON-LIBERAL ARTS") && card.credits === "0";

  // Elective signals (ignore if already flagged no_credit)
  const isElective =
    !noCredit &&
    (titleUp.includes("ELECTIVE") ||
      codeUp.includes("ELEC") ||
      /[0-9]X{2,}/.test(codeUp) ||                        // "ENG 4XX"
      /\b499\b|\b4990\b|\b4999\b/.test(codeUp) ||         // sentinel "elective" numbers
      titleUp.includes("LOWER LEVEL") ||
      titleUp.includes("UPPER LEVEL") ||
      titleUp.includes("FREE ELECTIVE"));

  return { noCredit, isElective };
}

function cardToMapping(
  source: { prefix: string; number: string; title: string; credits: string },
  card: ParsedCard,
): TransferMapping | null {
  // Drop the unevaluated placeholder rows
  if (/has not been evaluated/i.test(card.courseCode)) return null;

  const dest = DEST_COLLEGES[card.collegeName];
  if (!dest) return null;        // unknown college name (shouldn't happen)
  if (dest.isCC) return null;    // CC→CC mapping — drop, not the data we want

  const { prefix, number } = splitCourseCode(card.courseCode);
  const { noCredit, isElective } = classifyDestination(card);

  return {
    cc_prefix: source.prefix,
    cc_number: source.number,
    cc_course: `${source.prefix} ${source.number}`.trim(),
    cc_title: source.title,
    cc_credits: source.credits,
    university: dest.slug,
    university_name: dest.name,
    univ_course: prefix && number ? `${prefix} ${number}` : card.courseCode,
    univ_title: card.title,
    univ_credits: card.credits,
    notes: card.message,
    no_credit: noCredit,
    is_elective: isElective,
  };
}

// ---------------------------------------------------------------------------
// Concurrency primitive: bounded parallel map
// ---------------------------------------------------------------------------

async function pmap<T, R>(items: T[], n: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      try {
        results[idx] = await fn(items[idx], idx);
      } catch (e) {
        // Caller's fn should not throw; we wrap with our own retry. If it
        // does, log and store undefined.
        console.error(`  pmap[${idx}] error: ${e}`);
        results[idx] = undefined as unknown as R;
      }
      if (DELAY_MS > 0) await sleep(DELAY_MS);
    }
  }
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

// ---------------------------------------------------------------------------
// Per-CC scrape
// ---------------------------------------------------------------------------

async function scrapeCC(
  ccSlug: string,
  ccInfo: { id: string; name: string },
  subjectFilter: string | null,
): Promise<TransferMapping[]> {
  console.log(`\n=== ${ccInfo.name} (${ccInfo.id}) ===`);
  const disciplines = await fetchDisciplines(ccInfo.id);
  console.log(`  ${disciplines.length} disciplines from /ajax/college_disciplines`);

  // Filter to (a) those with TOTAL > 0 (some have TOTAL "0" meaning no
  // courses) and (b) optionally a single --subject if requested.
  const subjects = disciplines
    .filter((d) => Number(d.TOTAL) > 0)
    .filter((d) => !subjectFilter || d.SUBJECT === subjectFilter)
    .map((d) => d.SUBJECT);
  console.log(`  ${subjects.length} subjects with active courses`);

  // Step 1: gather every recently-offered course across all subjects.
  // Sequential at the discipline level (small N), parallel at the course level.
  const allCourses: Array<{ subject: string; row: CourseRow }> = [];
  for (const subject of subjects) {
    try {
      const courses = await fetchCoursesForSubject(ccInfo.id, subject);
      for (const c of courses) allCourses.push({ subject, row: c });
      await sleep(100);
    } catch (e) {
      console.error(`  WARN: failed to fetch courses for ${subject}: ${e}`);
    }
  }
  console.log(`  ${allCourses.length} courses to query`);

  if (allCourses.length === 0) return [];

  // Step 2: for each course, GET the result page and parse destinations.
  const mappings: TransferMapping[] = [];
  let queried = 0;
  let withMappings = 0;

  await pmap(allCourses, CONCURRENCY, async ({ row }, idx) => {
    let html: string;
    try {
      html = await fetchResultHtml(row.COURSEID, row.OFFERNBR);
    } catch (e) {
      console.error(`  WARN: failed to fetch result for ${row.SUBJECT} ${row.CATALOG_NBR}: ${e}`);
      return;
    }
    const dests = parseResultPage(html);

    const sourceInfo = {
      prefix: row.SUBJECT.toUpperCase(),
      number: row.CATALOG_NBR,
      title: row.TITLE,
      credits: "", // T-Rex doesn't return credits in the course list — could fetch
                    // but it's expensive; leave blank and let UI fall back.
    };

    let kept = 0;
    for (const card of dests) {
      const m = cardToMapping(sourceInfo, card);
      if (m) {
        mappings.push(m);
        kept++;
      }
    }
    queried++;
    if (kept > 0) withMappings++;

    if ((idx + 1) % 100 === 0 || idx + 1 === allCourses.length) {
      process.stdout.write(
        `\r  progress: ${queried}/${allCourses.length} courses, ${mappings.length} mappings, ${withMappings} courses with data`,
      );
    }
  });

  process.stdout.write("\n");
  console.log(`  ${ccSlug}: ${mappings.length} mappings (${withMappings}/${allCourses.length} courses had transfer data)`);
  return mappings;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const ccFlag = args.indexOf("--cc");
  const subjFlag = args.indexOf("--subject");
  const noImport = args.includes("--no-import");

  let targetCCs: Array<[string, { id: string; name: string }]>;
  if (ccFlag >= 0) {
    const slug = args[ccFlag + 1];
    if (!SOURCE_CCS[slug]) {
      console.error(`Unknown CC: ${slug}. Available: ${Object.keys(SOURCE_CCS).join(", ")}`);
      process.exit(1);
    }
    targetCCs = [[slug, SOURCE_CCS[slug]]];
  } else {
    targetCCs = Object.entries(SOURCE_CCS);
  }
  const subjectFilter = subjFlag >= 0 ? args[subjFlag + 1] : null;

  console.log(`Scraping ${targetCCs.length} CC(s) from CUNY T-Rex`);
  console.log(`  concurrency=${CONCURRENCY}, delay=${DELAY_MS}ms`);
  if (subjectFilter) console.log(`  subject filter: ${subjectFilter}`);

  await seedCookies();
  console.log(`  session cookie acquired`);

  const allMappings: TransferMapping[] = [];
  const start = Date.now();
  for (const [slug, info] of targetCCs) {
    try {
      const m = await scrapeCC(slug, info, subjectFilter);
      allMappings.push(...m);
    } catch (e) {
      console.error(`\n  FATAL on ${slug}: ${e}`);
    }
  }
  const elapsed = Math.round((Date.now() - start) / 1000);
  console.log(`\nTotal raw mappings: ${allMappings.length} in ${elapsed}s`);

  // Dedupe by (cc_prefix, cc_number, university, univ_course). When we scrape
  // per-CC, two CCs sharing a course code that maps the same way will create
  // duplicates — drop them. When the same prefix+number maps differently,
  // both rows are kept (different univ_course).
  const seen = new Set<string>();
  const deduped: TransferMapping[] = [];
  for (const m of allMappings) {
    const key = `${m.cc_prefix}|${m.cc_number}|${m.university}|${m.univ_course}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(m);
  }
  console.log(`After dedup: ${deduped.length} unique mappings`);

  // Stats by university
  const byUni = new Map<string, number>();
  for (const m of deduped) byUni.set(m.university, (byUni.get(m.university) || 0) + 1);
  console.log("\nBy university:");
  for (const [u, c] of [...byUni.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${u.padEnd(20)} ${c}`);
  }

  // Stats by type
  const direct = deduped.filter((m) => !m.no_credit && !m.is_elective).length;
  const elect = deduped.filter((m) => !m.no_credit && m.is_elective).length;
  const noCr = deduped.filter((m) => m.no_credit).length;
  console.log("\nBy type:");
  console.log(`  direct:    ${direct}`);
  console.log(`  elective:  ${elect}`);
  console.log(`  no-credit: ${noCr}`);

  // Write output
  const outPath = path.join(process.cwd(), "data", "ny", "transfer-equiv.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(deduped, null, 2) + "\n");
  console.log(`\nWritten to ${outPath}`);

  // Auto-import to Supabase unless --no-import
  if (!noImport) {
    try {
      const inserted = await importTransfersToSupabase("ny");
      console.log(`Imported ${inserted} rows to Supabase`);
    } catch (e) {
      console.error(`Supabase import failed: ${e}`);
      process.exit(1);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

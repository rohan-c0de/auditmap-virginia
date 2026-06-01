/**
 * Jones College — bespoke PHP class-search scraper.
 *
 * Jones' public class schedule lives at class-search.jcjc.edu/results.php
 * (PHP/MySQL front-end over the PeopleSoft class table). No login required.
 *
 *   POST /results.php  form-encoded body:
 *     searchtype=DESCR | CLASS_NBR | JC_INSTR_NAME
 *     searchtype2=<term-code>   (e.g. 3265=Summer 2026, 3271=Fall 2026,
 *                                3273=Spring 2027 — codes are parsed
 *                                directly out of the form's <select>)
 *     searchtype3=%%            (% wildcards → all campuses)
 *     searchterm=               (empty → every course)
 *
 * The response is a single tablesorter table with columns:
 *   [Class #, Session, Class Type, Catalog #, Course (title), Days/Periods,
 *    Campus or Building, Teacher].
 *
 * `Days/Periods` here is JCJC's PeopleSoft period-block code (A/B/C/1/2/3/…)
 * NOT a days-of-week string — translating those to M/T/W/R/F would require
 * Jones' internal bell-schedule table which isn't published. We capture the
 * raw period code in `location` instead and leave `days`/`start_time`/
 * `end_time` empty rather than fabricate weekday data.
 *
 * Usage:
 *   npx tsx scripts/ms/scrape-jones.ts
 *   npx tsx scripts/ms/scrape-jones.ts --term 3271
 *   npx tsx scripts/ms/scrape-jones.ts --no-import
 */
import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";

const STATE = "ms";
const SLUG = "jones-county-junior-college";
const BASE = "https://class-search.jcjc.edu";
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
  mode: "in-person" | "online" | "hybrid";
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: null;
  prerequisite_courses: never[];
}

interface Term {
  code: string; // PeopleSoft strm, e.g. "3271"
  label: string; // "Fall 2026"
  termKey: string; // normalized "2026FA"
}

function normalizeTermLabel(label: string): string {
  const m = label.match(/(Summer|Spring|Fall|Winter)\s+(\d{4})/i);
  if (!m) return label;
  const season = m[1].toLowerCase();
  const year = m[2];
  const code = season === "fall" ? "FA" : season === "spring" ? "SP" : season === "summer" ? "SU" : "WI";
  return `${year}${code}`;
}

function parseCatalog(raw: string): { prefix: string; number: string } | null {
  // "ACC2213" → ACC + 2213; "ENG1113S" → ENG + 1113S; "BIO 1134" → BIO + 1134.
  const cleaned = (raw || "").trim().replace(/\s+/g, "");
  const m = cleaned.match(/^([A-Z]{2,5})\s*(\d+[A-Z]*)$/);
  return m ? { prefix: m[1], number: m[2] } : null;
}

function detectMode(rawPeriods: string, campus: string): "in-person" | "online" | "hybrid" {
  const blob = `${rawPeriods} ${campus}`.toLowerCase();
  if (/online|www|virtual/.test(blob)) return "online";
  if (/hybrid|hyb\b/.test(blob)) return "hybrid";
  return "in-person";
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

async function listTerms(): Promise<Term[]> {
  const res = await fetch(`${BASE}/`, { headers: { "User-Agent": UA } });
  const html = await res.text();
  const $ = cheerio.load(html);
  const terms: Term[] = [];
  $("select[name='searchtype2'] option").each((_, opt) => {
    const code = ($(opt).attr("value") || "").trim();
    const label = $(opt).text().trim();
    if (code && /^\d+$/.test(code) && label) {
      terms.push({ code, label, termKey: normalizeTermLabel(label) });
    }
  });
  return terms;
}

async function fetchTerm(term: Term): Promise<CourseSection[]> {
  const body = new URLSearchParams({
    searchtype: "DESCR",
    searchtype2: term.code,
    searchtype3: "%%",
    searchterm: "",
  });
  const res = await fetch(`${BASE}/results.php`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: BASE,
      Referer: `${BASE}/`,
    },
    body,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for term ${term.code}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  const sections: CourseSection[] = [];

  $("table#myTable tbody tr").each((_, tr) => {
    const cells = $(tr).find("td").toArray().map((td) => stripTags($(td).html() ?? $(td).text()));
    if (cells.length < 8) return;
    const [classNbr, , , catalog, title, periods, campus, teacher] = cells;
    const codeParts = parseCatalog(catalog);
    if (!codeParts) return;

    const mode = detectMode(periods, campus);
    sections.push({
      college_code: SLUG,
      term: term.termKey,
      course_prefix: codeParts.prefix,
      course_number: codeParts.number,
      course_title: title,
      credits: 0, // not exposed on the listing page
      crn: classNbr,
      days: "",
      start_time: "",
      end_time: "",
      start_date: "",
      // Stash the JCJC period code alongside the room/campus tag so it stays
      // visible to anyone reading the section — but don't pretend it's a
      // weekday pattern in `days`.
      location: mode === "online" ? "Online" : [campus, periods && periods !== "WWW" ? `Period ${periods}` : ""].filter(Boolean).join(" · "),
      campus: campus || "Jones College",
      mode,
      instructor: teacher && teacher !== "TBA" ? teacher : null,
      seats_open: null,
      seats_total: null,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  });
  return sections;
}

async function main() {
  const args = process.argv.slice(2);
  const termArgIdx = args.indexOf("--term");
  const termFilter = termArgIdx >= 0 ? args[termArgIdx + 1] : undefined;
  const noImport = args.includes("--no-import");

  console.log("Jones College — class-search.jcjc.edu scraper");
  const terms = await listTerms();
  if (terms.length === 0) {
    console.error("  No terms discovered; aborting.");
    process.exit(1);
  }
  const targets = termFilter ? terms.filter((t) => t.code === termFilter) : terms;
  console.log(`  Terms: ${targets.map((t) => t.label).join(", ")}`);

  const outDir = path.join(process.cwd(), "data", STATE, "courses", SLUG);
  fs.mkdirSync(outDir, { recursive: true });

  let grand = 0;
  for (const term of targets) {
    const sections = await fetchTerm(term);
    if (sections.length === 0) {
      console.log(`  ${term.termKey}: 0 sections`);
      continue;
    }
    const outPath = path.join(outDir, `${term.termKey}.json`);
    fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
    console.log(`  ${term.termKey}: ${sections.length} sections → ${path.relative(process.cwd(), outPath)}`);
    grand += sections.length;
  }
  console.log(`\n${SLUG}: ${grand} total sections`);
  if (noImport) console.log("   (--no-import)");
}

main().catch((err) => {
  console.error("Jones scraper failed:", err);
  process.exit(1);
});

/**
 * scrape-howard.ts — Howard College cluster scraper
 *
 * Howard College + Southwest College for the Deaf (SWCD) share a single
 * Concourse Syllabus Management instance (Intellidemia platform) at
 *   https://howardcollege.campusconcourse.com/
 *
 * Concourse is a syllabus-management system, not a registration SIS, but the
 * public search exposes enough per-section data — title, course code, term,
 * section code, instructor — to populate the project's standard schema. CRN,
 * seat counts, and meeting times are NOT in the public listing (CRN is
 * synthesized from Concourse's internal course_id).
 *
 * The form's `campus_id` filter splits the two slugs:
 *   SW             → southwest-college-for-the-deaf
 *   BS|LA|SA|ON|Other → howard-college (Big Spring, Lamesa, San Angelo, Online, Other)
 *
 * Terms in Concourse use long natural-language labels ("Fall 16 Week 2026",
 * "Summer 2nd 4 Week 2026") which we normalize into the project's standard
 * YYYYFA / YYYYSU / YYYYSP codes. Subterm variants collapse into one term
 * file with each section preserved (deduped by course+section+instructor).
 *
 * Pagination: page size = 50, navigated via ?offset=N where N is 0-indexed
 * page number. Stop when a page returns 0 results.
 *
 * Usage:
 *   npx tsx scripts/tx/scrape-howard.ts
 */

import * as https from "https";
import * as fs from "fs";
import * as path from "path";

const STATE = "tx";
const HOST = "howardcollege.campusconcourse.com";
const SEARCH_PATH = "/search";
const PAGE_SIZE = 50;
const MAX_PAGES = 50;

const HOWARD_SLUG = "howard-college";
const SWCD_SLUG = "southwest-college-for-the-deaf";

interface CampusEntry {
  id: string;
  slug: string;
  label: string;
}

const CAMPUSES: CampusEntry[] = [
  { id: "BS", slug: HOWARD_SLUG, label: "Big Spring" },
  { id: "LA", slug: HOWARD_SLUG, label: "Lamesa" },
  { id: "SA", slug: HOWARD_SLUG, label: "San Angelo" },
  { id: "ON", slug: HOWARD_SLUG, label: "Online" },
  { id: "HC", slug: HOWARD_SLUG, label: "Howard College (generic)" },
  { id: "Other", slug: HOWARD_SLUG, label: "Other" },
  { id: "SW", slug: SWCD_SLUG, label: "SWCD" },
];

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
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

function httpGet(urlPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: HOST,
        path: urlPath,
        method: "GET",
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(Buffer.concat(chunks).toString("utf-8"));
          } else {
            reject(new Error(`HTTP ${res.statusCode} for ${urlPath}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(30000, () => {
      req.destroy(new Error(`Timeout: ${urlPath}`));
    });
    req.end();
  });
}

function normalizeTerm(label: string): string | null {
  // "Fall 16 Week 2026" / "Fall 1st 8 Week 2026" / "Summer 2nd 4 Week 2026" / "Spring 2027"
  const m = label.match(/(Spring|Summer|Fall|Winter)\b.*?(\d{4})/);
  if (!m) return null;
  const seasonMap: Record<string, string> = {
    Spring: "SP",
    Summer: "SU",
    Fall: "FA",
    Winter: "WI",
  };
  const code = seasonMap[m[1]];
  if (!code) return null;
  return `${m[2]}${code}`;
}

function parseCourseCode(raw: string): { prefix: string; number: string } | null {
  // "RNSG-2307" or "ENGL 1301"
  const m = raw.trim().match(/^([A-Z]{2,5})[\s-]+(\d+[A-Z]?)$/);
  if (!m) return null;
  return { prefix: m[1], number: m[2] };
}

interface ConcourseResult {
  courseId: string;
  title: string;
  courseCodeRaw: string;
  termRaw: string;
  section: string;
  instructor: string;
}

function parseSearchPage(html: string): ConcourseResult[] {
  // Split on the result anchor; each chunk holds one section's data in order:
  //   <course_id>">Title</a>...</h3> ... CODE ... TERM ... Section X ... Instructor ... Modified DATE
  const splitter = /<h3[^>]*>\s*<a href="view_syllabus\?course_id=/g;
  const parts = html.split(splitter);
  const results: ConcourseResult[] = [];

  for (let i = 1; i < parts.length; i++) {
    const chunk = parts[i].slice(0, 2500);
    const idMatch = chunk.match(/^(\d+)">([^<]+)</);
    if (!idMatch) continue;
    const courseId = idMatch[1];
    const title = idMatch[2].trim();

    // Strip tags into pipe-delimited fields (matches the empirical column layout).
    const plain = chunk
      .replace(/<[^>]+>/g, "|")
      .replace(/\|+/g, "|")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const codeMatch = plain.match(/\b([A-Z]{2,5}[-\s]\d+[A-Z]?)\b/);
    const termMatch = plain.match(/((?:Spring|Summer|Fall|Winter)[A-Za-z0-9\s]*?\d{4})/);
    const sectionMatch = plain.match(/Section\s+([A-Z0-9]+)/);
    if (!codeMatch || !termMatch || !sectionMatch) continue;

    // Instructor sits a few pipe-fields after "Section XXX". Empty fields
    // appear as bare `|` between layout divs — walk through them and pick the
    // first non-empty field that isn't "Modified ...".
    let instructor = "";
    const afterIdx = plain.indexOf(sectionMatch[0]) + sectionMatch[0].length;
    const tail = plain.slice(afterIdx, afterIdx + 400);
    for (const field of tail.split("|").map((s) => s.trim()).filter(Boolean)) {
      if (/^Modified\b/i.test(field)) break;
      if (/^\d/.test(field)) break; // dates / numeric noise
      if (/[A-Za-z]/.test(field) && field.length >= 3 && field.length <= 80) {
        instructor = field;
        break;
      }
    }

    results.push({
      courseId,
      title,
      courseCodeRaw: codeMatch[1],
      termRaw: termMatch[1].trim(),
      section: sectionMatch[1],
      instructor,
    });
  }

  const seen = new Set<string>();
  return results.filter((r) => {
    if (seen.has(r.courseId)) return false;
    seen.add(r.courseId);
    return true;
  });
}

async function scrapeCampus(campus: CampusEntry): Promise<ConcourseResult[]> {
  const all: ConcourseResult[] = [];
  for (let offset = 0; offset < MAX_PAGES; offset++) {
    const url =
      `${SEARCH_PATH}?search_performed=1&timeframe=current_future&template=non&campus_id=${campus.id}&offset=${offset}`;
    let html: string;
    try {
      html = await httpGet(url);
    } catch (err) {
      console.warn(`  [${campus.id}] page ${offset} failed: ${(err as Error).message}`);
      break;
    }
    const page = parseSearchPage(html);
    if (page.length === 0) break;
    console.log(`  [${campus.id} ${campus.label}] page ${offset}: ${page.length} sections`);
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  return all;
}

function toCourseSection(r: ConcourseResult, slug: string, campusLabel: string): CourseSection | null {
  const term = normalizeTerm(r.termRaw);
  if (!term) return null;
  const cc = parseCourseCode(r.courseCodeRaw);
  if (!cc) return null;

  // Detect online mode from campus label or section code 'ON' prefix
  const isOnline = /online/i.test(campusLabel) || /^ON/i.test(r.section);

  return {
    college_code: slug,
    term,
    course_prefix: cc.prefix,
    course_number: cc.number,
    course_title: r.title,
    credits: 0,
    crn: r.courseId,
    days: "",
    start_time: "",
    end_time: "",
    start_date: "",
    location: campusLabel,
    campus: campusLabel,
    mode: isOnline ? "online" : "in-person",
    instructor: r.instructor || null,
    seats_open: null,
    seats_total: null,
    prerequisite_text: null,
    prerequisite_courses: [],
  };
}

async function main() {
  console.log("[howard] Concourse cluster scraper — Howard College + SWCD");
  const bySlugTerm: Record<string, Record<string, Map<string, CourseSection>>> = {};

  for (const campus of CAMPUSES) {
    console.log(`\n[howard] Campus ${campus.id} (${campus.label}) → ${campus.slug}`);
    const results = await scrapeCampus(campus);
    console.log(`  ${results.length} results for ${campus.id}`);

    for (const r of results) {
      const section = toCourseSection(r, campus.slug, campus.label);
      if (!section) continue;
      bySlugTerm[section.college_code] ??= {};
      bySlugTerm[section.college_code][section.term] ??= new Map();
      const dedupKey = `${section.course_prefix}|${section.course_number}|${section.crn}`;
      if (!bySlugTerm[section.college_code][section.term].has(dedupKey)) {
        bySlugTerm[section.college_code][section.term].set(dedupKey, section);
      }
    }
  }

  const outDir = path.join("data", STATE, "courses");
  for (const slug of Object.keys(bySlugTerm)) {
    const slugDir = path.join(outDir, slug);
    fs.mkdirSync(slugDir, { recursive: true });
    for (const term of Object.keys(bySlugTerm[slug])) {
      const sections = Array.from(bySlugTerm[slug][term].values()).sort((a, b) =>
        a.course_prefix === b.course_prefix
          ? a.course_number.localeCompare(b.course_number)
          : a.course_prefix.localeCompare(b.course_prefix),
      );
      const outPath = path.join(slugDir, `${term}.json`);
      fs.writeFileSync(outPath, JSON.stringify(sections, null, 2));
      console.log(`  wrote ${outPath} (${sections.length} sections)`);
    }
  }

  console.log("\n[howard] done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Minnesota State (MnSCU) — eservices.minnstate.edu HTML scraper
 *
 * All 26 MnSCU community/technical colleges share a centralized SIS
 * (Student e-Services, "ISRS"). Search results return a 15-column HTML
 * table identified by id="resultsTable". The "all subjects" view is
 * capped at 100 rows server-side, so iterate by subject per campus.
 *
 * Term code shape: 2 + FY-year + season, where season ∈ {1=Summer,
 * 3=Fall, 5=Spring}. Fiscal year rolls over July 1, so Summer 2026 =
 * 20271 (FY27 Summer), Fall 2026 = 20273, Spring 2027 = 20275.
 *
 * Tribal colleges (Leech Lake, Red Lake Nation) are NOT in this system.
 *
 * Usage:
 *   npx tsx scripts/mn/scrape-mn-eservices.ts
 *   npx tsx scripts/mn/scrape-mn-eservices.ts --college <slug>
 *   npx tsx scripts/mn/scrape-mn-eservices.ts --term 20273
 */
import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";

const STATE = "mn";
const BASE = "https://eservices.minnstate.edu";

// MnSCU campus IDs from the eservices college dropdown.
const CAMPUSES: { slug: string; campusid: string }[] = [
  { slug: "alexandria-technical-and-community-college", campusid: "203" },
  { slug: "anoka-technical-college", campusid: "202" },
  { slug: "anoka-ramsey-community-college", campusid: "152" },
  { slug: "central-lakes-college-brainerd", campusid: "301" },
  { slug: "century-college", campusid: "304" },
  { slug: "dakota-county-technical-college", campusid: "211" },
  { slug: "fond-du-lac-tribal-and-community-college", campusid: "163" },
  { slug: "hennepin-technical-college", campusid: "204" },
  { slug: "inver-hills-community-college", campusid: "157" },
  { slug: "lake-superior-college", campusid: "302" },
  { slug: "minneapolis-community-and-technical-college", campusid: "305" },
  { slug: "minnesota-north-college", campusid: "320" },
  { slug: "minnesota-state-college-southeast", campusid: "213" },
  { slug: "minnesota-state-community-and-technical-college", campusid: "142" },
  { slug: "minnesota-west-community-and-technical-college", campusid: "209" },
  { slug: "normandale-community-college", campusid: "156" },
  { slug: "north-hennepin-community-college", campusid: "153" },
  { slug: "northland-community-and-technical-college", campusid: "303" },
  { slug: "northwest-technical-college", campusid: "263" },
  { slug: "pine-technical-and-community-college", campusid: "205" },
  { slug: "ridgewater-college", campusid: "308" },
  { slug: "riverland-community-college", campusid: "307" },
  { slug: "rochester-community-and-technical-college", campusid: "306" },
  { slug: "saint-paul-college", campusid: "206" },
  { slug: "south-central-college", campusid: "309" },
  { slug: "st-cloud-technical-and-community-college", campusid: "208" },
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

const USER_AGENT = "Mozilla/5.0 (compatible; CommunityCollegePathBot/1.0)";

function ourTermCode(yrtr: string): string {
  // 20273 -> Fall 2026 -> "2026FA"
  const fyYear = parseInt(yrtr.slice(0, 4), 10);
  const season = yrtr.slice(4);
  if (season === "1") return `${fyYear - 1}SU`; // FY27 summer = 2026 summer
  if (season === "3") return `${fyYear - 1}FA`; // FY27 fall = 2026 fall
  if (season === "5") return `${fyYear}SP`; // FY27 spring = 2027 spring
  return yrtr;
}

function termStartDate(yrtr: string): string {
  const fyYear = parseInt(yrtr.slice(0, 4), 10);
  const season = yrtr.slice(4);
  if (season === "1") return `${fyYear - 1}-06-01`;
  if (season === "3") return `${fyYear - 1}-08-15`;
  if (season === "5") return `${fyYear}-01-08`;
  return "";
}

function decode(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function inferMode(delivery: string): "in-person" | "online" | "hybrid" {
  const d = delivery.toLowerCase();
  if (d.includes("hybrid") || d.includes("blended")) return "hybrid";
  if (d.includes("online") || d.includes("internet")) return "online";
  return "in-person";
}

function parseTimeRange(raw: string): { start: string; end: string } {
  const cleaned = decode(raw).replace(/–|—/g, "-");
  if (!cleaned || /^n\/?a$/i.test(cleaned) || /tbd|tba/i.test(cleaned)) {
    return { start: "", end: "" };
  }
  const m = cleaned.match(/(\d{1,2}:\d{2}\s*[ap]m)\s*-\s*(\d{1,2}:\d{2}\s*[ap]m)/i);
  if (!m) return { start: "", end: "" };
  return { start: m[1].toLowerCase().replace(/\s+/g, ""), end: m[2].toLowerCase().replace(/\s+/g, "") };
}

async function fetchWithRetry(url: string, attempts = 3): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw lastErr;
}

async function discoverSubjects(campusid: string, yrtr: string): Promise<string[]> {
  const url =
    `${BASE}/registration/search/advanced.html` +
    `?campusid=${campusid}&searchrcid=0${campusid}&searchcampusid=${campusid}&yrtr=${yrtr}`;
  const html = await fetchWithRetry(url);
  const $ = cheerio.load(html);
  const subjects: string[] = [];
  $('select[name="subject"] option').each((_, el) => {
    const v = $(el).attr("value");
    if (v && /^[A-Z]{2,5}$/.test(v)) subjects.push(v);
  });
  return subjects;
}

async function discoverTerms(campusid: string): Promise<string[]> {
  const url = `${BASE}/registration/search/advanced.html?campusid=${campusid}`;
  const html = await fetchWithRetry(url);
  const $ = cheerio.load(html);
  const terms: string[] = [];
  $('select[name="yrtr"] option').each((_, el) => {
    const v = $(el).attr("value");
    if (v && /^2\d{4}$/.test(v)) terms.push(v);
  });
  return terms;
}

async function scrapeCampusTerm(
  slug: string,
  campusid: string,
  yrtr: string,
  subjects: string[],
): Promise<CourseSection[]> {
  const term = ourTermCode(yrtr);
  const startDate = termStartDate(yrtr);
  const sections: CourseSection[] = [];
  let consecutiveErrors = 0;
  for (const subj of subjects) {
    const url =
      `${BASE}/registration/search/advancedSubmit.html` +
      `?campusid=${campusid}&searchrcid=0${campusid}&searchcampusid=${campusid}` +
      `&yrtr=${yrtr}&subject=${subj}`;
    let html: string;
    try {
      html = await fetchWithRetry(url);
      consecutiveErrors = 0;
    } catch (err) {
      consecutiveErrors++;
      if (consecutiveErrors >= 5) throw err;
      continue;
    }
    const $ = cheerio.load(html);
    $("#resultsTable tr").each((_, tr) => {
      const cells = $(tr).find("td");
      if (cells.length < 13) return;
      const courseid = decode($(cells[1]).text());
      const subject = decode($(cells[2]).text());
      const number = decode($(cells[3]).text());
      const sectionNum = decode($(cells[4]).text());
      const title = decode($(cells[5]).text());
      const daysRaw = decode($(cells[7]).text()).replace(/n\/a/gi, "").trim();
      const timeRaw = $(cells[8]).text();
      const credits = parseFloat(decode($(cells[9]).text())) || 0;
      const statusTxt = decode($(cells[10]).text());
      const instructorRaw = decode($(cells[11]).text());
      const delivery = decode($(cells[12]).text());

      if (!courseid || !subject || !number) return;
      // dedupe instructor (often listed twice for in-person + online row)
      const instructor =
        instructorRaw
          .split(/\s{2,}/)
          .map((s) => s.trim())
          .filter(Boolean)[0] || null;

      const { start, end } = parseTimeRange(timeRaw);
      const days = daysRaw.split(/\s{2,}/).filter(Boolean)[0] || "";

      sections.push({
        college_code: slug,
        term,
        course_prefix: subject,
        course_number: number,
        course_title: title,
        credits,
        crn: courseid,
        days,
        start_time: start,
        end_time: end,
        start_date: startDate,
        location: "",
        campus: "",
        mode: inferMode(delivery),
        instructor: instructor === "Staff" || instructor === "TBA" ? null : instructor,
        seats_open: statusTxt.toLowerCase() === "open" ? 1 : 0,
        seats_total: null,
        prerequisite_text: null,
        prerequisite_courses: [],
      });
    });
  }
  // dedupe by crn (subject filter overlap is rare but possible)
  const seen = new Set<string>();
  return sections.filter((s) => {
    if (seen.has(s.crn)) return false;
    seen.add(s.crn);
    return true;
  });
}

async function main() {
  const args = process.argv.slice(2);
  const collegeIdx = args.indexOf("--college");
  const collegeFilter = collegeIdx >= 0 ? args[collegeIdx + 1] : undefined;
  const termIdx = args.indexOf("--term");
  const termFilter = termIdx >= 0 ? args[termIdx + 1] : undefined;

  console.log("🌲 MN MnSCU eservices scraper");
  const targets = collegeFilter ? CAMPUSES.filter((c) => c.slug === collegeFilter) : CAMPUSES;
  if (collegeFilter && targets.length === 0) {
    console.error(`Unknown college slug: ${collegeFilter}`);
    process.exit(1);
  }

  const currentYear = new Date().getFullYear();
  let grandTotal = 0;

  for (const { slug, campusid } of targets) {
    console.log(`\n[${slug}] campusid=${campusid}`);
    const outDir = path.join(process.cwd(), "data", STATE, "courses", slug);
    fs.mkdirSync(outDir, { recursive: true });

    let terms: string[];
    try {
      terms = await discoverTerms(campusid);
    } catch (err) {
      console.error(`  ✗ term discovery failed: ${(err as Error).message}`);
      continue;
    }
    const futureTerms = terms.filter((t) => {
      const ourT = ourTermCode(t);
      const y = parseInt(ourT.slice(0, 4), 10);
      return y >= currentYear;
    });
    console.log(`  terms: ${futureTerms.map(ourTermCode).join(", ")}`);

    for (const yrtr of futureTerms) {
      if (termFilter && yrtr !== termFilter && ourTermCode(yrtr) !== termFilter) continue;
      let subjects: string[];
      try {
        subjects = await discoverSubjects(campusid, yrtr);
      } catch (err) {
        console.error(`  ${ourTermCode(yrtr)}: subject discovery failed: ${(err as Error).message}`);
        continue;
      }
      if (subjects.length === 0) {
        console.log(`  ${ourTermCode(yrtr)}: no subjects, skipping`);
        continue;
      }
      try {
        const sections = await scrapeCampusTerm(slug, campusid, yrtr, subjects);
        const outPath = path.join(outDir, `${ourTermCode(yrtr)}.json`);
        fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
        console.log(`  ${ourTermCode(yrtr)}: ${sections.length} sections (${subjects.length} subjects) → ${path.relative(process.cwd(), outPath)}`);
        grandTotal += sections.length;
      } catch (err) {
        console.error(`  ${ourTermCode(yrtr)}: scrape failed: ${(err as Error).message}`);
      }
    }
  }

  console.log(`\n✅ MN MnSCU total: ${grandTotal} sections across ${targets.length} colleges`);
}

main().catch((err) => {
  console.error("❌ MN scraper failed:", err);
  process.exit(1);
});

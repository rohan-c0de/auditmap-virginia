/**
 * Minnesota State (MnSCU) — eservices.minnstate.edu transfer-equivalency scraper
 *
 * Endpoint:
 *   GET https://eservices.minnstate.edu/registration/search/equivalentSubmit.html
 *     ?campusid={senderCampusId}
 *     &searchcampusid={senderCampusId}
 *     &rcid=0{senderCampusId}
 *     &subject={SUBJ}
 *     &courseNumber={NNNN}
 *     &yrtr={YYYYT}
 *
 * Response: HTML. Each receiver institution rendered as an <h2>, followed
 * by one or more `<div class="EquivalentCourse">` blocks containing
 * `<div style="font-weight: bold">SUBJ NNNN - Title - N credits</div>`.
 *
 * For each MN CC course we already scraped (10k+ unique tuples), query this
 * endpoint with the sender campusid and parse the receiver list. Filter to
 * 4-year university receivers — other-CC mappings are skipped (CC→CC
 * transfer is rarer at this scale and bloats the dataset).
 *
 * Output: data/mn/transfer-equiv.json — array of TransferEquiv records
 * matching the MA/NH shape. Sender college is encoded in `notes` as
 * `[sender-slug]`.
 *
 * Usage:
 *   npx tsx scripts/mn/scrape-transfers.ts            # full run
 *   npx tsx scripts/mn/scrape-transfers.ts --resume   # skip already-done courses
 *   npx tsx scripts/mn/scrape-transfers.ts --college minneapolis-community-and-technical-college
 *   npx tsx scripts/mn/scrape-transfers.ts --limit 50  # smoke-test
 *
 * Checkpointing: writes data/mn/transfer-equiv.json every 200 courses, so a
 * killed run can be restarted with --resume (loads existing file, skips any
 * sender (slug, prefix, number) tuple already represented in `notes`).
 */
import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";

const STATE = "mn";
const BASE = "https://eservices.minnstate.edu";
const OUT_PATH = path.join(process.cwd(), "data", STATE, "transfer-equiv.json");
const COURSES_DIR = path.join(process.cwd(), "data", STATE, "courses");

// Sender CC campusids (same as scrape-mn-eservices.ts).
const CC_CAMPUS_ID: Record<string, string> = {
  "alexandria-technical-and-community-college": "203",
  "anoka-technical-college": "202",
  "anoka-ramsey-community-college": "152",
  "central-lakes-college-brainerd": "301",
  "century-college": "304",
  "dakota-county-technical-college": "211",
  "fond-du-lac-tribal-and-community-college": "163",
  "hennepin-technical-college": "204",
  "inver-hills-community-college": "157",
  "lake-superior-college": "302",
  "minneapolis-community-and-technical-college": "305",
  "minnesota-north-college": "320",
  "minnesota-state-college-southeast": "213",
  "minnesota-state-community-and-technical-college": "142",
  "minnesota-west-community-and-technical-college": "209",
  "normandale-community-college": "156",
  "north-hennepin-community-college": "153",
  "northland-community-and-technical-college": "303",
  "northwest-technical-college": "263",
  "pine-technical-and-community-college": "205",
  "ridgewater-college": "308",
  "riverland-community-college": "307",
  "rochester-community-and-technical-college": "306",
  "saint-paul-college": "206",
  "south-central-college": "309",
  "st-cloud-technical-and-community-college": "208",
};

// Receiver 4-year universities — name as it appears in eservices `<h2>`
// → our university slug. We focus on 4-year receivers because that's
// where students transfer to (the use case for /mn/transfer). CC→CC
// equivalencies are skipped.
const FOUR_YEAR_RECEIVER: Record<string, { slug: string; name: string }> = {
  "Bemidji State University": { slug: "bemidji-state-university", name: "Bemidji State University" },
  "Minnesota State University, Mankato": {
    slug: "minnesota-state-university-mankato",
    name: "Minnesota State University, Mankato",
  },
  "Minnesota State University Moorhead": {
    slug: "minnesota-state-university-moorhead",
    name: "Minnesota State University Moorhead",
  },
  "St. Cloud State University": { slug: "st-cloud-state-university", name: "St. Cloud State University" },
  "Winona State University": { slug: "winona-state-university", name: "Winona State University" },
  "Southwest Minnesota State University": {
    slug: "southwest-minnesota-state-university",
    name: "Southwest Minnesota State University",
  },
  "Metro State University": { slug: "metro-state-university", name: "Metropolitan State University" },
  "Metropolitan State University": {
    slug: "metro-state-university",
    name: "Metropolitan State University",
  },
};

interface TransferEquiv {
  state: string;
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

interface CourseTuple {
  slug: string;
  campusid: string;
  prefix: string;
  number: string;
  title: string;
  credits: number;
}

const USER_AGENT = "Mozilla/5.0 (compatible; CommunityCollegePathBot/1.0)";

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

function loadUniqueCourses(slugFilter?: string): CourseTuple[] {
  const seen = new Map<string, CourseTuple>();
  const slugs = fs.existsSync(COURSES_DIR) ? fs.readdirSync(COURSES_DIR) : [];
  for (const slug of slugs) {
    if (slugFilter && slug !== slugFilter) continue;
    const campusid = CC_CAMPUS_ID[slug];
    if (!campusid) continue;
    const dir = path.join(COURSES_DIR, slug);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      const rows = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
      for (const r of rows) {
        const key = `${slug}|${r.course_prefix}|${r.course_number}`;
        if (seen.has(key)) continue;
        seen.set(key, {
          slug,
          campusid,
          prefix: r.course_prefix,
          number: r.course_number,
          title: r.course_title || "",
          credits: r.credits || 0,
        });
      }
    }
  }
  return Array.from(seen.values());
}

// Parse eservices equivalentSubmit response.
// Returns map of receiver-name → list of {course, title, credits}.
function parseEquivResponse(html: string): Array<{ name: string; course: string; title: string; credits: string }> {
  const $ = cheerio.load(html);
  const out: Array<{ name: string; course: string; title: string; credits: string }> = [];
  let currentReceiver: string | null = null;
  // Walk the DOM in document order to keep h2 → div sequence intact.
  $("h2, div.EquivalentCourse").each((_, el) => {
    const $el = $(el);
    if (el.tagName === "h2") {
      currentReceiver = decode($el.text());
      return;
    }
    if (!currentReceiver) return;
    // Each EquivalentCourse div has one or more course blocks: parse all of them.
    $el.find('div[style*="font-weight: bold"]').each((_, courseDiv) => {
      const text = decode($(courseDiv).text());
      // "ACCT 1000 - Introduction to Accounting - 3 credits"
      const m = text.match(/^([A-Z]{2,5})\s+([A-Z0-9]+)\s*-\s*(.+?)\s*-\s*([0-9.]+)\s*credit/i);
      if (!m) return;
      const [, subj, num, title, credits] = m;
      out.push({
        name: currentReceiver!,
        course: `${subj} ${num}`,
        title: title.trim(),
        credits,
      });
    });
  });
  return out;
}

const DEFAULT_YRTR = "20273"; // Fall 2026 — used as the query period

async function fetchEquivalents(course: CourseTuple): Promise<TransferEquiv[]> {
  const url =
    `${BASE}/registration/search/equivalentSubmit.html` +
    `?campusid=${course.campusid}` +
    `&searchcampusid=${course.campusid}` +
    `&rcid=0${course.campusid}` +
    `&subject=${encodeURIComponent(course.prefix)}` +
    `&courseNumber=${encodeURIComponent(course.number)}` +
    `&yrtr=${DEFAULT_YRTR}`;
  const html = await fetchWithRetry(url);
  const raw = parseEquivResponse(html);
  const out: TransferEquiv[] = [];
  for (const r of raw) {
    const receiver = FOUR_YEAR_RECEIVER[r.name];
    if (!receiver) continue; // skip CC→CC
    out.push({
      state: STATE,
      cc_prefix: course.prefix,
      cc_number: course.number,
      cc_course: `${course.prefix} ${course.number}`,
      cc_title: course.title,
      cc_credits: String(course.credits),
      university: receiver.slug,
      university_name: receiver.name,
      univ_course: r.course,
      univ_title: r.title,
      univ_credits: r.credits,
      notes: `[${course.slug}]`,
      no_credit: false,
      is_elective: false,
    });
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const collegeIdx = args.indexOf("--college");
  const collegeFilter = collegeIdx >= 0 ? args[collegeIdx + 1] : undefined;
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : undefined;
  const resume = args.includes("--resume");

  console.log("🌲 MN transfer-equiv scraper");
  const courses = loadUniqueCourses(collegeFilter);
  let targets = limit ? courses.slice(0, limit) : courses;

  const all: TransferEquiv[] = [];
  if (resume && fs.existsSync(OUT_PATH)) {
    const existing: TransferEquiv[] = JSON.parse(fs.readFileSync(OUT_PATH, "utf-8"));
    all.push(...existing);
    const doneKey = new Set<string>();
    for (const r of existing) {
      const senderSlug = r.notes.replace(/^\[|\]$/g, "");
      doneKey.add(`${senderSlug}|${r.cc_prefix}|${r.cc_number}`);
    }
    const before = targets.length;
    targets = targets.filter((c) => !doneKey.has(`${c.slug}|${c.prefix}|${c.number}`));
    console.log(`  resume: loaded ${existing.length} existing mappings; skipping ${before - targets.length} done courses`);
  }
  console.log(`  ${targets.length} unique sender courses to query`);
  const startedAt = Date.now();
  let lastLog = startedAt;
  for (let i = 0; i < targets.length; i++) {
    const c = targets[i];
    try {
      const recs = await fetchEquivalents(c);
      all.push(...recs);
    } catch (err) {
      console.error(`  ✗ ${c.slug} ${c.prefix} ${c.number}: ${(err as Error).message}`);
    }
    if (Date.now() - lastLog > 30_000) {
      const pct = ((i + 1) / targets.length * 100).toFixed(1);
      const rate = (i + 1) / ((Date.now() - startedAt) / 1000);
      const eta = Math.round(((targets.length - i - 1) / rate) / 60);
      console.log(`  [${i + 1}/${targets.length}] ${pct}% ${rate.toFixed(1)}req/s eta=${eta}min mappings=${all.length}`);
      lastLog = Date.now();
    }
    // Checkpoint every 200 courses so a killed run can --resume.
    if ((i + 1) % 200 === 0) {
      fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
      fs.writeFileSync(OUT_PATH, JSON.stringify(all, null, 2) + "\n");
    }
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(all, null, 2) + "\n");
  console.log(`\n✅ ${all.length} transfer mappings → ${path.relative(process.cwd(), OUT_PATH)}`);
}

main().catch((err) => {
  console.error("❌ MN transfer scraper failed:", err);
  process.exit(1);
});

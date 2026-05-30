/**
 * USD (University of South Dakota) — transfer-equivalency scraper.
 *
 * USD publishes a 3-step form at https://usd-asp.usd.edu/equivalency-calculator:
 *   1. POST /equivalency-calculator/College/select  body: STATE=SD
 *        → page with a SELECT of all known SD sending institutions
 *   2. POST /equivalency-calculator/Course/select   body: STATE+COLLEGE
 *        → page with a CHECKBOX list of every course USD has on file for
 *          that sending institution (incl. historical pre-2005 codes
 *          that still have CK values)
 *   3. POST /equivalency-calculator/Result/display  body: STATE+COLLEGE+CK[]
 *        → result <table> with columns:
 *          ["Course Name and Title", "Equivalent USD Course and Title",
 *           "Start Date", "End Date"]
 *
 * Why SD: USD's calculator is the only single tool that covers all 6 SD
 * community/tribal/technical colleges in one place. The SD Board of
 * Regents partners with Transferology for BHSU/DSU/NSU/SDSMT/SDSU but
 * Transferology requires login and blocks bots (403 on public-facing
 * system pages). USD's calculator is fully public.
 *
 * Each entry is filtered to "currently valid" — Start Date populated,
 * End Date empty. Pre-2005 codes (e.g. "CHEM 106") have an End Date of
 * 05/31/05; their post-2005 successors ("CHEM 106T") have only a Start
 * Date. We keep the current ones.
 *
 * Output schema matches data/{state}/transfer-equiv.json across the
 * project: flat array, one entry per (cc_prefix, cc_number, university,
 * univ_course) tuple. Same prefix/number across multiple SD CCs gets
 * deduped — when two CCs both have ENGL 101 mapping to ENGL 101 at USD,
 * one entry is emitted.
 */
import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";

const STATE = "sd";
const OUT_PATH = path.join(process.cwd(), "data", STATE, "transfer-equiv.json");

const BASE = "https://usd-asp.usd.edu/equivalency-calculator";

interface Entry {
  cc_prefix: string;
  cc_number: string;
  cc_course: string;
  cc_title: string;
  cc_credits: string;
  cc_college_slug: string;
  university: string;
  university_name: string;
  univ_course: string;
  univ_title: string;
  univ_credits: string;
  notes: string;
  no_credit: boolean;
  is_elective: boolean;
}

// USD's college names → our internal college slugs. USD lists every SD
// institution that has ever sent transfer students; we map only the ones
// represented in lib/states/sd/config.ts.
const COLLEGE_MAP: Record<string, string> = {
  "LAKE AREA TECH INSTITUTE": "lake-area-technical-college",
  "MITCHELL TECHNICAL INSTITUTE": "mitchell-technical-college",
  "OGLALA LAKOTA COLLEGE": "oglala-lakota-college",
  "SISSETON WAHPETON COLLEGE": "sisseton-wahpeton-college",
  "SOUTHEAST TECHNICAL INSTITUTE": "southeast-technical-college",
  "WESTERN DAKOTA TECHNICAL INST": "western-dakota-technical-college",
};

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

interface CookieJar {
  cookies: string[];
}

function newJar(): CookieJar {
  return { cookies: [] };
}

function mergeCookies(jar: CookieJar, setCookies: string[]) {
  const map = new Map<string, string>();
  for (const c of [...jar.cookies, ...setCookies]) {
    const eq = c.indexOf("=");
    if (eq < 0) continue;
    map.set(c.slice(0, eq), c.slice(eq + 1));
  }
  jar.cookies = Array.from(map.entries()).map(([k, v]) => `${k}=${v}`);
}

async function post(
  url: string,
  body: URLSearchParams,
  jar: CookieJar,
): Promise<string> {
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Content-Type": "application/x-www-form-urlencoded",
    Origin: "https://usd-asp.usd.edu",
    Referer: BASE,
  };
  if (jar.cookies.length) headers["Cookie"] = jar.cookies.join("; ");
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: body.toString(),
    redirect: "follow",
  });
  const setCookieRaw = res.headers.getSetCookie?.() ?? [];
  const setCookies: string[] = [];
  for (const c of setCookieRaw) {
    const first = c.split(";", 1)[0];
    if (first) setCookies.push(first);
  }
  mergeCookies(jar, setCookies);
  return await res.text();
}

function parseSdsCourse(s: string): {
  prefix: string;
  number: string;
  title: string;
} | null {
  // "ENGL 101 - Composition" or "ENGL 101T - Composition"
  const m = s.match(/^([A-Z]{2,5})\s*(\d{2,4}[A-Z]*)\s*-\s*(.+)$/);
  if (!m) return null;
  return { prefix: m[1], number: m[2], title: m[3].trim() };
}

function parseUsdCourse(s: string): {
  course: string;
  title: string;
} | null {
  // "ENGL-101 - Composition I" or "ELEC-1XXX - Elective"
  const m = s.match(/^(\S+)\s*-\s*(.+)$/);
  if (!m) return null;
  return { course: m[1], title: m[2].trim() };
}

function isElective(univCourse: string): boolean {
  // USD's elective convention: SUBJ-{level}T, e.g. ART-100T = "100-level
  // ART elective" (granted credit but no specific course). The trailing T
  // distinguishes from concrete courses like ART-111. Also catches the
  // generic XXX / ELEC / ZELE patterns other states use.
  if (/T$/.test(univCourse)) return true;
  return /XXX|ELEC|ZELE|UELE|UNEL/i.test(univCourse);
}

async function fetchCheckboxes(
  collegeName: string,
  jar: CookieJar,
): Promise<string[]> {
  const body = new URLSearchParams();
  body.set("STATE", "SD");
  body.set("COLLEGE", collegeName);
  const html = await post(`${BASE}/Course/select`, body, jar);
  const $ = cheerio.load(html);
  const cks: string[] = [];
  $("input[name='CK']").each((_, el) => {
    const v = $(el).attr("value");
    if (v) cks.push(v);
  });
  return cks;
}

async function fetchResults(
  collegeName: string,
  cks: string[],
  jar: CookieJar,
): Promise<
  Array<{ cc: string; usd: string; startDate: string; endDate: string }>
> {
  const body = new URLSearchParams();
  body.set("STATE", "SD");
  body.set("COLLEGE", collegeName);
  for (const ck of cks) body.append("CK", ck);
  const html = await post(`${BASE}/Result/display`, body, jar);
  const $ = cheerio.load(html);
  const rows: Array<{
    cc: string;
    usd: string;
    startDate: string;
    endDate: string;
  }> = [];
  $("table tr").each((_, tr) => {
    const cells = $(tr)
      .find("td")
      .map((__, td) => $(td).text().replace(/\s+/g, " ").trim())
      .get();
    if (cells.length !== 4) return;
    // skip header (text "Course Name and Title")
    if (/Course Name and Title/i.test(cells[0])) return;
    rows.push({
      cc: cells[0],
      usd: cells[1],
      startDate: cells[2],
      endDate: cells[3],
    });
  });
  return rows;
}

function scrapeCollege(collegeName: string): Promise<Entry[]> {
  return (async () => {
    const slug = COLLEGE_MAP[collegeName];
    if (!slug) throw new Error(`unmapped college: ${collegeName}`);
    const jar = newJar();
    // Step 1 — set STATE in session.
    const stateBody = new URLSearchParams();
    stateBody.set("STATE", "SD");
    await post(`${BASE}/College/select`, stateBody, jar);
    // Step 2 — get checkboxes.
    const cks = await fetchCheckboxes(collegeName, jar);
    if (cks.length === 0) return [];
    // Step 3 — submit them all to get the result table.
    const rows = await fetchResults(collegeName, cks, jar);
    const entries: Entry[] = [];
    for (const r of rows) {
      // Keep only currently valid mappings (End Date blank).
      if (r.endDate && r.endDate.trim()) continue;
      const cc = parseSdsCourse(r.cc);
      const usd = parseUsdCourse(r.usd);
      if (!cc || !usd) continue;
      entries.push({
        cc_prefix: cc.prefix,
        cc_number: cc.number,
        cc_course: `${cc.prefix} ${cc.number}`,
        cc_title: cc.title,
        cc_credits: "",
        cc_college_slug: slug,
        university: "usd",
        university_name: "University of South Dakota",
        univ_course: usd.course,
        univ_title: usd.title,
        univ_credits: "",
        notes: "",
        no_credit: false,
        is_elective: isElective(usd.course),
      });
    }
    return entries;
  })();
}

function dedup(entries: Entry[]): Entry[] {
  const map = new Map<string, Entry>();
  for (const e of entries) {
    const key = `${e.cc_college_slug}|${e.cc_prefix}|${e.cc_number}|${e.university}|${e.univ_course}`;
    if (!map.has(key)) map.set(key, e);
  }
  // Stable sort: college, prefix, number.
  return Array.from(map.values()).sort((a, b) =>
    a.cc_college_slug.localeCompare(b.cc_college_slug) ||
    a.cc_prefix.localeCompare(b.cc_prefix) ||
    a.cc_number.localeCompare(b.cc_number),
  );
}

async function main() {
  const all: Entry[] = [];
  for (const collegeName of Object.keys(COLLEGE_MAP)) {
    console.log(`Scraping USD ← ${collegeName}...`);
    try {
      const e = await scrapeCollege(collegeName);
      console.log(`  ${e.length} current mappings`);
      all.push(...e);
    } catch (err) {
      console.error(`  failed: ${err}`);
    }
  }
  const deduped = dedup(all);
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(deduped, null, 2));
  console.log(
    `\n=== USD transfer scrape complete: ${deduped.length} mappings (after dedup) → ${OUT_PATH} ===`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

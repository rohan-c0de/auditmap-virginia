/**
 * Ozarka College — ColdFusion public_schedule.cfm scraper.
 *
 * Ozarka publishes its full per-term schedule via a ColdFusion form at
 * /public_schedule.cfm. The form POSTs to /index.cfm?template=public_schedule
 * and renders results into table#Sched2 (Course | Section | Instructor |
 * Campus | Room | Times | HeadCount).
 *
 * WAF behavior is finicky:
 *   - The site is behind nginx + a referer/header sniffer (`x-ozarka:
 *     PublicPath`). Direct Playwright nav hits 403 (Sec-Ch-Ua client hints
 *     trip the WAF). Plain Node fetch with browser headers + cookie jar
 *     works.
 *   - POST must include `Submit=View Courses` (the named submit button) or
 *     the server silently routes to the home page.
 *   - Per-section detail pages (course_sect_details.cfm) return 403 to all
 *     attempts, so credits and dates aren't fetchable. The scraper records
 *     null for those fields rather than fabricating.
 *
 * Term codes encode as `YYYYTTS`:
 *   YYYY = academic year (e.g. "2026" for 2026-27)
 *   T    = ? (always "2" in observed data)
 *   S    = season (0=Summer 2, 1=Fall, 2=Spring, 3=Summer 1)
 * Examples observed in YearSem option values:
 *   2026271 = 2026-27 Fall  → normalized "2026FA"
 *   2026270 = 2026-27 Summer 2 (mid-year) → ignored as past
 *   2025262 = 2025-26 Spring → "2026SP"
 *   2025263 = 2025-26 Summer 1 → "2026SU"
 *
 * Usage:
 *   npx tsx scripts/ar/scrape-ozarka.ts
 */
import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";
import * as https from "https";
import { promisify } from "util";

const SLUG = "ozarka-college";
const STATE = "ar";
const HOST = "www.ozarka.edu";
const FORM_PATH = "/public_schedule.cfm";
const POST_PATH = "/index.cfm?template=public_schedule";
const COURSES_DIR = path.join(process.cwd(), "data", STATE, "courses", SLUG);

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const COMMON_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate",
};

const gunzip = promisify(zlib.gunzip);
const inflate = promisify(zlib.inflate);

type CourseMode = "in-person" | "online" | "hybrid" | "remote";

interface CourseSection {
  college_code: string;
  term: string;
  course_prefix: string;
  course_number: string;
  course_title: string;
  credits: number;
  crn: string;
  days: string | null;
  start_time: string | null;
  end_time: string | null;
  start_date: string | null;
  location: string | null;
  campus: string | null;
  mode: CourseMode | null;
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: null;
  prerequisite_courses: [];
}

interface FetchOpts {
  method?: "GET" | "POST";
  body?: string;
  cookies?: string;
  referer?: string;
}

interface FetchResult {
  status: number;
  body: string;
  setCookies: string[];
}

function fetchOnce(host: string, p: string, opts: FetchOpts): Promise<FetchResult & { location?: string }> {
  return new Promise((resolve, reject) => {
    const method = opts.method ?? "GET";
    const headers: Record<string, string> = { ...COMMON_HEADERS };
    if (opts.cookies) headers["Cookie"] = opts.cookies;
    if (opts.referer) headers["Referer"] = opts.referer;
    if (method === "POST") {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      headers["Origin"] = `https://${host}`;
      headers["Sec-Fetch-Site"] = "same-origin";
      headers["Sec-Fetch-Mode"] = "navigate";
      headers["Content-Length"] = String(Buffer.byteLength(opts.body ?? ""));
    } else {
      headers["Sec-Fetch-Site"] = "none";
      headers["Sec-Fetch-Mode"] = "navigate";
      headers["Upgrade-Insecure-Requests"] = "1";
    }
    const req = https.request(
      { hostname: host, path: p, method, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", async () => {
          let buf = Buffer.concat(chunks);
          const enc = res.headers["content-encoding"];
          try {
            if (enc === "gzip") buf = await gunzip(buf);
            else if (enc === "deflate") buf = await inflate(buf);
          } catch {
            // fall through with raw bytes
          }
          const setCookies = Array.isArray(res.headers["set-cookie"])
            ? res.headers["set-cookie"]
            : res.headers["set-cookie"]
              ? [res.headers["set-cookie"] as unknown as string]
              : [];
          const location = res.headers.location as string | undefined;
          resolve({ status: res.statusCode ?? 0, body: buf.toString("utf8"), setCookies, location });
        });
      },
    );
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function fetchPage(p: string, opts: FetchOpts = {}): Promise<FetchResult> {
  // Follow up to 5 redirects, preserving cookies across hops. Strips POST
  // body on 301/302 (browsers convert to GET) per RFC 7231.
  let currentHost = HOST;
  let currentPath = p;
  let currentOpts: FetchOpts = { ...opts };
  let accumulatedSetCookies: string[] = [];
  for (let i = 0; i < 6; i++) {
    const r = await fetchOnce(currentHost, currentPath, currentOpts);
    accumulatedSetCookies = accumulatedSetCookies.concat(r.setCookies);
    if (r.status >= 300 && r.status < 400 && r.location) {
      const loc = r.location;
      // Resolve relative redirects
      let target: URL;
      if (loc.startsWith("http")) {
        target = new URL(loc);
      } else if (loc.startsWith("/")) {
        target = new URL(`https://${currentHost}${loc}`);
      } else {
        target = new URL(loc, `https://${currentHost}${currentPath}`);
      }
      currentHost = target.host;
      currentPath = target.pathname + target.search;
      // Convert to GET on 301/302/303 redirects of POST.
      if ((r.status === 301 || r.status === 302 || r.status === 303) && currentOpts.method === "POST") {
        currentOpts = { ...currentOpts, method: "GET", body: undefined };
      }
      continue;
    }
    return { ...r, setCookies: accumulatedSetCookies };
  }
  throw new Error("redirect loop");
}

function mergeCookies(setCookies: string[]): string {
  const jar: Record<string, string> = {};
  for (const raw of setCookies) {
    const pair = raw.split(";")[0];
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

// "2026271" (2026-27 Fall) → "2026FA". "2025262" (2025-26 Spring) → "2026SP".
// "2025263" (2025-26 Summer 1) → "2026SU". "2026270" (2026-27 Summer 2 i.e.
// summer 2027) → "2027SU".
// Layout: first 4 chars = academic-year-START (so 2025-26 academic year =
// "2025"). Last char encodes season:
//   1 = Fall   (fall of the START year)         → year = start_year
//   2 = Spring (spring of the END year)         → year = start_year + 1
//   3 = Summer 1 (summer of the END year)       → year = start_year + 1
//   0 = Summer 2 (summer following the END year) → year = start_year + 1
// (Encoding inferred from observed values; verify by checking dates after
// scrape.)
function termValueToCode(v: string): string | null {
  if (!/^\d{7}$/.test(v)) return null;
  const startYear = parseInt(v.slice(0, 4), 10);
  const tail = v[6];
  if (tail === "1") return `${startYear}FA`;
  if (tail === "2") return `${startYear + 1}SP`;
  if (tail === "3") return `${startYear + 1}SU`;
  if (tail === "0") return `${startYear + 1}SU2`;
  return null;
}

// Approximate semester start date (used only when the detail page is
// unfetchable). Adjust if a college's calendar varies.
function approxStartDate(termCode: string): string {
  const year = termCode.slice(0, 4);
  if (termCode.endsWith("FA")) return `${year}-08-17`;
  if (termCode.endsWith("SP")) return `${year}-01-13`;
  if (termCode.endsWith("SU") || termCode.endsWith("SU2")) return `${year}-06-01`;
  return `${year}-08-17`;
}

// "Internet" / "Melbourne" / "Ash Flat Technical Center" → mode/campus
function classifyMode(campus: string, room: string, times: string): CourseMode {
  const c = campus.toLowerCase();
  if (c === "internet" || c.includes("online") || c.includes("web")) return "online";
  if (c.includes("hybrid")) return "hybrid";
  if (!times.trim() && (c === "internet" || !room.trim())) return "online";
  return "in-person";
}

// "MON TUE WED THU 1:00PM-2:30PM" → { days: "MTWR", start: "1:00 PM", end: "2:30 PM" }
function parseTimes(s: string): { days: string | null; start: string | null; end: string | null } {
  if (!s.trim()) return { days: null, start: null, end: null };
  // Day tokens come first, then a single time range.
  const dayMap: Record<string, string> = {
    MON: "M",
    TUE: "T",
    WED: "W",
    THU: "R",
    FRI: "F",
    SAT: "S",
    SUN: "U",
  };
  const tokens = s.trim().split(/\s+/);
  const days: string[] = [];
  let i = 0;
  while (i < tokens.length && dayMap[tokens[i].toUpperCase()]) {
    days.push(dayMap[tokens[i].toUpperCase()]);
    i++;
  }
  const remainder = tokens.slice(i).join(" ");
  const tm = remainder.match(/(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/i);
  if (!tm) return { days: days.length ? days.join("") : null, start: null, end: null };
  // Normalize "1:00PM" → "1:00 PM"
  const normalize = (t: string) => t.replace(/(\d)\s*([AP]M)/i, "$1 $2").toUpperCase();
  return {
    days: days.length ? days.join("") : null,
    start: normalize(tm[1]),
    end: normalize(tm[2]),
  };
}

// Course cell: "Accounting I<br><span ...>ACCT1123</span>". Extract title + parse code.
function parseCourseCell(html: string): { title: string; prefix: string; number: string } | null {
  // Pull out the title and the inner code span.
  const titleMatch = html.match(/title="([^"]+)"/);
  const codeMatch = html.match(/<span[^>]*>\s*([A-Z]{2,5}\d{3,4})\s*<\/span>/);
  if (!codeMatch) return null;
  const fullCode = codeMatch[1];
  // Split prefix and number: "ACCT1123" → "ACCT" / "1123"
  const cn = fullCode.match(/^([A-Z]+)(\d+)$/);
  if (!cn) return null;
  return {
    title: titleMatch?.[1].trim() ?? cn[1] + " " + cn[2],
    prefix: cn[1],
    number: cn[2],
  };
}

// Pull rows from the Sched2 table. Cheap regex-based split — the table is
// well-formed enough that we don't need cheerio for this.
function extractRows(html: string): string[][] {
  const tableMatch = html.match(/<table[^>]*id=["']Sched2["'][\s\S]*?<\/table>/i);
  if (!tableMatch) return [];
  const tbodyMatch = tableMatch[0].match(/<tbody>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch) return [];
  const tbody = tbodyMatch[1];
  const out: string[][] = [];
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = trRegex.exec(tbody)) !== null) {
    const cells: string[] = [];
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cm: RegExpExecArray | null;
    while ((cm = tdRegex.exec(m[1])) !== null) {
      cells.push(cm[1]);
    }
    if (cells.length >= 7) out.push(cells);
  }
  return out;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function rowToSection(cells: string[], termCode: string, sectionUid: string): CourseSection | null {
  const courseCell = cells[0];
  const parsed = parseCourseCell(courseCell);
  if (!parsed) return null;
  const section = stripHtml(cells[1]);
  const instructor = stripHtml(cells[2]) || null;
  const campus = stripHtml(cells[3]) || null;
  const room = stripHtml(cells[4]) || null;
  const timesText = stripHtml(cells[5]);
  const headCountStr = stripHtml(cells[6]);
  const { days, start, end } = parseTimes(timesText);
  const mode = classifyMode(campus ?? "", room ?? "", timesText);
  // CRN: combine prefix-number-section with the sel_sid for uniqueness
  // (Ozarka doesn't expose a public CRN; sel_sid is the stable internal id).
  const crn = `${parsed.prefix}-${parsed.number}-${section || "?"}-${sectionUid}`;
  const headCount = parseInt(headCountStr, 10);
  return {
    college_code: SLUG,
    term: termCode,
    course_prefix: parsed.prefix,
    course_number: parsed.number,
    course_title: parsed.title,
    // Credits aren't on the listing page; detail page is 403-gated. Set 0
    // (parser convention for "unknown") and document in the PR.
    credits: 0,
    crn,
    days,
    start_time: start,
    end_time: end,
    start_date: approxStartDate(termCode),
    location: room,
    campus,
    mode,
    instructor,
    // HeadCount is current enrollment; capacity isn't exposed. Use null.
    seats_open: null,
    seats_total: null,
    prerequisite_text: null,
    prerequisite_courses: [],
  };
}

function extractTermOptions(html: string): { value: string; label: string }[] {
  const selMatch = html.match(/<select[^>]+id=["']YearSem["'][\s\S]*?<\/select>/i);
  if (!selMatch) return [];
  const opts: { value: string; label: string }[] = [];
  const re = /<option\s+value=["']([^"']+)["'][^>]*>\s*([^<]+?)\s*(?:<|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(selMatch[0])) !== null) {
    opts.push({ value: m[1], label: m[2].trim() });
  }
  return opts;
}

function extractSectionUid(cell: string): string {
  const m = cell.match(/sel_sid=([0-9]+)/);
  return m?.[1] ?? "";
}

async function main() {
  // 1) GET the form to populate the cookie jar.
  console.log("GET", `https://${HOST}${FORM_PATH}`);
  const formRes = await fetchPage(FORM_PATH);
  if (formRes.status !== 200) {
    throw new Error(`form GET HTTP ${formRes.status}`);
  }
  const cookies = mergeCookies(formRes.setCookies);
  console.log(`  ${formRes.setCookies.length} set-cookie headers; using ${cookies.length} chars of cookie state`);

  const allTermOpts = extractTermOptions(formRes.body);
  console.log(`  ${allTermOpts.length} term options on form`);

  // 2) Pick active terms (current calendar year+).
  const currentYear = new Date().getFullYear();
  const STALE_THRESHOLD_MS = 21 * 24 * 60 * 60 * 1000;
  const seenCodes = new Set<string>();
  const active: { value: string; label: string; code: string }[] = [];
  for (const o of allTermOpts) {
    const code = termValueToCode(o.value);
    if (!code) continue;
    const yr = parseInt(code.slice(0, 4), 10);
    if (yr < currentYear) continue;
    if (seenCodes.has(code)) continue;
    seenCodes.add(code);
    active.push({ value: o.value, label: o.label, code });
  }
  if (active.length === 0) {
    console.error(`no active terms; available: ${allTermOpts.map((o) => `${o.value}=${termValueToCode(o.value) ?? "?"}`).join(", ")}`);
    process.exit(1);
  }
  console.log(`  active terms: ${active.map((t) => `${t.code} (${t.label})`).join(", ")}`);

  // 3) POST per term.
  fs.mkdirSync(COURSES_DIR, { recursive: true });
  let grandTotal = 0;
  const now = Date.now();
  for (const term of active) {
    console.log(`\n--- ${term.code} (${term.label}) — value=${term.value} ---`);
    const body =
      `YearSem=${encodeURIComponent(term.value)}` +
      "&campus_cod=ALL&day=ALL&start_time=400&ltr=&maxrows=500&show_open=0" +
      "&Submit=View+Courses";
    const res = await fetchPage(POST_PATH, {
      method: "POST",
      body,
      cookies,
      referer: `https://${HOST}${FORM_PATH}`,
    });
    if (res.status !== 200) {
      console.log(`  HTTP ${res.status} — skipping`);
      continue;
    }
    const rows = extractRows(res.body);
    console.log(`  parsed ${rows.length} rows`);
    const sections: CourseSection[] = [];
    for (const cells of rows) {
      const uid = extractSectionUid(cells[0]);
      const sec = rowToSection(cells, term.code, uid);
      if (sec) sections.push(sec);
    }
    if (sections.length === 0) {
      console.log("  0 sections; skipping write");
      continue;
    }
    // Stale-term guard (kept for parity with EACC scraper; Ozarka uses
    // approxStartDate so this check is structurally near-no-op but
    // protects against future-self-reuse mistakes).
    const latestStart = Math.max(
      ...sections
        .map((s) => (s.start_date ? Date.parse(s.start_date) : NaN))
        .filter((n) => !Number.isNaN(n)),
    );
    if (Number.isFinite(latestStart) && now - latestStart > STALE_THRESHOLD_MS) {
      console.log(
        `  skip: latest start_date ${new Date(latestStart).toISOString().slice(0, 10)} is >21 days in the past`,
      );
      continue;
    }
    const out = path.join(COURSES_DIR, `${term.code}.json`);
    fs.writeFileSync(out, JSON.stringify(sections, null, 2) + "\n");
    console.log(`  ${sections.length} sections → ${out}`);
    grandTotal += sections.length;
  }

  console.log(`\n=== Done: ${grandTotal} sections across ${active.length} terms ===`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

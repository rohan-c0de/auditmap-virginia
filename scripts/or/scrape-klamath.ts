/**
 * Klamath Community College — Jenzabar JICS SimpleQuery scraper
 *
 * KCC publishes per-season schedule pages at:
 *   https://mykcc.klamathcc.edu/ICS/Academics/{Season}_term_schedules.jnz
 * Each page hosts 1+ SimpleQuery portlets (Credit, Distance Ed, WCE) keyed
 * by a GUID. The portlet GUID is embedded in the HTML and called via:
 *   POST /ICS/Portlets/CUS/ICS/SimpleQuery/Query.ashx
 *
 * The API returns rows with columns:
 *   [0]  details-toggle image
 *   [1]  "PREFIX  NUMBER  SEC   [DE]" (space-padded)
 *   [2]  title
 *   [3]  seats available
 *   [4]  credits
 *   [5]  instructor
 *   [6]  description
 *   [14] delivery method
 *   [15] location/room
 *   [16] start date (MM/DD/YYYY)
 *   [17] end date (MM/DD/YYYY)
 *
 * Usage:
 *   npx tsx scripts/or/scrape-klamath.ts
 *   npx tsx scripts/or/scrape-klamath.ts --season Fall
 */
import * as fs from "fs";
import * as path from "path";
import * as https from "https";

// KCC's SSL server uses a weak (1024-bit) DH key; Node 20+ refuses by default.
// Lower OpenSSL's security level for this script (does not affect other connections in the run).
process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ""} --tls-cipher-list=DEFAULT@SECLEVEL=0`.trim();

async function fetchKcc(url: string, init?: RequestInit): Promise<{ status: number; text: () => Promise<string>; json: () => Promise<unknown> }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body as string | undefined;
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: {
        ...headers,
        ...(body ? { "Content-Length": Buffer.byteLength(body).toString() } : {}),
      },
      ciphers: "DEFAULT@SECLEVEL=0",
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        resolve({
          status: res.statusCode ?? 0,
          text: async () => buf.toString("utf8"),
          json: async () => JSON.parse(buf.toString("utf8")),
        });
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

const SLUG = "klamath-community-college";
const STATE = "or";
const BASE = "https://mykcc.klamathcc.edu";
const COURSES_DIR = path.join(process.cwd(), "data", STATE, "courses", SLUG);

const SEASON_PAGES: Record<string, string> = {
  Fall: "Fall_term_schedules",
  Winter: "Winter_Term_schedules",
  Spring: "Spring_course_schedules",
  Summer: "Summer_course_schedules",
};

const SEASON_CODE: Record<string, string> = {
  Fall: "FA",
  Winter: "WI",
  Spring: "SP",
  Summer: "SU",
};

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

async function fetchPortletIds(season: string): Promise<string[]> {
  const url = `${BASE}/ICS/Academics/${SEASON_PAGES[season]}.jnz`;
  const html = await (await fetchKcc(url)).text();
  const matches = [...html.matchAll(/portletId\s*=\s*['"]([0-9a-f-]{36})/g)];
  return [...new Set(matches.map((m) => m[1]))];
}

async function fetchPortletData(season: string, portletId: string): Promise<unknown[][]> {
  const url = `${BASE}/ICS/Portlets/CUS/ICS/SimpleQuery/Query.ashx`;
  const referer = `${BASE}/ICS/Academics/${SEASON_PAGES[season]}.jnz`;
  const res = await fetchKcc(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      Referer: referer,
    },
    body: `portletId=${portletId}&action=RunQuery&sEcho=1&iColumns=10&iDisplayStart=0&iDisplayLength=2000`,
  });
  const body = (await res.json()) as { d?: { data?: unknown[][] } };
  return body?.d?.data ?? [];
}

function parseCourseCode(raw: string): { prefix: string; number: string; section: string } | null {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  // Drop trailing markers like "DE" (Distance Ed)
  const parts = cleaned.split(" ").filter((p) => p && !/^[A-Z]{2,3}$/.test(p) || /^\d/.test(p));
  // Walk: first letters-only token = prefix, next numeric = number, next = section
  const tokens = cleaned.split(/\s+/);
  if (tokens.length < 3) return null;
  const prefix = tokens[0];
  const number = tokens[1];
  const section = tokens[2];
  if (!/^[A-Z]{2,4}$/.test(prefix) || !/^\d+[A-Z]?$/.test(number)) return null;
  void parts;
  return { prefix, number, section };
}

function inferMode(delivery: string, location: string): "in-person" | "online" | "hybrid" {
  const d = delivery.toLowerCase();
  if (d.includes("hybrid") || d.includes("blended")) return "hybrid";
  if (d.includes("online") || d.includes("distance") || d.includes("remote")) return "online";
  void location;
  return "in-person";
}

function termFromStartDate(startDate: string, seasonCode: string): string {
  // startDate is MM/DD/YYYY. Fall=YYYYFA, Winter=YYYYWI (calendar year of start),
  // Spring=YYYYSP, Summer=YYYYSU.
  const m = startDate.match(/\d{1,2}\/\d{1,2}\/(\d{4})/);
  if (!m) return `0000${seasonCode}`;
  return `${m[1]}${seasonCode}`;
}

async function scrapeSeason(season: string): Promise<Map<string, CourseSection[]>> {
  const seasonCode = SEASON_CODE[season];
  const byTerm = new Map<string, CourseSection[]>();

  const portletIds = await fetchPortletIds(season);
  if (portletIds.length === 0) {
    console.log(`  ${season}: no portlets found`);
    return byTerm;
  }
  console.log(`  ${season}: ${portletIds.length} portlet(s)`);

  for (const portletId of portletIds) {
    const rows = await fetchPortletData(season, portletId);
    console.log(`    portlet ${portletId.slice(0, 8)}…: ${rows.length} rows`);

    for (const row of rows as string[][]) {
      const rawCode = row[1] ?? "";
      const parsed = parseCourseCode(rawCode);
      if (!parsed) continue;

      const title = (row[2] ?? "").trim();
      const seats = parseInt(String(row[3] ?? "0"), 10);
      const credits = parseFloat(String(row[4] ?? "0")) || 0;
      const instructor = ((row[5] ?? "") as string).trim() || null;
      const delivery = ((row[14] ?? "") as string).trim();
      const location = ((row[15] ?? "") as string).trim();
      const startDate = ((row[16] ?? "") as string).trim();
      const term = termFromStartDate(startDate, seasonCode);
      // Skip rows without a real start date — typically WCE/community-ed sections.
      if (term.startsWith("0000")) continue;
      // Skip past terms
      const termYear = parseInt(term.slice(0, 4), 10);
      const now = new Date();
      if (termYear < now.getFullYear() && !(termYear === now.getFullYear() - 1 && seasonCode === "FA")) continue;

      const section: CourseSection = {
        college_code: SLUG,
        term,
        course_prefix: parsed.prefix,
        course_number: parsed.number,
        course_title: title,
        credits,
        crn: `${parsed.prefix}-${parsed.number}-${parsed.section}`,
        days: "",
        start_time: "",
        end_time: "",
        start_date: startDate,
        location,
        campus: location.includes("KCC") ? "Klamath Falls" : "Klamath Falls",
        mode: inferMode(delivery, location),
        instructor,
        seats_open: Number.isFinite(seats) ? seats : null,
        seats_total: null,
        prerequisite_text: null,
        prerequisite_courses: [],
      };

      const list = byTerm.get(term) ?? [];
      list.push(section);
      byTerm.set(term, list);
    }
  }

  return byTerm;
}

async function main() {
  const args = process.argv.slice(2);
  const seasonIdx = args.indexOf("--season");
  const seasonFilter = seasonIdx >= 0 ? args[seasonIdx + 1] : undefined;

  console.log("🏔️  Klamath CC Jenzabar JICS scraper");
  fs.mkdirSync(COURSES_DIR, { recursive: true });

  const seasons = seasonFilter ? [seasonFilter] : Object.keys(SEASON_PAGES);
  let grandTotal = 0;

  for (const season of seasons) {
    const byTerm = await scrapeSeason(season);
    for (const [term, sections] of byTerm.entries()) {
      const outPath = path.join(COURSES_DIR, `${term}.json`);
      fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
      console.log(`    → ${sections.length} sections → ${path.relative(process.cwd(), outPath)}`);
      grandTotal += sections.length;
    }
  }

  console.log(`\n✅ klamath-community-college: ${grandTotal} total sections`);
}

main().catch((err) => {
  console.error("❌ KCC scraper failed:", err);
  process.exit(1);
});

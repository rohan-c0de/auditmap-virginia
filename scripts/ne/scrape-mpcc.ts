/**
 * Mid-Plains Community College — Jenzabar SimpleQuery JSON API scraper
 *
 * MPCC publishes its course schedule on a public Jenzabar JICS visitor page:
 *   https://campus.mpcc.edu/ICS/Visitor/Current_Schedules.jnz
 *
 * Three SimpleQuery portlets expose current/next/future terms. Each portlet
 * returns all sections via:
 *   GET /ICS/Portlets/CUS/ICS/SimpleQuery/Query.ashx?portletId=<uuid>&action=RunQuery
 *
 * Row structure (0-indexed):
 *   [0] section_code  e.g. "ACCT 1025 NP   L01"
 *   [1] title         e.g. "Principles of Accounting I"
 *   [2] term          e.g. "2026 Summer"
 *   [3] date_range    e.g. "06/01/2026 - 07/24/2026"
 *   [4] time          e.g. "08:00 AM - 09:50 AM"
 *   [5] days          e.g. "MTWR"
 *   [6] location      e.g. "North Platte - McDonald Belton"
 *   [7] instructor    e.g. "Smith, John"
 *   [8] enrollment    e.g. "12/20"
 *   [9] campus/room   e.g. "NP Campus, Room 201"
 *   [10] bookstore    HTML link (ignored)
 *
 * Usage:
 *   npx tsx scripts/ne/scrape-mpcc.ts
 */
import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";

const SLUG = "mid-plains-community-college";
const STATE = "ne";
const BASE = "https://campus.mpcc.edu";
const VISITOR_PAGE = "/ICS/Visitor/Current_Schedules.jnz";
const QUERY_PATH = "/ICS/Portlets/CUS/ICS/SimpleQuery/Query.ashx";
const COURSES_DIR = path.join(process.cwd(), "data", STATE, "courses", SLUG);

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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

function parseSetCookie(headers: Headers): string {
  const cookies = headers.getSetCookie?.() ?? [];
  return cookies.map((c) => c.split(";")[0]).join("; ");
}

async function discoverPortlets(): Promise<{ uuid: string; label: string }[]> {
  const res = await fetch(`${BASE}${VISITOR_PAGE}`, {
    headers: { "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`Visitor page fetch failed: HTTP ${res.status}`);
  const html = await res.text();

  const portlets: { uuid: string; label: string }[] = [];
  const re = /portletId\s*=\s*['"]([0-9a-f-]{36})['"]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const uuid = m[1];
    if (!portlets.some((p) => p.uuid === uuid)) {
      portlets.push({ uuid, label: uuid.slice(0, 8) });
    }
  }

  const $ = cheerio.load(html);
  $("h4, h3, .portlet-title").each((_, el) => {
    const text = $(el).text().trim();
    if (text && portlets.length > 0) {
      const idx = portlets.findIndex((p) => p.label === p.uuid.slice(0, 8));
      if (idx >= 0) portlets[idx].label = text;
    }
  });

  return portlets;
}

function parseSectionCode(raw: string): {
  prefix: string;
  number: string;
  section: string;
} | null {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  const m = cleaned.match(/^([A-Z]{2,5})\s+(\d{3,5})\s+\S*\s*(\S+)$/);
  if (m) return { prefix: m[1], number: m[2], section: m[3] };
  const m2 = cleaned.match(/^([A-Z]{2,5})\s+(\d{3,5})\s+(.+)$/);
  if (m2) return { prefix: m2[1], number: m2[2], section: m2[3].split(/\s+/).pop() || "01" };
  return null;
}

function parseDateRange(raw: string): string {
  const m = raw.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return "";
  return `${m[3]}-${m[1]}-${m[2]}`;
}

function parseTime(raw: string): { start: string; end: string } {
  const m = raw.match(/(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/i);
  if (!m) return { start: "", end: "" };
  return { start: to24(m[1]), end: to24(m[2]) };
}

function to24(raw: string): string {
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
  if (!m) return raw.trim();
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ampm = m[3].toUpperCase();
  if (ampm === "PM" && h < 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return `${h.toString().padStart(2, "0")}:${min}`;
}

function normalizeTerm(raw: string): string {
  const map: Record<string, string> = { spring: "SP", summer: "SU", fall: "FA", winter: "WI" };
  // "2026 Fall" or "Fall 2026" patterns
  const m1 = raw.match(/(\d{4})\s*(Spring|Summer|Fall|Winter)/i);
  if (m1) return `${m1[1]}${map[m1[2].toLowerCase()] || m1[2].slice(0, 2).toUpperCase()}`;
  const m2 = raw.match(/(Spring|Summer|Fall|Winter)\s*(\d{4})/i);
  if (m2) return `${m2[2]}${map[m2[1].toLowerCase()] || m2[1].slice(0, 2).toUpperCase()}`;
  return raw.replace(/\s+/g, "");
}

function inferMode(location: string, days: string): "in-person" | "online" | "hybrid" {
  const l = location.toLowerCase();
  if (l.includes("online") || l.includes("virtual") || l.includes("internet")) return "online";
  if (l.includes("hybrid")) return "hybrid";
  if (!days && (l.includes("tba") || l === "")) return "online";
  return "in-person";
}

function parseEnrollment(raw: string): { open: number | null; total: number | null } {
  const m = raw.match(/(\d+)\s*\/\s*(\d+)/);
  if (!m) return { open: null, total: null };
  const enrolled = parseInt(m[1], 10);
  const cap = parseInt(m[2], 10);
  return { open: Math.max(0, cap - enrolled), total: cap };
}

async function scrapePortlet(uuid: string): Promise<CourseSection[]> {
  const url = `${BASE}${QUERY_PATH}?portletId=${uuid}&action=RunQuery`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "X-Requested-With": "XMLHttpRequest" },
  });
  if (!res.ok) throw new Error(`Query failed for ${uuid}: HTTP ${res.status}`);

  const payload = (await res.json()) as { d?: { success?: boolean; data?: unknown[][] } };
  if (!payload.d?.success || !payload.d.data) return [];

  const sections: CourseSection[] = [];
  for (const row of payload.d.data) {
    if (row.length < 10) continue;

    const sectionRaw = String(row[0] || "");
    const parsed = parseSectionCode(sectionRaw);
    if (!parsed) continue;

    const title = String(row[1] || "").trim();
    const termRaw = String(row[2] || "").trim();
    const term = normalizeTerm(termRaw);
    const startDate = parseDateRange(String(row[3] || ""));
    const { start: startTime, end: endTime } = parseTime(String(row[4] || ""));
    const days = String(row[5] || "").replace(/\s+/g, "").trim();
    const location = String(row[6] || "").trim();
    const instructor = String(row[7] || "").trim() || null;
    const { open, total } = parseEnrollment(String(row[8] || ""));
    const campusRoom = String(row[9] || "").trim();

    sections.push({
      college_code: SLUG,
      term,
      course_prefix: parsed.prefix,
      course_number: parsed.number,
      course_title: title,
      credits: 0,
      crn: `${parsed.prefix}-${parsed.number}-${parsed.section}`,
      days,
      start_time: startTime,
      end_time: endTime,
      start_date: startDate,
      location: campusRoom || location,
      campus: location.split(" - ")[0] || "MPCC",
      mode: inferMode(location, days),
      instructor,
      seats_open: open,
      seats_total: total,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  }
  return sections;
}

async function main() {
  console.log("Mid-Plains Community College — Jenzabar SimpleQuery scraper");
  console.log(`   Source: ${BASE}${VISITOR_PAGE}`);

  fs.mkdirSync(COURSES_DIR, { recursive: true });

  const portlets = await discoverPortlets();
  console.log(`   Found ${portlets.length} portlet(s): ${portlets.map((p) => p.label).join(", ")}`);

  if (portlets.length === 0) {
    console.log("   No portlets found — trying known UUIDs");
    portlets.push(
      { uuid: "f14033ce-0a79-4a02-970b-a71d363c11ce", label: "Summer 2026" },
      { uuid: "a80a609d-bf0f-4ccd-917b-6ced04653e7c", label: "Fall 2026" },
      { uuid: "7c0d8d70-4249-446a-834b-75733bfdd5cb", label: "Spring 2027" },
    );
  }

  let grandTotal = 0;
  const allSections: Map<string, CourseSection[]> = new Map();

  for (const { uuid, label } of portlets) {
    process.stdout.write(`  Portlet ${label} (${uuid.slice(0, 8)})... `);
    try {
      const sections = await scrapePortlet(uuid);
      if (sections.length === 0) {
        console.log("0 sections (skipping)");
        continue;
      }

      for (const s of sections) {
        const existing = allSections.get(s.term) || [];
        existing.push(s);
        allSections.set(s.term, existing);
      }

      console.log(`${sections.length} sections`);
      grandTotal += sections.length;
    } catch (err) {
      console.log(`error: ${(err as Error).message}`);
    }
  }

  for (const [term, sections] of allSections) {
    const outPath = path.join(COURSES_DIR, `${term}.json`);
    fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
    console.log(`  → ${path.relative(process.cwd(), outPath)} (${sections.length} sections)`);
  }

  console.log(`\n${SLUG}: ${grandTotal} total sections`);
}

main().catch((err) => {
  console.error("MPCC scraper failed:", err);
  process.exit(1);
});

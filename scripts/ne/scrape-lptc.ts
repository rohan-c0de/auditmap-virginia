/**
 * Little Priest Tribal College — PDF schedule scraper
 *
 * LPTC publishes per-term course schedules as PDFs on their WordPress site:
 *   https://www.littlepriest.edu/course-catalog-schedule/
 *
 * The scraper:
 *   1. Fetches the course-catalog-schedule page to discover current PDF URLs
 *   2. Downloads each PDF
 *   3. Runs `pdftotext -layout` to extract fixed-width text
 *   4. Parses course lines with a regex pattern
 *
 * PDF naming: FL26-Course-Schedule_*.pdf, SU26-*, SP26-*
 *
 * Usage:
 *   npx tsx scripts/ne/scrape-lptc.ts
 */
import * as cheerio from "cheerio";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const SLUG = "little-priest-tribal-college";
const STATE = "ne";
const LANDING_URL = "https://www.littlepriest.edu/course-catalog-schedule/";
const COURSES_DIR = path.join(process.cwd(), "data", STATE, "courses", SLUG);
const TMP_DIR = path.join(process.cwd(), "tmp", "lptc-pdfs");

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

interface PdfSchedule {
  term: string;
  url: string;
  label: string;
}

function inferTermFromFilename(filename: string): string | null {
  const m = filename.match(/(FL|SU|SP)(\d{2})/i);
  if (!m) return null;
  const seasonMap: Record<string, string> = { FL: "FA", SU: "SU", SP: "SP" };
  const season = seasonMap[m[1].toUpperCase()];
  const year = `20${m[2]}`;
  return `${year}${season}`;
}

async function discoverPdfs(): Promise<PdfSchedule[]> {
  const res = await fetch(LANDING_URL, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`Landing page failed: HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const pdfs: PdfSchedule[] = [];
  $("a[href*='Course-Schedule'], a[href*='course-schedule']").each((_, el) => {
    const href = $(el).attr("href") || "";
    if (!href.endsWith(".pdf")) return;
    const label = $(el).text().trim() || path.basename(href);
    const filename = path.basename(href);
    const term = inferTermFromFilename(filename);
    if (term) pdfs.push({ term, url: href, label });
  });

  const now = new Date(process.env.SCRAPE_NOW_ISO || "2026-05-31");
  const currentYear = now.getUTCFullYear();
  return pdfs.filter((p) => {
    const year = parseInt(p.term.slice(0, 4), 10);
    return year >= currentYear;
  });
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

function parseDate(raw: string): string {
  const m = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return "";
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function inferMode(modality: string): "in-person" | "online" | "hybrid" {
  const m = modality.toLowerCase();
  if (m.includes("online")) return "online";
  if (m.includes("hybrid") || m.includes("hyflex")) return "hybrid";
  return "in-person";
}

function parsePdfText(text: string, term: string): CourseSection[] {
  const lines = text.split("\n");
  const sections: CourseSection[] = [];

  // Course line pattern: starts with course code like ACCT1200 or BSAD/MATH2170
  // Columns (fixed-width): Course Code, Section#, Title, Credits, StartDate, EndDate, StartTime, EndTime, Days, Modality, Bldg, Room, Instructor
  const courseRegex = /^([A-Z]{2,}(?:\/[A-Z]+)?\d{3,5})\s+(\d{2})\s+(.+?)\s{2,}(\d+)\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(.*)/;

  for (const line of lines) {
    const m = line.match(courseRegex);
    if (!m) continue;

    const codeRaw = m[1];
    const sectionNum = m[2];
    const title = m[3].trim();
    const credits = parseInt(m[4], 10);
    const startDate = parseDate(m[5]);
    const rest = m[7].trim();

    // Parse course code: ACCT1200, BSAD/MATH2170, ECED1630/1640
    const codeMatch = codeRaw.match(/^([A-Z]{2,5})\/?(?:[A-Z]*)?(\d{3,5})/);
    if (!codeMatch) continue;
    const prefix = codeMatch[1];
    const number = codeMatch[2];

    // Parse remaining fields: time, days, modality, building, room, instructor
    let startTime = "";
    let endTime = "";
    let days = "";
    let modality = "In-person";
    let location = "";
    let instructor: string | null = null;

    // Try to extract times
    const timeMatch = rest.match(/(\d{1,2}:\d{2}\s*[AP]M)\s+(\d{1,2}:\d{2}\s*[AP]M)/i);
    if (timeMatch) {
      startTime = to24(timeMatch[1]);
      endTime = to24(timeMatch[2]);
    }

    // Extract days (M, T, W, R, F, S patterns)
    const daysMatch = rest.match(/\b([MTWRFS]{1,6})\b/);
    if (daysMatch && !daysMatch[1].match(/^(AM|PM|In|TBD)$/i)) {
      days = daysMatch[1];
    }

    // Extract modality
    if (/In-person/i.test(rest)) modality = "In-person";
    else if (/Online/i.test(rest)) modality = "Online";
    else if (/Hybrid/i.test(rest)) modality = "Hybrid";
    else if (/Hyflex/i.test(rest)) modality = "Hyflex";
    else if (/Closed/i.test(rest)) continue; // Skip closed sections

    // Extract building + room and instructor from the tail
    const bldgInstrMatch = rest.match(/(?:In-person|Online|Hybrid|Hyflex)\s+(.*)/i);
    if (bldgInstrMatch) {
      const tail = bldgInstrMatch[1].trim();
      // Last word(s) after building/room codes are the instructor
      // Building codes: LLMB, Elk, Bear, Buff, Deer, Hawk, Canvas, WPS, SSC, SC
      const parts = tail.split(/\s+/);
      if (parts.length >= 2) {
        const lastPart = parts[parts.length - 1];
        // If last part looks like an instructor name
        if (/^[A-Z]\.?\s/.test(tail.slice(-30)) || /^[A-Z][a-z]/.test(lastPart)) {
          // Find where the instructor starts — usually after building/room
          const instrMatch = tail.match(/\d{3}\s+(.+)$/) || tail.match(/Canvas\s+(.+)$/i) || tail.match(/\s{2,}(\S.+)$/);
          if (instrMatch) {
            instructor = instrMatch[1].trim();
            location = tail.replace(instrMatch[1], "").trim();
          } else {
            location = tail;
          }
        } else {
          location = tail;
        }
      } else {
        location = tail;
      }
    }

    sections.push({
      college_code: SLUG,
      term,
      course_prefix: prefix,
      course_number: number,
      course_title: title,
      credits,
      crn: `${prefix}-${number}-${sectionNum}`,
      days,
      start_time: startTime,
      end_time: endTime,
      start_date: startDate,
      location: location || "Winnebago",
      campus: "Winnebago",
      mode: inferMode(modality),
      instructor,
      seats_open: null,
      seats_total: null,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  }

  return sections;
}

async function downloadPdf(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`PDF download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

async function main() {
  console.log("Little Priest Tribal College — PDF schedule scraper");
  console.log(`   Landing: ${LANDING_URL}`);

  fs.mkdirSync(COURSES_DIR, { recursive: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });

  const pdfs = await discoverPdfs();
  console.log(`   Found ${pdfs.length} PDF(s): ${pdfs.map((p) => `${p.term} (${p.label})`).join(", ")}`);

  if (pdfs.length === 0) {
    console.log("   No current/future term PDFs found.");
    process.exit(0);
  }

  let grandTotal = 0;
  for (const pdf of pdfs) {
    process.stdout.write(`  ${pdf.term} (${pdf.label})... `);
    try {
      const pdfPath = path.join(TMP_DIR, `${pdf.term}.pdf`);
      await downloadPdf(pdf.url, pdfPath);

      const text = execSync(`pdftotext -layout "${pdfPath}" -`, {
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
      });

      const sections = parsePdfText(text, pdf.term);
      if (sections.length === 0) {
        console.log("0 sections (skipping)");
        continue;
      }

      const outPath = path.join(COURSES_DIR, `${pdf.term}.json`);
      fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
      console.log(`${sections.length} sections → ${path.relative(process.cwd(), outPath)}`);
      grandTotal += sections.length;
    } catch (err) {
      console.log(`error: ${(err as Error).message}`);
    }
  }

  console.log(`\n${SLUG}: ${grandTotal} total sections`);
}

main().catch((err) => {
  console.error("LPTC scraper failed:", err);
  process.exit(1);
});

/**
 * Cayuga Community College — custom PHP schedule
 *
 * The college's WordPress site at www.cayuga-cc.edu/academics/schedule-of-classes/
 * hosts a form that POSTs to /includes/academics/schedule-process.php with
 * term=Summer|Fall|Intersession and returns a single HTML table with all
 * sections inline.
 *
 * Table row structure:
 *   <td>CRN</td>
 *   <td>SUBJ<br><span>NUM-SEC</span></td>
 *   <td><a>Title</a><br>Credits: N<br>Availability: M</td>
 *   <td>Days (T/Th)</td>
 *   <td>Start<br>End times</td>
 *   <td>Location</td>
 *   <td>Start<br>End dates</td>
 *   <td>Instructor</td>
 *
 * Usage:
 *   npx tsx scripts/ny/scrape-cayuga.ts
 *   npx tsx scripts/ny/scrape-cayuga.ts --term Fall
 */
import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";

const STATE = "ny";
const SLUG = "cayuga-cc";
const ENDPOINT = "https://www.cayuga-cc.edu/includes/academics/schedule-process.php";
const TERMS = ["Summer", "Fall", "Intersession"] as const;
type Term = (typeof TERMS)[number];

const UA = "Mozilla/5.0 (compatible; CommunityCollegePathBot/1.0)";

interface Section {
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
  mode: string;
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

function termToCode(term: Term): string {
  const year = new Date().getFullYear();
  if (term === "Summer") return `${year}SU`;
  if (term === "Fall") return `${year}FA`;
  // Intersession runs Dec/Jan → call it intersession of next spring
  return `${year + 1}IN`;
}

function normalizeDays(raw: string): string {
  // "M/W", "T/Th", "T/Th/F"
  return raw.replace(/\//g, "")
    .replace(/Th/g, "Th").replace(/T(?!h)/g, "Tu")
    .replace(/M/g, "Mo").replace(/W/g, "We")
    .replace(/F/g, "Fr").replace(/S(?!u|a)/g, "Sa").replace(/U/g, "Su");
}

function detectMode(location: string): string {
  const l = location.toLowerCase();
  if (l.includes("online") && !l.includes("real time")) return "online";
  if (l.includes("hybrid")) return "hybrid";
  if (l.includes("real time") || l.includes("zoom")) return "zoom";
  return "in-person";
}

async function scrapeTerm(term: Term): Promise<Section[]> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `term=${term}`,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${ENDPOINT}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  const sections: Section[] = [];
  const termCode = termToCode(term);

  $("#rolling_thunder tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 8) return;

    const crn = $(cells[0]).text().trim();
    if (!/^\d+$/.test(crn)) return;

    // Course cell: "ANTH<br>101-701"
    const courseCellHtml = $(cells[1]).html() || "";
    const courseText = $(cells[1]).text().trim();
    const courseMatch = /([A-Z]+)\s*([0-9]+[A-Z]*)-?(\d*)/.exec(courseText);
    if (!courseMatch) return;
    const prefix = courseMatch[1];
    const number = courseMatch[2];

    // Title + credits cell
    const titleCellText = $(cells[2]).text();
    const title = ($(cells[2]).find("a").first().text() || "").trim();
    const creditsMatch = /Credits:\s*(\d+(?:\.\d+)?)/.exec(titleCellText);
    const seatsMatch = /Availability:\s*(\d+)/.exec(titleCellText);

    const daysRaw = $(cells[3]).text().trim();
    const timesText = $(cells[4]).text().trim();
    const location = $(cells[5]).text().replace(/\s+/g, " ").trim();
    const datesText = $(cells[6]).text().trim();
    const instructor = $(cells[7]).text().trim() || null;

    // Parse times: "9:00 AM<br>10:25 AM"
    const timeLines = timesText.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    const startTime = timeLines[0] || "";
    const endTime = timeLines[1] || "";

    // Parse dates: "08-31-2026<br>12-11-2026" → ISO
    const dateLines = datesText.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    const startDateRaw = dateLines[0] || "";
    let startDate = "";
    const dm = /(\d{2})-(\d{2})-(\d{4})/.exec(startDateRaw);
    if (dm) startDate = `${dm[3]}-${dm[1]}-${dm[2]}`;

    sections.push({
      college_code: SLUG,
      term: termCode,
      course_prefix: prefix,
      course_number: number,
      course_title: title,
      credits: creditsMatch ? parseFloat(creditsMatch[1]) : 0,
      crn,
      days: normalizeDays(daysRaw),
      start_time: startTime,
      end_time: endTime,
      start_date: startDate,
      location,
      campus: location.split(/\s+/)[0] || "Auburn",
      mode: detectMode(location),
      instructor,
      seats_open: seatsMatch ? parseInt(seatsMatch[1]) : null,
      seats_total: null,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  });

  return sections;
}

async function main() {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--term");
  const termFilter = idx >= 0 ? (args[idx + 1] as Term) : null;
  const terms = termFilter ? [termFilter] : TERMS;

  const outDir = path.join(process.cwd(), "data", STATE, "courses", SLUG);
  fs.mkdirSync(outDir, { recursive: true });

  let grandTotal = 0;
  for (const term of terms) {
    try {
      const sections = await scrapeTerm(term);
      if (sections.length === 0) {
        console.log(`  ${term}: 0 sections`);
        continue;
      }
      const termCode = termToCode(term);
      const outFile = path.join(outDir, `${termCode}.json`);
      fs.writeFileSync(outFile, JSON.stringify(sections, null, 2));
      console.log(`  ${term} (${termCode}): ${sections.length} sections → ${termCode}.json`);
      grandTotal += sections.length;
    } catch (e) {
      console.error(`  ${term}: ERROR ${(e as Error).message}`);
    }
  }

  console.log(`\nCayuga: ${grandTotal} total sections written`);
}

main().catch((e) => { console.error(e); process.exit(1); });

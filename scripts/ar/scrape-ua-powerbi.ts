/**
 * UA-system Power BI schedule scraper — CCCUA, UACCB, UARM.
 *
 * Four UA-system Arkansas community colleges publish class schedules
 * as Power BI embedded reports. They use two distinct report patterns:
 *
 *   1. **CCCUA** (Cossatot, tenant c6511b92): a single visual exports a
 *      "SearchBlob" concatenated string per section. All terms in one
 *      response. Easy: split the string on the known field-order pattern.
 *
 *   2. **UACCB** (Batesville) and **UARM** (Rich Mountain), tenant
 *      8c1a87cb: a 12-column table visual with the Workday Student schema
 *      (Section, Section_Status, Delivery_Mode, ... StartDate, EndDate).
 *      The response uses Power BI's RLE+dictionary compression — every
 *      row references prior row values for unchanged columns. Need a
 *      stateful decoder.
 *
 * PCCUA (Phillips) also uses Power BI but its main visual only exposes
 * the Section column; the other columns are in separate visuals that
 * would need to be cross-referenced. Deferred to a follow-up.
 *
 * Mechanism: load each report headlessly in Playwright, intercept all
 * /querydata responses, find the one matching the expected schema, decode.
 *
 * No slicer interaction needed — the default render returns all
 * past/current/future terms in a single response. The staleness guard
 * (21-day post-start cutoff) drops past terms before write.
 *
 * Usage:
 *   npx tsx scripts/ar/scrape-ua-powerbi.ts                # all 3 colleges
 *   npx tsx scripts/ar/scrape-ua-powerbi.ts --college uarm
 */
import * as fs from "fs";
import * as path from "path";
import { chromium, type Page, type BrowserContext } from "playwright";

const STATE = "ar";

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

interface CollegeConfig {
  slug: string;
  reportUrl: string;
  /** Which decoder shape to use. */
  format: "search-blob" | "wd-courses-table";
  /** Fallback campus when not extractable from the row. */
  defaultCampus: string;
}

const COLLEGES: CollegeConfig[] = [
  {
    slug: "cossatot-community-college-of-the-university-of-arkansas",
    reportUrl:
      "https://app.powerbi.com/view?r=eyJrIjoiOTliODM5NDUtZDUwMy00OGZjLWFjMzItMTFmYTk1YTRhZTM1IiwidCI6ImM2NTExYjkyLTU3NmMtNGNkYy05MTdmLWY0ZTAyZWQ1ZDRjMCJ9",
    format: "search-blob",
    defaultCampus: "Ashdown",
  },
  {
    slug: "university-of-arkansas-community-college-batesville",
    reportUrl:
      "https://app.powerbi.com/view?r=eyJrIjoiNDNiZmYwYTktODM4Yi00NDAyLWE2OWMtNjIyOGFiNTY3ZDI1IiwidCI6IjhjMWE4N2NiLTgwYjctNDEzZi05YWU4LTU1YzZhNTM3MDYwNCJ9",
    format: "wd-courses-table",
    defaultCampus: "Batesville",
  },
  {
    slug: "university-of-arkansas-community-college-rich-mountain",
    reportUrl:
      "https://app.powerbi.com/view?r=eyJrIjoiOTM3ODZmMTAtZjBlZi00MTZhLWEyNTgtNjBlOTFiY2YyYjJkIiwidCI6IjhjMWE4N2NiLTgwYjctNDEzZi05YWU4LTU1YzZhNTM3MDYwNCJ9",
    format: "wd-courses-table",
    defaultCampus: "Mena",
  },
];

// ---------------------------------------------------------------------------
// Power BI DAX response decoder (RLE + dictionary compression)
// ---------------------------------------------------------------------------

interface DAXResponse {
  schema: { N: string; DN?: string; T: number }[];
  rows: Record<string, unknown>[];
  columnNames: string[];
}

/**
 * Decode a Power BI DAX querydata response.
 *
 * Power BI returns rows with RLE compression via `R` (repeat bitmap) and
 * `Ø` (null bitmap). The first row contains the schema (`S`). Subsequent
 * rows include only NEW values in `C`; columns where the R-bit is set
 * inherit the previous row's value; columns where the Ø-bit is set are
 * explicitly null. String columns reference dictionary entries by index
 * (the dict is in `ValueDicts.{DN}`); numeric columns are inline.
 *
 * Returns rows as plain `{ [columnName]: value }` objects.
 */
function decodeDAX(payload: unknown): DAXResponse | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = payload as any;
  const ds = p?.results?.[0]?.result?.data?.dsr?.DS?.[0];
  const descriptor = p?.results?.[0]?.result?.data?.descriptor?.Select;
  if (!ds || !descriptor) return null;
  const ph = ds.PH?.[0]?.DM0;
  if (!Array.isArray(ph)) return null;
  const dicts = ds.ValueDicts ?? {};

  const columnNames: string[] = descriptor.map((d: { Name: string }) => d.Name);
  let schema: { N: string; DN?: string; T: number }[] = [];
  const lastValues: unknown[] = [];
  const rows: Record<string, unknown>[] = [];

  for (const row of ph) {
    if (row.S) {
      schema = row.S;
      for (let i = 0; i < schema.length; i++) lastValues[i] = undefined;
    }
    if (!schema.length) continue;

    const R = (row.R as number | undefined) ?? 0;
    const NULLMASK = (row.Ø as number | undefined) ?? 0;
    const C = (row.C as unknown[] | undefined) ?? [];

    let cIdx = 0;
    for (let col = 0; col < schema.length; col++) {
      const repeated = (R >> col) & 1;
      const isNull = (NULLMASK >> col) & 1;
      if (isNull) {
        lastValues[col] = null;
        continue;
      }
      if (repeated) {
        // inherit
        continue;
      }
      // New value in C
      const raw = C[cIdx++];
      const colSchema = schema[col];
      if (colSchema?.DN) {
        // Dictionary-referenced string
        const dictArr = dicts[colSchema.DN];
        if (Array.isArray(dictArr) && typeof raw === "number") {
          lastValues[col] = dictArr[raw];
        } else if (typeof raw === "string") {
          lastValues[col] = raw;
        } else {
          lastValues[col] = raw;
        }
      } else {
        lastValues[col] = raw;
      }
    }

    if (R === 0 && schema.length > 0 && lastValues.length === schema.length) {
      // Full row reset; but we still emit normally
    }

    const obj: Record<string, unknown> = {};
    for (let col = 0; col < schema.length; col++) {
      obj[columnNames[col] ?? schema[col].N] = lastValues[col];
    }
    rows.push(obj);
  }

  return { schema, rows, columnNames };
}

// ---------------------------------------------------------------------------
// Field parsers (shared)
// ---------------------------------------------------------------------------

// "ACCT 20003-30" → { prefix: "ACCT", number: "20003", section: "30" }
// "ACCT 20003-30HS" → { prefix, number, section: "30HS" }
function parseSection(s: string): { prefix: string; number: string; section: string } | null {
  const m = s.trim().match(/^([A-Z]{2,5})\s+(\d{3,5}[A-Z]?)-([A-Z0-9]+)$/);
  if (!m) return null;
  return { prefix: m[1], number: m[2], section: m[3] };
}

// "Fall 2026" → "2026FA"
function termFromAcademicPeriod(s: string): string | null {
  const m = s.match(/\b(Fall|Spring|Summer|Winter)\s+(\d{4})\b/i);
  if (!m) return null;
  const season = m[1].toUpperCase();
  const code = season === "FALL" ? "FA" : season === "SPRING" ? "SP" : season === "SUMMER" ? "SU" : "WI";
  return `${m[2]}${code}`;
}

// "08/17/2026" or "8/17/2026" → "2026-08-17". Also accepts ISO format
// passthrough since Workday's Power BI export already emits "2026-08-17".
function normalizeDate(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function asInt(v: unknown): number | null {
  if (typeof v === "number") return Math.trunc(v);
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

// "Monday/Wednesday | 8:00 AM - 9:50 AM" → { days: "MW", start, end }
// "ONL" / "" → all nulls
function parseMeetingPattern(s: string | null | undefined): {
  days: string | null;
  start: string | null;
  end: string | null;
} {
  if (!s || typeof s !== "string") return { days: null, start: null, end: null };
  const dayMap: Record<string, string> = {
    Monday: "M",
    Tuesday: "T",
    Wednesday: "W",
    Thursday: "R",
    Friday: "F",
    Saturday: "S",
    Sunday: "U",
  };
  const parts = s.split("|").map((p) => p.trim());
  let days: string | null = null;
  let times: string | null = null;
  if (parts.length >= 2) {
    days = parts[0]
      .split("/")
      .map((d) => dayMap[d] ?? "")
      .join("");
    if (!days) days = null;
    times = parts[1];
  } else if (parts.length === 1) {
    times = parts[0];
  }
  if (!times) return { days, start: null, end: null };
  const tm = times.match(/(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/i);
  if (!tm) return { days, start: null, end: null };
  return { days, start: tm[1].toUpperCase().replace(/\s+/g, " "), end: tm[2].toUpperCase().replace(/\s+/g, " ") };
}

function classifyMode(deliveryMode: string | null | undefined, days: string | null): CourseMode | null {
  const d = (deliveryMode ?? "").toLowerCase();
  if (d.includes("online")) return "online";
  if (d.includes("hybrid") || d.includes("blended")) return "hybrid";
  if (d.includes("remote")) return "remote";
  if (d.includes("in-person") || d.includes("in person")) return "in-person";
  if (days) return "in-person";
  return null;
}

// ---------------------------------------------------------------------------
// Format A: WD_Courses 12-column table (UACCB, UARM)
// ---------------------------------------------------------------------------

function decodeWdCoursesTable(payload: unknown, cfg: CollegeConfig): CourseSection[] {
  const decoded = decodeDAX(payload);
  if (!decoded) return [];
  // Confirm the schema is the WD_Courses 12-column table.
  const required = ["WD_Courses.Section", "WD_Courses.Academic_Period", "WD_Courses.StartDate"];
  for (const r of required) {
    if (!decoded.columnNames.includes(r)) return [];
  }
  const out: CourseSection[] = [];
  const seen = new Set<string>();
  for (const row of decoded.rows) {
    const sectionStr = row["WD_Courses.Section"] as string | undefined;
    const period = row["WD_Courses.Academic_Period"] as string | undefined;
    if (!sectionStr || !period) continue;
    const parsed = parseSection(sectionStr.split(" - ")[0] ?? sectionStr);
    if (!parsed) continue;
    const term = termFromAcademicPeriod(period);
    if (!term) continue;
    // Title is everything after " - " in the section string
    const dashIdx = sectionStr.indexOf(" - ");
    const title = dashIdx >= 0 ? sectionStr.slice(dashIdx + 3).trim() : sectionStr;
    const crn = `${parsed.prefix}-${parsed.number}-${parsed.section}-${term}`;
    if (seen.has(crn)) continue;
    seen.add(crn);
    const mp = row["WD_Courses.Meeting_Pattern"] as string | undefined;
    const { days, start, end } = parseMeetingPattern(mp ?? null);
    const startDate = normalizeDate((row["WD_Courses.StartDate"] as string) ?? "");
    const deliveryMode = (row["WD_Courses.Delivery_Mode"] as string) ?? "";
    const cap = asInt(row["WD_Courses.Capacity"]);
    const enr = asInt(row["WD_Courses.Enrolled"]);
    const status = row["WD_Courses.Section_Status"];
    if (status === "Cancelled") continue;
    const location = (row["WD_Courses.Location"] as string) ?? null;
    const instructorRaw = (row["WD_Courses.Primary_Instructor"] as string) ?? "";
    out.push({
      college_code: cfg.slug,
      term,
      course_prefix: parsed.prefix,
      course_number: parsed.number,
      course_title: title,
      // Credits aren't in the Workday export visible to this report
      credits: 0,
      crn,
      days,
      start_time: start,
      end_time: end,
      start_date: startDate,
      location,
      campus: cfg.defaultCampus,
      mode: classifyMode(deliveryMode, days),
      instructor: instructorRaw.trim() || null,
      seats_open: cap !== null && enr !== null ? Math.max(0, cap - enr) : null,
      seats_total: cap,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Format B: CCCUA SearchBlob concatenated strings
// ---------------------------------------------------------------------------

// Sample: "ACCT 20003-30 - Accounting Principles I CCCUA Fall 2026 (8/17/2026-12/11/2026) Ashley Dougherty Ashley Dougherty Online Open Online"
// Pattern: <SECTION> - <TITLE> CCCUA <TERM> (<DATES>) <INSTRUCTOR_REPEATED> <MODE> <STATUS> [<MODE_AGAIN>] [<CONCURRENT NOTE>]
const CCCUA_RE =
  /^([A-Z]{2,5}\s+\d{3,5}[A-Z]?-[A-Z0-9]+)\s+-\s+(.+?)\s+CCCUA\s+(Fall|Spring|Summer|Winter)\s+(\d{4})\s+\((\d{1,2}\/\d{1,2}\/\d{4})-(\d{1,2}\/\d{1,2}\/\d{4})\)\s+(.+?)\s+(Online|Hybrid|In-Person|Blended|On Campus|TBA|TBD)\s+(Open|Closed|Cancelled|Waitlist|Hold)\b/i;

function decodeSearchBlob(payload: unknown, cfg: CollegeConfig): CourseSection[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = payload as any;
  const ph = p?.results?.[0]?.result?.data?.dsr?.DS?.[0]?.PH?.[0]?.DM0;
  if (!Array.isArray(ph)) return [];
  const out: CourseSection[] = [];
  const seen = new Set<string>();
  for (const row of ph) {
    const blob = row.G0 as string | undefined;
    if (!blob || typeof blob !== "string") continue;
    // First line only — concurrent sections sometimes append "\nConcurrent" etc.
    const line = blob.split("\n")[0].trim();
    const m = line.match(CCCUA_RE);
    if (!m) continue;
    const [, sectionStr, title, season, year, startStr, _endStr, instructorRaw, mode, status] = m;
    if (status === "Cancelled") continue;
    const parsed = parseSection(sectionStr);
    if (!parsed) continue;
    const seasonCode = season.toUpperCase() === "FALL" ? "FA" : season.toUpperCase() === "SPRING" ? "SP" : season.toUpperCase() === "SUMMER" ? "SU" : "WI";
    const term = `${year}${seasonCode}`;
    // Instructor is doubled in the SearchBlob — keep one copy
    const instructorParts = instructorRaw.trim().split(/\s+/);
    const half = Math.floor(instructorParts.length / 2);
    const dedupName = instructorParts.slice(0, half).join(" ") === instructorParts.slice(half).join(" ")
      ? instructorParts.slice(0, half).join(" ")
      : instructorRaw.trim();
    const crn = `${parsed.prefix}-${parsed.number}-${parsed.section}-${term}`;
    if (seen.has(crn)) continue;
    seen.add(crn);
    out.push({
      college_code: cfg.slug,
      term,
      course_prefix: parsed.prefix,
      course_number: parsed.number,
      course_title: title.trim(),
      credits: 0,
      crn,
      days: null, // not in blob
      start_time: null,
      end_time: null,
      start_date: normalizeDate(startStr),
      location: null,
      campus: cfg.defaultCampus,
      mode: classifyMode(mode, null),
      instructor: dedupName || null,
      seats_open: null,
      seats_total: null,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-college scraper
// ---------------------------------------------------------------------------

async function scrapeCollege(ctx: BrowserContext, cfg: CollegeConfig): Promise<CourseSection[]> {
  const page = await ctx.newPage();
  page.setDefaultTimeout(60_000);

  const captured: unknown[] = [];
  page.on("response", async (resp) => {
    if (!resp.url().includes("querydata")) return;
    try {
      const body = await resp.text();
      captured.push(JSON.parse(body));
    } catch {
      /* ignore non-JSON */
    }
  });

  console.log(`\n--- ${cfg.slug} (${cfg.format}) ---`);
  await page.goto(cfg.reportUrl, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForTimeout(10_000);

  // Scroll the grid a few times — virtualized grids only fetch visible rows
  // initially, but for the WD_Courses table the full dataset comes back in
  // one query. Scrolling is a cheap defense against future virtualization.
  const grid = await page.$("[role='grid']");
  if (grid) {
    for (let i = 0; i < 4; i++) {
      await grid.evaluate((el) => el.scrollBy(0, 800));
      await page.waitForTimeout(1500);
    }
  }
  await page.waitForTimeout(2000);
  await page.close();

  console.log(`  captured ${captured.length} querydata responses`);

  // Try each captured response with the format-specific decoder; pick the
  // one that produces the most rows.
  let best: CourseSection[] = [];
  for (const payload of captured) {
    const decoded =
      cfg.format === "wd-courses-table"
        ? decodeWdCoursesTable(payload, cfg)
        : decodeSearchBlob(payload, cfg);
    if (decoded.length > best.length) {
      best = decoded;
    }
  }
  console.log(`  decoded ${best.length} sections`);
  return best;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const collegeIdx = args.indexOf("--college");
  const collegeFilter = collegeIdx >= 0 ? args[collegeIdx + 1] : undefined;
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  const STALE_THRESHOLD_MS = 21 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  let grandTotal = 0;

  try {
    const targets = collegeFilter
      ? COLLEGES.filter((c) =>
          c.slug.includes(collegeFilter) || c.slug === collegeFilter || c.slug.startsWith(collegeFilter),
        )
      : COLLEGES;
    if (targets.length === 0) {
      console.error(
        `no matching college for "${collegeFilter}"; valid: ${COLLEGES.map((c) => c.slug).join(", ")}`,
      );
      process.exit(1);
    }
    for (const cfg of targets) {
      const sections = await scrapeCollege(ctx, cfg);
      if (sections.length === 0) {
        console.log("  0 sections; skipping write");
        continue;
      }
      // Group by term
      const byTerm = new Map<string, CourseSection[]>();
      for (const s of sections) {
        if (!byTerm.has(s.term)) byTerm.set(s.term, []);
        byTerm.get(s.term)!.push(s);
      }
      const coursesDir = path.join(process.cwd(), "data", STATE, "courses", cfg.slug);
      fs.mkdirSync(coursesDir, { recursive: true });
      for (const [term, group] of [...byTerm.entries()].sort()) {
        const latestStart = Math.max(
          ...group
            .map((s) => (s.start_date ? Date.parse(s.start_date) : NaN))
            .filter((n) => !Number.isNaN(n)),
        );
        if (Number.isFinite(latestStart) && now - latestStart > STALE_THRESHOLD_MS) {
          console.log(
            `  skip ${term}: latest start_date ${new Date(latestStart).toISOString().slice(0, 10)} is >21 days in the past`,
          );
          continue;
        }
        const out = path.join(coursesDir, `${term}.json`);
        fs.writeFileSync(out, JSON.stringify(group, null, 2) + "\n");
        console.log(`  ${term}: ${group.length} sections → ${out}`);
        grandTotal += group.length;
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`\n=== Done: ${grandTotal} sections shipped across all colleges ===`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

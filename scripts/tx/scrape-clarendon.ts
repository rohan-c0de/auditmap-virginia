/**
 * Clarendon College — bespoke ASP.NET WebForms scrape
 *
 * Clarendon's public class search lives at ci.clarendoncollege.edu — a
 * single-page ASP.NET WebForms form with a term selector + a few filter
 * dropdowns. POSTing back returns an HTML table of sections grouped by
 * "Campus : X" header rows.
 *
 * Quirk: Chromium reports the Search button (`#btnsearch`) as off-screen
 * when the page renders headless, so `page.click()` times out. We submit
 * the form programmatically via JS instead, appending a synthetic
 * `btnsearch=Search` hidden input so the server still sees the submit name.
 *
 * Sparse data caveat: the results table only exposes Dept, CrsID, Type,
 * Section, CourseName, Credits, Status, Instructor. No CRN, no meeting
 * days/times, no start_date, no seat counts — Clarendon's public schedule
 * just doesn't publish that information. We fill in what we can:
 *
 *   - crn:                synthesized `${prefix}-${number}-${section}`
 *   - days / times:       empty strings
 *   - start_date:         empty string
 *   - location / campus:  empty (see below)
 *   - mode:               "in-person" (no reliable signal)
 *   - seats_open/total:   null
 *   - prerequisite_*:     not in the listing
 *
 * Campus is left empty because the public form returns either a single
 * grouped response (with "Campus : X" header rows separating sections per
 * campus) or a flat un-grouped one, and which one comes back depends on a
 * race between the `ddlTermList` `__doPostBack` and our subsequent
 * `form.submit()`. The flat response is consistent across runs; tagging
 * rows by iterating campus filter values doesn't help because the
 * server-side filter ignores the value we pass.
 *
 * Course identity + instructor + status is still useful for the planner's
 * "this course exists this term" check and for instructor-name search.
 *
 * Usage:
 *   npx tsx scripts/tx/scrape-clarendon.ts
 *   npx tsx scripts/tx/scrape-clarendon.ts --term=FA-26
 *   npx tsx scripts/tx/scrape-clarendon.ts --max-pages=1  # smoke (one term)
 */
import { chromium, type Browser, type Page } from "playwright";
import * as fs from "fs";
import * as path from "path";

const SLUG = "clarendon-college";
const STATE = "tx";
const FORM_URL = "https://ci.clarendoncollege.edu/";
const OUT_DIR = path.join(process.cwd(), "data", STATE, "courses", SLUG);

const NAV_TIMEOUT = 45_000;

type CourseMode = "in-person" | "online" | "hybrid" | "zoom";

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
  mode: CourseMode;
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

interface RawRow {
  cells: string[];
  campus: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * "FA-26"      → "2026FA"
 * "SU 2-26"    → "2026SU"  (sub-sessions collapse into the umbrella term)
 * "SU 12WK-26" → "2026SU"
 * "SU 1-26"    → "2026SU"
 * "SP-27"      → "2027SP"
 */
function termCodeToStandard(raw: string): string | null {
  const m = raw.match(/^(FA|SP|SU|WI)(?:\s+\S+)?-(\d{2})$/i);
  if (!m) return null;
  const term = m[1].toUpperCase();
  const year = `20${m[2]}`;
  return `${year}${term}`;
}

async function listTerms(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const sel = document.querySelector<HTMLSelectElement>("#ddlTermList");
    if (!sel) return [];
    return Array.from(sel.options)
      .map((o) => o.value)
      .filter((v) => v && /^(FA|SP|SU|WI)/i.test(v));
  });
}

async function submitSearchForTerm(
  page: Page,
  termValue: string
): Promise<void> {
  // ddlTermList has onchange="__doPostBack('ddlTermList','')" which races
  // with form.submit() — depending on which posts first, the response is
  // either grouped by campus (with "Campus : X" header rows) or flattened.
  // The flat response is more consistent across runs; we go with it and
  // accept the campus field is unknown.
  // The selectOption fires ddlTermList's onchange __doPostBack which
  // triggers a full ASP.NET page navigation. The previous `sleep(500)`
  // raced with that navigation under CI load: the *next* page.evaluate()
  // intermittently failed with `Execution context was destroyed, most
  // likely because of a navigation` (run 26630520569, 2026-05-29).
  // `waitForLoadState` alone doesn't help because it can resolve from
  // the *current* (pre-postback) network-idle state before the postback
  // actually starts. Use the Promise.all + waitForNavigation pattern so
  // we capture the navigation triggered by selectOption itself.
  await Promise.all([
    page
      .waitForNavigation({ waitUntil: "networkidle", timeout: NAV_TIMEOUT })
      .catch(() => {}),
    page.selectOption("#ddlTermList", termValue),
  ]);
  await sleep(200);

  // Force-submit because the visible submit button is reported off-screen
  // headless. Inject a hidden btnsearch=Search so the server-side handler
  // (which keys on Request.Form["btnsearch"]) still fires.
  await page.evaluate(() => {
    const form = document.querySelector<HTMLFormElement>("#form1");
    if (!form) throw new Error("form1 missing");
    const existing = form.querySelector<HTMLInputElement>(
      'input[name="btnsearch"]'
    );
    if (!existing) {
      const hidden = document.createElement("input");
      hidden.type = "hidden";
      hidden.name = "btnsearch";
      hidden.value = "Search";
      form.appendChild(hidden);
    }
    form.submit();
  });
  await page
    .waitForLoadState("networkidle", { timeout: NAV_TIMEOUT })
    .catch(() => {});
  await sleep(1500);
}

async function extractRows(page: Page): Promise<RawRow[]> {
  return page.evaluate(() => {
    const results = document.querySelector<HTMLTableElement>("#grdCourseList");
    if (!results) return [];
    const out: { cells: string[]; campus: string }[] = [];
    for (const tr of Array.from(results.querySelectorAll("tr"))) {
      const cells = Array.from(tr.querySelectorAll("td")).map((td) =>
        (td.textContent || "").trim()
      );
      if (cells.length < 9) continue;
      if (!cells[1] || !cells[2]) continue;
      if (!/^[A-Z]{2,5}$/.test(cells[1])) continue;
      out.push({ cells, campus: "" });
    }
    return out;
  });
}

function classifyMode(campus: string): CourseMode {
  const c = campus.toLowerCase();
  if (c.includes("online")) return "online";
  if (c.includes("hybrid")) return "hybrid";
  return "in-person";
}

function rawToSection(r: RawRow, termFile: string): CourseSection | null {
  const prefix = r.cells[1].trim();
  const number = r.cells[2].trim();
  if (!/^[A-Z]{2,5}$/.test(prefix) || !/^\d{3,4}[A-Z]?$/.test(number)) return null;
  const _type = r.cells[3] || "";
  const section = r.cells[4] || "";
  const title = r.cells[5] || "";
  const credits = parseFloat(r.cells[6] || "") || 0;
  const status = r.cells[7] || "";
  const instructor = (r.cells[8] || "").trim();
  return {
    college_code: SLUG,
    term: termFile,
    course_prefix: prefix,
    course_number: number,
    course_title: title,
    credits,
    crn: `${prefix}-${number}-${section}`,
    days: "",
    start_time: "",
    end_time: "",
    start_date: "",
    location: r.campus,
    campus: r.campus,
    mode: classifyMode(r.campus),
    instructor: instructor && !/^staff$/i.test(instructor) ? instructor : null,
    seats_open: null,
    seats_total: status.toLowerCase().includes("closed") ? 0 : null,
    prerequisite_text: null,
    prerequisite_courses: [],
  };
}

async function main() {
  const args = process.argv.slice(2);
  const termFilter = args.find((a) => a.startsWith("--term="))?.split("=")[1];
  const maxTerms = parseInt(
    args.find((a) => a.startsWith("--max-pages="))?.split("=")[1] || "0",
    10
  );

  console.log("🐎 Clarendon College scraper");
  console.log(`   URL: ${FORM_URL}`);

  const browser: Browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();
  page.setDefaultTimeout(NAV_TIMEOUT);

  let grandTotal = 0;
  const summary: Record<string, number> = {};
  try {
    await page.goto(FORM_URL, { waitUntil: "networkidle", timeout: NAV_TIMEOUT });
    await sleep(1500);

    const allTerms = await listTerms(page);
    let targets = termFilter
      ? allTerms.filter((t) => t === termFilter)
      : allTerms;
    if (maxTerms > 0) targets = targets.slice(0, maxTerms);
    console.log(`   ${allTerms.length} term(s) available; scraping ${targets.length}`);
    for (const t of targets) console.log(`     - ${t}`);

    for (const term of targets) {
      const termFile = termCodeToStandard(term);
      if (!termFile) {
        console.log(`   skip "${term}": can't map to standard code`);
        continue;
      }
      console.log(`\n   ${term} → ${termFile}`);
      // Each term needs a fresh form load (ASP.NET ViewState reuse is
      // unreliable across submits).
      await page.goto(FORM_URL, {
        waitUntil: "networkidle",
        timeout: NAV_TIMEOUT,
      });
      await sleep(1000);
      await submitSearchForTerm(page, term);

      const rows = await extractRows(page);
      const outFile = path.join(OUT_DIR, `${termFile}.json`);
      // Sub-sessions of the same season (SU 1-26, SU 2-26, SU 12WK-26) all
      // collapse to 2026SU, so append to any existing file rather than
      // clobber.
      const sections: CourseSection[] = [];
      if (fs.existsSync(outFile)) {
        try {
          const prev: CourseSection[] = JSON.parse(
            fs.readFileSync(outFile, "utf-8")
          );
          if (Array.isArray(prev)) sections.push(...prev);
        } catch {
          /* corrupt file — overwrite */
        }
      }
      const seen = new Set<string>(
        sections.map((s) => s.crn + s.term + s.campus)
      );
      let added = 0;
      for (const r of rows) {
        const sec = rawToSection(r, termFile);
        if (!sec) continue;
        const key = sec.crn + sec.term + sec.campus;
        if (seen.has(key)) continue;
        sections.push(sec);
        seen.add(key);
        added++;
      }

      fs.mkdirSync(OUT_DIR, { recursive: true });
      fs.writeFileSync(outFile, JSON.stringify(sections, null, 2) + "\n");
      console.log(
        `     ${rows.length} rows → +${added} new sections (file total ${sections.length}) → ${outFile}`
      );
      summary[termFile] = (summary[termFile] ?? 0) + added;
      grandTotal += added;
    }
  } finally {
    await browser.close();
  }

  console.log(`\n✅ ${grandTotal} new sections across ${Object.keys(summary).length} term file(s).`);
}

main().catch((e) => {
  console.error("❌ Clarendon scraper failed:", e);
  process.exit(1);
});

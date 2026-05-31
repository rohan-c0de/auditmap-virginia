/**
 * Ilisagvik College — catalog prerequisite scraper
 *
 * Ilisagvik's course-search SIS (Empower) does not expose prerequisite text
 * in its section payload. The catalog at catalog.ilisagvik.edu (CleanCatalog
 * on Pantheon) publishes prereqs in a `field--name-field-pr` block on each
 * course detail page.
 *
 * Pantheon aggressively rate-limits and IP-bans pure-Node fetch traffic
 * (we got banned the first time around after the programs scrape). Playwright
 * with a real Chrome UA passes through; we add a 1.5-second delay between
 * pages to stay well under the threshold.
 *
 * Strategy:
 *   1. Read data/ak/programs/ilisagvik-college.json — 17 programs, ~86 unique
 *      (prefix, number) pairs.
 *   2. For each program, visit its catalog_url and harvest <a href="/{prog-slug}/{code}">
 *      hrefs that match a course code pattern. Dedup across programs by full URL
 *      (so we visit each unique URL once even though the same course can be
 *      reachable from multiple programs).
 *   3. For each unique course URL, fetch the page and read
 *      .field--name-field-pr's text. Skip rows with no prereq field.
 *   4. Group by `${PREFIX} ${NUMBER}` (matching the section corpus's prefix/number
 *      key shape) and emit data/ak/prereqs.json.
 *
 * Usage:
 *   npx tsx scripts/ak/scrape-catalog-prereqs.ts
 */
import { chromium, type Browser, type Page } from "playwright";
import * as fs from "fs";
import * as path from "path";

const SLUG = "ilisagvik-college";
const STATE = "ak";
const BASE = "https://catalog.ilisagvik.edu";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";
const DELAY_MS = 1500;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface ProgramsFile {
  programs: { catalog_url: string }[];
}

interface PrereqEntry {
  text: string;
  courses: string[];
}

/** Extract course codes referenced inside a prereq sentence. */
function extractCourseCodes(text: string): string[] {
  const set = new Set<string>();
  // Patterns like "MATH 055B", "ACC 101", "ENGL 100"
  const re = /\b([A-Z]{2,5})\s+(\d{2,4}[A-Z]?)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    set.add(`${m[1]} ${m[2]}`);
  }
  return [...set];
}

async function harvestCourseUrls(page: Page, programUrl: string): Promise<string[]> {
  await page.goto(programUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  // Course rows are <a href="/{program-slug}/{prefix-num}"> inside .degree-row.
  const hrefs = await page.$$eval(
    "a[href]",
    (anchors) =>
      anchors
        .map((a) => a.getAttribute("href") || "")
        // /accounting/acc-101 — exclude /accounting/certificate/* and the /accounting program root
        .filter((h) => /^\/[a-z0-9-]+\/[a-z]{2,5}-\d{2,4}[a-z]?$/i.test(h)),
  );
  return [...new Set(hrefs)];
}

async function scrapeCourse(page: Page, url: string): Promise<{
  code: string;
  prereqText: string | null;
} | null> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  const data = await page.evaluate(() => {
    const titleEl = document.querySelector(
      ".field--name-field-item.field--type-string, .page-title, h1",
    );
    const breadcrumb = document.querySelector(".breadcrumb")?.textContent || "";
    const url = window.location.pathname;
    const codeSlug = url.split("/").filter(Boolean).pop() || "";
    const prereqEl = document.querySelector(".field--name-field-pr");
    const prereqText = prereqEl ? (prereqEl.textContent || "").trim() : "";
    return { codeSlug, prereqText, breadcrumb, title: titleEl?.textContent?.trim() ?? "" };
  });

  // codeSlug is "acc-101" — split on the last hyphen before the digits
  const m = data.codeSlug.match(/^([a-z]{2,5})-(\d{2,4}[a-z]?)$/i);
  if (!m) return null;
  const code = `${m[1].toUpperCase()} ${m[2].toUpperCase()}`;
  return {
    code,
    prereqText: data.prereqText ? data.prereqText : null,
  };
}

async function main() {
  const programsPath = path.join(process.cwd(), "data", STATE, "programs", `${SLUG}.json`);
  if (!fs.existsSync(programsPath)) {
    throw new Error(`Programs file missing: ${programsPath}. Run scrape-programs.ts first.`);
  }
  const programs = (JSON.parse(fs.readFileSync(programsPath, "utf8")) as ProgramsFile).programs;
  console.log(`Ilisagvik catalog-prereq scraper — ${programs.length} programs`);

  const browser: Browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: UA });
  const page = await ctx.newPage();

  // Phase 1 — harvest course URLs from each program page.
  const courseUrls = new Set<string>();
  for (const p of programs) {
    process.stdout.write(`  prog ${p.catalog_url.replace(BASE, "")} ... `);
    try {
      const urls = await harvestCourseUrls(page, p.catalog_url);
      urls.forEach((u) => courseUrls.add(new URL(u, BASE).toString()));
      console.log(`${urls.length} course refs`);
    } catch (err) {
      console.log(`error: ${(err as Error).message}`);
    }
    await sleep(DELAY_MS);
  }
  console.log(`\n  Unique course URLs: ${courseUrls.size}\n`);

  // Phase 2 — fetch each course detail page and extract prereq text.
  const prereqs: Record<string, PrereqEntry> = {};
  let withPrereqs = 0;
  let i = 0;
  for (const url of courseUrls) {
    i += 1;
    process.stdout.write(`  [${i}/${courseUrls.size}] ${url.replace(BASE, "")} ... `);
    try {
      const result = await scrapeCourse(page, url);
      if (!result) {
        console.log("skip (bad slug)");
      } else if (!result.prereqText) {
        console.log("no prereq");
      } else {
        prereqs[result.code] = {
          text: result.prereqText,
          courses: extractCourseCodes(result.prereqText),
        };
        withPrereqs += 1;
        console.log(`prereq: "${result.prereqText.slice(0, 60)}..."`);
      }
    } catch (err) {
      console.log(`error: ${(err as Error).message}`);
    }
    await sleep(DELAY_MS);
  }

  await browser.close();

  const outPath = path.join(process.cwd(), "data", STATE, "prereqs.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(prereqs, null, 2) + "\n");

  console.log(`\nIlisagvik catalog prereqs: ${withPrereqs} courses with prereq text`);
  console.log(`  → ${path.relative(process.cwd(), outPath)}`);
}

main().catch((err) => {
  console.error("Catalog-prereq scraper failed:", err);
  process.exit(1);
});

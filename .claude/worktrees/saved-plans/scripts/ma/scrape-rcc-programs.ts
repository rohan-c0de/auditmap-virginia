/**
 * scrape-rcc-programs.ts — MA program scraper for Roxbury Community College.
 *
 * Closes #243. RCC publishes degree and certificate programs as plain
 * static HTML pages on their main marketing site:
 *
 *   https://www.rcc.mass.edu/learn/find-your-program/
 *     associate-in-arts/{slug}.html
 *     associate-in-science/{slug}.html
 *     associate-in-science/engineering/{slug}.html
 *     certificate-programs/{slug}.html
 *
 * Each program page has:
 *   <h1 class="hero-inner__title">Accounting</h1>
 *   <table class="simple-tables__item">
 *     <tr><th colspan="2">Semester One</th><th>Credits</th></tr>
 *     <tr><td>BUS101</td><td>Prin of Acct I</td><td>3.00</td></tr>
 *     ...
 *   </table>
 *   <table class="simple-tables__item">…</table>  // one per semester
 *
 * No CMS, no API — bespoke enough that this scraper stays in scripts/ma/
 * rather than going into the shared lib (no other college uses this layout).
 *
 * Usage:
 *   npx tsx scripts/ma/scrape-rcc-programs.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import type {
  CollegePrograms,
  ProgramCredential,
  ProgramRequirement,
  RequiredCourse,
  RequirementGroup,
} from "../../lib/types.js";

const BASE_URL = "https://www.rcc.mass.edu";
const COLLEGE_SLUG = "rcc";
const STATE = "ma";
const CATALOG_YEAR = "2025-2026";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const INDEX_PATHS = [
  { path: "/learn/find-your-program/associate-in-arts/", credential: "AA" as const },
  { path: "/learn/find-your-program/associate-in-science/", credential: "AS" as const },
  { path: "/learn/find-your-program/certificate-programs/", credential: "certificate" as const },
];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function fetchHtml(url: string): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (res.ok) return res.text();
    if (res.status >= 500) {
      await sleep(500 * Math.pow(2, attempt));
      continue;
    }
    return "";
  }
  return "";
}

/**
 * Walk a credential's index page and any subdirectory indexes to collect
 * all candidate program-page URLs (anything ending in .html under that
 * path). Returns a unique list of absolute URLs to try.
 */
async function collectCandidates(indexPath: string): Promise<string[]> {
  const seen = new Set<string>();
  const queue = [indexPath];
  const candidates = new Set<string>();

  while (queue.length) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);

    const html = await fetchHtml(`${BASE_URL}${current}`);
    if (!html) continue;
    const $ = cheerio.load(html);
    $("a[href]").each((_, a) => {
      const href = $(a).attr("href");
      if (!href) return;
      const clean = href.split("#")[0].split("?")[0];
      // Only follow paths under this credential subtree
      if (!clean.startsWith(indexPath)) return;
      if (clean === indexPath) return;
      // index.html in a sub-folder → enqueue the folder for further crawl
      if (clean.endsWith("/index.html")) {
        const subdir = clean.replace(/index\.html$/, "");
        queue.push(subdir);
        return;
      }
      // Trailing slash → another index
      if (clean.endsWith("/")) {
        queue.push(clean);
        return;
      }
      if (clean.endsWith(".html")) candidates.add(clean);
    });
  }

  return [...candidates];
}

// Filenames seen in subdirectories (nursing/, radiologic-technology/) that
// are *not* program pages — FAQs, faculty bios, clinical obligations, etc.
// Compared against the final URL segment so paths like
// /find-your-program/associate-in-science/nursing/faqs.html match while
// regular program pages don't.
const SKIP_FILENAMES = new Set([
  "general-education-requirements.html",
  "apply-to-nursing-programs.html",
  "rt-course-descriptions.html",
  "rt-mission-and-goals.html",
  "rt-technical-standards.html",
  "rt-program-requirements.html",
  "program-effectiveness-data.html",
  "clinical-obligations.html",
  "faculty-staff.html",
  "faqs.html",
]);

function looksLikeProgramSubpage(url: string): boolean {
  const last = url.split("/").pop()?.toLowerCase() ?? "";
  return SKIP_FILENAMES.has(last);
}

function splitCourseCode(
  raw: string,
): { prefix: string; number: string } | null {
  const code = raw.trim().replace(/\+$/, ""); // MAT103+ → MAT103
  const m = code.match(/^([A-Z]{2,5})(\d{3,4}[A-Z]?)$/);
  if (!m) return null;
  return { prefix: m[1], number: m[2] };
}

function parseCredits(text: string): number | null {
  const m = text.trim().match(/^(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function parseProgram(
  html: string,
  url: string,
  credential: ProgramCredential,
): ProgramRequirement | null {
  const $ = cheerio.load(html);
  const title = $(".hero-inner__title").first().text().replace(/\s+/g, " ").trim();
  if (!title) return null;

  const groups: RequirementGroup[] = [];
  $("table.simple-tables__item").each((_, table) => {
    const $table = $(table);
    // Group name from the first <th colspan="2">
    const headerCell = $table.find("tr").first().find("th").first();
    const groupName =
      headerCell.text().replace(/\s+/g, " ").trim() || "Required Courses";
    const courses: RequiredCourse[] = [];

    $table.find("tr").each((idx, tr) => {
      if (idx === 0) return; // header
      const tds = $(tr).find("td");
      if (tds.length < 3) return;
      const codeRaw = $(tds[0]).text().trim();
      const split = splitCourseCode(codeRaw);
      if (!split) return; // skip placeholder codes (DEVEDG, HUMELECT, etc.)
      const titleText = $(tds[1]).text().replace(/\s+/g, " ").trim();
      const credits = parseCredits($(tds[2]).text());
      // Drop zero-credit dev-ed / placeholder rows even when the code parses
      if (credits === 0) return;
      courses.push({
        prefix: split.prefix,
        number: split.number,
        title: titleText,
        credits,
        or_alternatives: [],
      });
    });

    if (courses.length > 0) {
      groups.push({
        name: groupName,
        credits_required: null,
        choose_n: null,
        courses,
      });
    }
  });

  if (groups.length === 0) return null;

  let total = 0;
  let any = false;
  for (const g of groups) {
    for (const c of g.courses) {
      if (c.credits !== null && c.credits > 0) {
        total += c.credits;
        any = true;
      }
    }
  }

  return {
    title,
    credential,
    program_code: null,
    catalog_url: url,
    total_credits: any ? total : null,
    gpa_minimum: 2.0,
    description: null,
    requirement_groups: groups,
    matched_program_slug: null,
  };
}

async function main() {
  const programs: ProgramRequirement[] = [];

  for (const { path: indexPath, credential } of INDEX_PATHS) {
    console.log(`Walking ${indexPath} (${credential})`);
    const urls = await collectCandidates(indexPath);
    console.log(`  Found ${urls.length} candidate page(s)`);
    let parsed = 0;
    for (const u of urls) {
      if (looksLikeProgramSubpage(u)) continue;
      const html = await fetchHtml(`${BASE_URL}${u}`);
      if (!html) continue;
      const program = parseProgram(html, `${BASE_URL}${u}`, credential);
      if (!program) continue;
      programs.push(program);
      parsed++;
      await sleep(80);
    }
    console.log(`  Parsed ${parsed} program(s)`);
  }

  // Dedupe by catalog_url (a program slug might appear under more than one
  // credential index if the site cross-links).
  const byUrl = new Map<string, ProgramRequirement>();
  for (const p of programs) byUrl.set(p.catalog_url, p);
  const unique = [...byUrl.values()];

  const { matched, unmatched } = applyProgramMatching(unique);
  console.log(
    `\nMatcher: ${matched} matched to registry slugs, ${unmatched} unmatched`,
  );

  const out: CollegePrograms = {
    college_slug: COLLEGE_SLUG,
    catalog_year: CATALOG_YEAR,
    catalog_url: `${BASE_URL}/learn/find-your-program/`,
    scraped_at: new Date().toISOString(),
    programs: unique,
  };

  const outDir = path.join(process.cwd(), "data", STATE, "programs");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${COLLEGE_SLUG}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`✓ Wrote ${unique.length} programs to ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

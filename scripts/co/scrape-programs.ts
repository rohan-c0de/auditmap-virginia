/**
 * scrape-programs.ts — degree/program requirements for CO.
 *
 * REWRITTEN 2026-06-11 from a live probe of all 15 colleges. The previous
 * auto-generated version guessed catalog hosts from college names and
 * pointed at the WRONG institutions (catalog.morgan.edu = Morgan State MD,
 * catalog.colorado.edu = CU Boulder, catalog.northeastern.edu =
 * Northeastern MA) — the failure mode the programs playbook warns about.
 *
 * Platform verdicts (catalog link discovered from each college's real
 * homepage; catalog.{domain} guesses are all dead for CCCS colleges):
 *
 *   Acalog:          aims (catalog.aims.edu), pueblo (catalog.pueblocc.edu)
 *   CourseLeaf:      ccd (catalog.ccd.edu — program pages live under
 *                    /programs-courses/academic-pathways/<pathway>/<program>/,
 *                    linked from /programs-courses/list-academic-programs/)
 *   SmartCatalogIQ:  frontrange, rrcc. NOTE: *.smartcatalogiq.com
 *                    wildcard-resolves — every other CO subdomain serves an
 *                    empty Sitecore shell on /catalogs and "Document Not
 *                    Found" under it; only these two render real content.
 *                    Their editions live at /en/current/ (not /en/{year}/)
 *                    and the site root 500s, so catalogYear is pinned to
 *                    "current" instead of auto-discovered.
 *   Bespoke Drupal:  arapahoe — native catalog at
 *                    arapahoe.edu/academics-programs/catalog/degrees-certificates,
 *                    paginated Drupal Views (?page=0..N, 50/page), course
 *                    blocks in .field_course / .field_course_text paragraphs
 *
 * Deferred (genuinely blocked as of 2026-06-11; re-probe before assuming
 * permanent — see memory feedback_refingerprint_stale_findings):
 *   ppsc, morgancc   — Cloudflare interactive challenge sitewide ("Just a
 *                      moment…"); needs a real-Chrome Playwright session
 *   cncc             — AWS WAF sitewide (HTTP 202 + 168-byte token page)
 *   lamarcc          — JS redirect wall (HTTP 307 loop on plain fetch)
 *   ccaurora, otero, trinidadstate, njc, coloradomtn
 *                    — sites render fine but no templated catalog found;
 *                      program info is scattered marketing pages
 *                      (e.g. njc.edu/program/…) with no requirement tables
 *                      located; each needs a per-college investigation
 *
 * Usage:
 *   npx tsx scripts/co/scrape-programs.ts
 *   npx tsx scripts/co/scrape-programs.ts --college frontrange
 */

import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import { scrapeAcalogPrograms } from "../lib/scrape-acalog-programs.js";
import { scrapeCourseleafPrograms } from "../lib/scrape-courseleaf-programs.js";
import { scrapeSmartCatalogIqPrograms } from "../lib/scrape-smartcatalogiq-programs.js";
import type {
  CollegePrograms,
  ProgramCredential,
  ProgramRequirement,
  RequirementGroup,
} from "../../lib/types";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const onlyCollege = (() => {
  const i = process.argv.indexOf("--college");
  return i >= 0 ? process.argv[i + 1] : null;
})();

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function run(
  slug: string,
  scrape: () => Promise<CollegePrograms>,
): Promise<void> {
  if (onlyCollege && !slug.includes(onlyCollege)) return;
  console.log(`\n=== ${slug} ===`);
  try {
    const data = await scrape();
    if (data.programs.length === 0) {
      console.log(`  No programs found for ${slug} — nothing written.`);
      return;
    }
    const { matched, unmatched } = applyProgramMatching(data.programs);
    console.log(`  Matcher: ${matched} matched / ${unmatched} unmatched`);
    const outDir = path.join(process.cwd(), "data", "co", "programs");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${slug}.json`);
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
    console.log(`  ✓ Wrote ${data.programs.length} programs → ${outPath}`);
  } catch (e) {
    console.error(`  ✗ ${slug} failed: ${e}`);
  }
}

// ---------------------------------------------------------------------------
// Arapahoe — bespoke Drupal catalog
// ---------------------------------------------------------------------------

const ACC_BASE = "https://arapahoe.edu";
const ACC_INDEX = "/academics-programs/catalog/degrees-certificates";

function accCredential(title: string, url: string): ProgramCredential {
  const t = `${title} ${url}`;
  if (/-aas\b|\bA\.?A\.?S\b|applied science/i.test(t)) return "AAS";
  if (/-aa\b|associate of arts/i.test(t)) return "AA";
  if (/-as\b|-aes\b|associate of (science|engineering)/i.test(t)) return "AS";
  if (/certificate|-cert\b/i.test(t)) return "certificate";
  return "other";
}

async function fetchHtml(url: string): Promise<string> {
  const resp = await fetch(url, { headers: { "User-Agent": UA } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
  return resp.text();
}

async function scrapeArapahoePrograms(): Promise<CollegePrograms> {
  // Enumerate via Drupal Views GET pagination — pages of 50 until exhausted.
  const links = new Set<string>();
  for (let page = 0; page < 20; page++) {
    const html = await fetchHtml(`${ACC_BASE}${ACC_INDEX}?page=${page}`);
    const before = links.size;
    const $ = cheerio.load(html);
    $(`a[href^="${ACC_INDEX}/"]`).each((_, el) => {
      const href = ($(el).attr("href") || "").split("#")[0].split("?")[0];
      // Program detail pages carry a catalog-year segment:
      // /academics-programs/catalog/degrees-certificates/2026-2027/accounting-aa
      if (/\/\d{4}-\d{4}\/[a-z0-9-]+$/.test(href)) links.add(href);
    });
    const added = links.size - before;
    console.log(`  index page ${page}: +${added} programs (${links.size} total)`);
    if (added === 0) break;
    await sleep(300);
  }

  const programs: ProgramRequirement[] = [];
  for (const link of [...links].sort()) {
    await sleep(250);
    let html: string;
    try {
      html = await fetchHtml(ACC_BASE + link);
    } catch (e) {
      console.error(`    ✗ ${link}: ${(e as Error).message}`);
      continue;
    }
    const $ = cheerio.load(html);
    const title = $("h1").first().text().trim();

    const groups: RequirementGroup[] = [];
    $(".paragraph--type--course-list").each((_, list) => {
      const $list = $(list);
      const name =
        $list.find("h2, h3").first().text().trim() ||
        $list.prevAll("h2, h3").first().text().trim() ||
        "Requirements";
      const group: RequirementGroup = {
        name: name.replace(/\s+/g, " "),
        credits_required: null,
        choose_n: null,
        courses: [],
      };
      $list.find(".paragraph--type--course-with-text-field").each((__, p) => {
        const courseText = $(p).find(".field_course a").first().text().trim();
        const m = courseText.match(
          /^([A-Z]{2,5})\s+([0-9]{3,4}[A-Z]?)\s*[-–—:]\s*(.+)$/,
        );
        if (!m) return;
        const creditsText = $(p).find(".field_course_text").first().text();
        const cm = creditsText.match(/([\d.]+)\s*Credits?/i);
        group.courses.push({
          prefix: m[1],
          number: m[2],
          title: m[3].trim(),
          credits: cm ? parseFloat(cm[1]) : null,
          or_alternatives: [],
        });
      });
      if (group.courses.length > 0) groups.push(group);
    });

    if (groups.length === 0) continue;
    const totalMatch = html.match(/Total[^<]{0,60}?([\d.]+)\s*Credits/i);
    programs.push({
      title,
      credential: accCredential(title, link),
      program_code: null,
      catalog_url: ACC_BASE + link,
      total_credits: totalMatch ? parseFloat(totalMatch[1]) : null,
      gpa_minimum: null,
      description: null,
      requirement_groups: groups,
      matched_program_slug: null,
    });
    console.log(`    + ${title} (${groups.length} groups)`);
  }

  return {
    college_slug: "arapahoe-community-college",
    catalog_year: "",
    catalog_url: ACC_BASE + ACC_INDEX,
    scraped_at: new Date().toISOString(),
    programs,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const ACALOG: { collegeSlug: string; baseUrl: string }[] = [
  { collegeSlug: "aims-community-college", baseUrl: "https://catalog.aims.edu" },
  { collegeSlug: "pueblo-community-college", baseUrl: "https://catalog.pueblocc.edu" },
];

const COURSELEAF = [
  {
    collegeSlug: "community-college-of-denver",
    baseUrl: "https://catalog.ccd.edu",
    programIndexPath: "/programs-courses/list-academic-programs/",
    // Program detail pages live under a DIFFERENT prefix than the index, so
    // use the pattern matcher instead of prefix discovery.
    programPathPattern:
      "^/programs-courses/academic-pathways/[a-z0-9-]+/[a-z0-9-]+/$",
  },
];

// frontrange's programs all sit under one TOC section; rrcc splits them
// across two top-level sections, scraped separately and merged below.
const SMARTCATALOGIQ = [
  {
    collegeSlug: "front-range-community-college",
    baseUrl: "https://frontrange.smartcatalogiq.com",
    catalogYear: "current",
    catalogPath: "catalog",
    programsPath: "program-information",
  },
  {
    // Program detail pages (degreeTitle + Heading1, the template's native
    // format) all nest under this section — the "associate-degrees-…" and
    // "bachelor-degrees-bas" TOC sections are just listing pages that link
    // into it.
    collegeSlug: "red-rocks-community-college",
    baseUrl: "https://rrcc.smartcatalogiq.com",
    catalogYear: "current",
    catalogPath: "catalog",
    programsPath: "academic-programs-and-areas-of-study",
  },
];

async function main() {
  console.log("CO program scraper");

  for (const c of ACALOG) {
    await run(c.collegeSlug, () =>
      scrapeAcalogPrograms({
        collegeSlug: c.collegeSlug,
        baseUrl: c.baseUrl,
        catoidFallback: 0,
        programNavoids: [],
        autoDiscoverCatoid: true,
        useSearchDiscovery: true,
      }),
    );
  }

  for (const c of COURSELEAF) {
    await run(c.collegeSlug, () =>
      scrapeCourseleafPrograms({
        collegeSlug: c.collegeSlug,
        baseUrl: c.baseUrl,
        programIndexPath: c.programIndexPath,
        programPathPattern: c.programPathPattern,
      }),
    );
  }

  // SmartCatalogIQ — scrape each configured section, merge per college slug,
  // then write once via run().
  const sciqBySlug = new Map<string, CollegePrograms>();
  for (const c of SMARTCATALOGIQ) {
    if (onlyCollege && !c.collegeSlug.includes(onlyCollege)) continue;
    console.log(`\n=== ${c.collegeSlug} (${c.programsPath}) ===`);
    try {
      const data = await scrapeSmartCatalogIqPrograms({
        collegeSlug: c.collegeSlug,
        baseUrl: c.baseUrl,
        catalogYear: c.catalogYear,
        catalogPath: c.catalogPath,
        programsPath: c.programsPath,
      });
      console.log(`  section yielded ${data.programs.length} programs`);
      const existing = sciqBySlug.get(c.collegeSlug);
      if (existing) {
        existing.programs.push(...data.programs);
      } else {
        sciqBySlug.set(c.collegeSlug, data);
      }
    } catch (e) {
      console.error(`  ✗ ${c.collegeSlug} (${c.programsPath}) failed: ${e}`);
    }
  }
  for (const [slug, data] of sciqBySlug) {
    await run(slug, async () => data);
  }

  await run("arapahoe-community-college", scrapeArapahoePrograms);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

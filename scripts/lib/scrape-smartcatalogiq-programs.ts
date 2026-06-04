/**
 * scrape-smartcatalogiq-programs.ts — shared Smart Catalog IQ program scraper.
 *
 * Smart Catalog IQ catalogs publish programs at URLs like
 *   https://{college}.smartcatalogiq.com/en/{year}/{catalogPath}/{programsPath}/
 * The programs index links to subject-area pages, which in turn link to
 * individual program detail pages with the structure:
 *
 *   <h1 class="degreeTitle">Computer Science (A.S.)</h1>
 *   <p class="sc-BodyTextNS">Associate in Science</p>
 *   …
 *   <h3 class="sc-RequiredCoursesHeading1">Program Courses</h3>
 *   <table>
 *     <tr><td class="sc-coursenumber"><a class="sc-courselink">CIS-102</a></td>
 *         <td class="sc-coursetitle">Fundamental Computer Literacy</td>
 *         <td class="sc-credits"><p class="credits">4</p></td></tr>
 *     …
 *     <tr><td class="sc-totalcreditslabel" colspan="2">Total Credit Hours:</td>
 *         <td class="sc-totalcredits">46</td></tr>
 *   </table>
 *   <h3 class="sc-RequiredCoursesHeading1">General Education Courses</h3>
 *   <table>…</table>
 *
 * Each <h3> + <table> pair becomes one RequirementGroup. Different colleges
 * use slightly different paths (catalogPath="catalog" vs "college-catalog"
 * vs "credit-catalog"; programsPath="programs-of-study" vs "credit-programs"
 * vs "academic-programs"), so both are configurable.
 */

import * as cheerio from "cheerio";
// AnyNode is exported from domhandler (cheerio's underlying DOM lib) but
// isn't re-exported as `cheerio.AnyNode` in cheerio 1.2 — import directly.
import type { AnyNode } from "domhandler";
import type {
  CollegePrograms,
  ProgramCredential,
  ProgramRequirement,
  RequiredCourse,
  RequirementGroup,
} from "../../lib/types.js";

export interface SmartCatalogIqProgramConfig {
  collegeSlug: string;
  /** Catalog root, e.g. https://berkshirecc.smartcatalogiq.com (no trailing slash). */
  baseUrl: string;
  /** Optional explicit catalog year, e.g. "2025-2026". Auto-discovered if omitted. */
  catalogYear?: string;
  /** Catalog path segment, default "catalog". */
  catalogPath?: string;
  /** Programs index path segment, default "programs-of-study". */
  programsPath?: string;
  /**
   * When true, the link-follower matches hrefs that START WITH programsRoot
   * minus its trailing slash — catching sibling paths like
   * "programs-of-study-business-..." in addition to normal child paths like
   * "programs-of-study/accounting". Needed for colleges (e.g. gntc) that
   * organise programs in flat sibling paths rather than subdirectories.
   */
  followSiblingPaths?: boolean;
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CONCURRENCY = 6;
const DELAY_MS = 80;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function retryFetch(
  url: string,
  label: string,
  attempts = 3,
): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const u = new URL(url);
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: `${u.protocol}//${u.host}/`,
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "same-origin",
          "Upgrade-Insecure-Requests": "1",
        },
      });
      if (res.ok) return res.text();
      if (res.status >= 500) lastErr = new Error(`HTTP ${res.status}`);
      else return "";
    } catch (e) {
      lastErr = e;
    }
    await sleep(500 * Math.pow(2, i));
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastErr}`);
}

async function pmap<T, R>(
  items: T[],
  n: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      try {
        results[idx] = await fn(items[idx], idx);
      } catch (e) {
        console.error(`  pmap[${idx}] error: ${e}`);
        results[idx] = undefined as unknown as R;
      }
      if (DELAY_MS > 0) await sleep(DELAY_MS);
    }
  }
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

// ---------------------------------------------------------------------------
// Step 1: discover the latest catalog year + path on the college homepage
// ---------------------------------------------------------------------------

async function probeUrl(baseUrl: string, path: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "HEAD",
      headers: { "User-Agent": UA },
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function discoverLatestCatalog(
  baseUrl: string,
  configCatalogPath: string | undefined,
  programsPath: string,
): Promise<{ year: string; catalogPath: string }> {
  const html = await retryFetch(`${baseUrl}/`, "homepage");
  const $ = cheerio.load(html);

  // Collect all href="/en/{year}/{path}" links and pick the highest year.
  // Prefer "{year}-updated" suffixes when present (some colleges publish a
  // mid-year revision). Fallback to "{year}" otherwise.
  type Found = { year: string; updated: boolean; path: string };
  const found: Found[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const m = href.match(/^\/en\/(\d{4}-\d{4})(-updated)?\/([^/?#]+)/);
    if (!m) return;
    found.push({ year: m[1], updated: !!m[2], path: m[3] });
  });
  if (found.length === 0) {
    throw new Error(`Could not discover catalog year on ${baseUrl}`);
  }
  // Pick highest end-year. Tie-break: prefer updated; otherwise prefer the
  // configured catalogPath if any matches.
  found.sort((a, b) => {
    const aEnd = parseInt(a.year.split("-")[1], 10);
    const bEnd = parseInt(b.year.split("-")[1], 10);
    if (aEnd !== bEnd) return bEnd - aEnd;
    if (a.updated !== b.updated) return a.updated ? -1 : 1;
    return 0;
  });
  const top = found[0];
  const sameYear = found.filter(
    (f) => f.year === top.year && f.updated === top.updated,
  );
  const preferred = configCatalogPath
    ? sameYear.find((f) => f.path === configCatalogPath)
    : null;
  const chosen = preferred ?? top;
  const yearWithSuffix = chosen.year + (chosen.updated ? "-updated" : "");

  // Some SmartCatalogIQ instances (e.g. northshore) link from the homepage
  // to "/en/{year}/{path}" but the actual catalog children live at
  // "/en/{year}/{year}-{path}". The catalog root may itself return 200 in
  // both cases — what differs is whether children resolve. Probe the actual
  // programs page to decide.
  const directPrograms = `/en/${yearWithSuffix}/${chosen.path}/${programsPath}/`;
  const yearPrefixedPrograms = `/en/${yearWithSuffix}/${chosen.year}-${chosen.path}/${programsPath}/`;
  const directOk = await probeUrl(baseUrl, directPrograms);
  if (!directOk) {
    const prefixedOk = await probeUrl(baseUrl, yearPrefixedPrograms);
    if (prefixedOk) {
      return { year: yearWithSuffix, catalogPath: `${chosen.year}-${chosen.path}` };
    }
  }
  return { year: yearWithSuffix, catalogPath: chosen.path };
}

// ---------------------------------------------------------------------------
// Step 2: from the programs index, recursively discover all program detail pages
// ---------------------------------------------------------------------------

async function discoverProgramPaths(
  baseUrl: string,
  programsRoot: string,
  followSiblingPaths = false,
  maxPages = Infinity,
): Promise<string[]> {
  const visited = new Set<string>();
  const programLinks = new Set<string>();
  const queue: string[] = [programsRoot];

  // When followSiblingPaths is true, match hrefs that start with the root
  // without its trailing slash — catching sibling paths like
  // "programs-of-study-business-..." in addition to child paths.
  const rootPrefix = followSiblingPaths
    ? programsRoot.replace(/\/$/, "")
    : programsRoot;

  while (queue.length > 0) {
    // Backstop on broad-BFS fallback runs (see scrapeSmartCatalogIqPrograms) so a
    // huge catalog can't run forever. Working colleges' primary BFS leaves this
    // at the default Infinity — same control flow as before.
    if (visited.size >= maxPages) break;
    const path = queue.shift()!;
    if (visited.has(path)) continue;
    visited.add(path);
    const html = await retryFetch(`${baseUrl}${path}`, `discover ${path}`);
    if (!html) continue;
    const $ = cheerio.load(html);

    // A program detail page has <h1 class="degreeTitle"> on it.
    if ($("h1.degreeTitle").length > 0) {
      programLinks.add(path);
      continue;
    }

    // Otherwise treat as a subject-area page; queue its children.
    $(`a[href^="${rootPrefix}"]`).each((_, el) => {
      const href = ($(el).attr("href") || "").split("#")[0].split("?")[0];
      if (!href) return;
      if (href === programsRoot) return;
      if (href === programsRoot.replace(/\/$/, "")) return;
      if (visited.has(href)) return;
      if (!href.startsWith(rootPrefix)) return;
      queue.push(href);
    });
    await sleep(80);
  }

  return Array.from(programLinks).sort();
}

// ---------------------------------------------------------------------------
// Step 3: classify a credential string
// ---------------------------------------------------------------------------

function parseCredential(text: string): ProgramCredential {
  const t = text.toLowerCase();
  if (/(applied science|a\.a\.s\.?|aas)/.test(t)) return "AAS";
  if (/(associate in arts|a\.a\.?\b|associate of arts)/.test(t)) return "AA";
  if (/(associate in science|a\.s\.?\b|associate of science)/.test(t)) return "AS";
  if (/diploma/.test(t)) return "diploma";
  if (/certificate/.test(t)) return "certificate";
  return "other";
}

// ---------------------------------------------------------------------------
// Step 4: parse a SmartCatalogIQ program page
// ---------------------------------------------------------------------------

function parseProgramTable(
  $: cheerio.CheerioAPI,
  $table: cheerio.Cheerio<AnyNode>,
): { courses: RequiredCourse[]; totalCredits: number | null } {
  const courses: RequiredCourse[] = [];
  let totalCredits: number | null = null;
  const seen = new Set<string>();

  $table.find("tr").each((_, row) => {
    const $row = $(row);
    // Total row: <td class="sc-totalcreditslabel">Total Credit Hours:</td><td class="sc-totalcredits">46</td>
    const $totalLabel = $row.find("td.sc-totalcreditslabel").first();
    if ($totalLabel.length) {
      const txt = $row.find("td.sc-totalcredits").first().text().trim();
      const m = txt.match(/(\d+)(?:\s*-\s*(\d+))?/);
      if (m) totalCredits = parseInt(m[2] ?? m[1], 10);
      return;
    }
    const $code = $row.find("td.sc-coursenumber").first();
    const $title = $row.find("td.sc-coursetitle").first();
    const $cred = $row.find("td.sc-credits").first();
    if (!$code.length || !$title.length) return;

    const $link = $code.find("a.sc-courselink").first();
    if (!$link.length) return; // narrative placeholders ("ENG-", "Professional Elective" without a code) — skip
    const codeText = $link.text().trim();
    // Course codes appear as either "CIS-102" / "CIS 102" (berkshire) or
    // "ACC101" (necc, no separator). Accept both.
    const m = codeText.match(/^([A-Z]{2,5})[\s-]?(\d{2,4}[A-Z]?)/);
    if (!m) return;
    const [, prefix, number] = m;

    const titleText = $title.text().replace(/\s+/g, " ").trim();
    // Credits live in <td class="sc-credits"> on berkshire and northshore,
    // but on necc the credits-bearing td has no class — fall back to the
    // first p.credits anywhere in the row.
    const credText = (
      $cred.length
        ? $cred.text()
        : $row.find("p.credits").first().text()
    )
      .replace(/\s+/g, " ")
      .trim();
    const credMatch = credText.match(/^(\d+)/);
    const credits = credMatch ? parseInt(credMatch[1], 10) : 0;

    const key = `${prefix} ${number}`;
    if (seen.has(key)) return;
    seen.add(key);
    courses.push({
      prefix,
      number,
      title: titleText,
      credits,
      or_alternatives: [],
    });
  });

  return { courses, totalCredits };
}

function parseProgramPage(
  html: string,
  pageUrl: string,
): ProgramRequirement | null {
  const $ = cheerio.load(html);
  const $title = $("h1.degreeTitle").first();
  if (!$title.length) return null;
  const title = $title.text().replace(/\s+/g, " ").trim();
  if (!title) return null;

  // The credential lives in one of four places, depending on which
  // SmartCatalogIQ college, and the parenthetical can be misleading
  // (northshore puts a program code there). Try each in priority order
  // and only accept the result if it actually classifies to a credential
  // — otherwise fall through to the next.
  let credential: ProgramCredential = "other";
  const tryAssign = (txt: string): boolean => {
    if (credential !== "other") return true;
    const c = parseCredential(txt);
    if (c !== "other") {
      credential = c;
      return true;
    }
    return false;
  };

  // 1. <p class="sc-BodyTextNS"> after the h1 (berkshire)
  $title.nextAll("p.sc-BodyTextNS").each((_, el) => {
    const t = $(el).text().trim();
    if (/(associate|certificate|diploma|degree)/i.test(t)) tryAssign(t);
  });

  // 2. comma-suffix in the h1 itself (necc — "Accounting, Associate in Science")
  if (credential === "other") {
    const comma = title.match(
      /,\s*((?:Associate (?:in|of) [A-Za-z ]+|Certificate(?:\s+of\s+[A-Za-z]+)?|Diploma)[^,]*)$/i,
    );
    if (comma) tryAssign(comma[1].trim());
  }

  // 3. parenthetical at end of h1 (berkshire — "(A.S.)") — but only accept if
  //    it actually classifies; northshore puts program codes here like "(CAN)"
  if (credential === "other") {
    const paren = title.match(/\(([^)]+)\)\s*$/);
    if (paren) tryAssign(paren[1]);
  }

  // 4. Bare credential keyword anywhere in the title
  //    ("Cannabis Certificate (CAN)" → "Certificate")
  if (credential === "other") {
    const inTitle = title.match(/\b(Certificate|Diploma)\b/i);
    if (inTitle) tryAssign(inTitle[1]);
  }


  // Each h3.sc-RequiredCoursesHeading1 introduces a requirement group; the
  // table that follows (its next sibling table) holds the courses. Smart
  // Catalog IQ also renders a sample "First Semester / Second Semester / …"
  // sequence using the same h3 heading style — those are duplicates of the
  // requirement courses presented as a recommended path. Skip them so
  // total_credits doesn't double-count.
  const isSequenceHeading = (name: string): boolean =>
    /^(First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth)\s+(Semester|Year)\b/i.test(
      name,
    ) ||
    /^Semester\s+\d+/i.test(name) ||
    /^Year\s+\d+/i.test(name);

  const groups: RequirementGroup[] = [];
  let totalCreditsAggregate = 0;
  let sawAnyTotal = false;

  $("h3.sc-RequiredCoursesHeading1").each((_, h3) => {
    const $h3 = $(h3);
    const groupName = $h3.text().replace(/\s+/g, " ").trim() || "Required Courses";
    if (isSequenceHeading(groupName)) return;
    // Walk forward to the next table at the same level
    let $sibling = $h3.next();
    while (
      $sibling.length &&
      !$sibling.is("table") &&
      !$sibling.is("h3.sc-RequiredCoursesHeading1") &&
      !$sibling.is("h2")
    ) {
      $sibling = $sibling.next();
    }
    if (!$sibling.is("table")) return;
    const { courses, totalCredits } = parseProgramTable($, $sibling);
    if (courses.length === 0 && totalCredits === null) return;
    groups.push({
      name: groupName,
      credits_required: totalCredits,
      choose_n: null,
      courses,
    });
    if (totalCredits !== null) {
      totalCreditsAggregate += totalCredits;
      sawAnyTotal = true;
    }
  });

  if (groups.length === 0) return null;

  // If the catalog didn't render an explicit "Total Credit Hours" row, fall
  // back to summing course-level credits across groups. This is what
  // northshore's "guided pathway" pages need.
  let finalTotalCredits: number | null = sawAnyTotal
    ? totalCreditsAggregate
    : null;
  if (finalTotalCredits === null) {
    let sum = 0;
    let hasAny = false;
    for (const g of groups) {
      for (const c of g.courses) {
        if (c.credits !== null && c.credits > 0) {
          sum += c.credits;
          hasAny = true;
        }
      }
    }
    if (hasAny) finalTotalCredits = sum;
  }

  // Credit-hour sanity override (same heuristic as the CourseLeaf scraper):
  // programs with ≥ 50 credit hours that come back as Certificate or Other
  // are virtually always associate degrees in disguise — the title or
  // catalog text just didn't make the credential explicit.
  if (
    finalTotalCredits !== null &&
    finalTotalCredits >= 50 &&
    ((credential as ProgramCredential) === "certificate" ||
      (credential as ProgramCredential) === "other")
  ) {
    credential = "AS";
  }

  return {
    title,
    credential,
    program_code: null,
    catalog_url: pageUrl,
    total_credits: finalTotalCredits,
    gpa_minimum: 2.0,
    description: null,
    requirement_groups: groups,
    matched_program_slug: null,
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function scrapeSmartCatalogIqPrograms(
  config: SmartCatalogIqProgramConfig,
): Promise<CollegePrograms> {
  const { collegeSlug, baseUrl } = config;
  const programsPath = config.programsPath ?? "programs-of-study";

  let year = config.catalogYear;
  let catalogPath = config.catalogPath ?? "catalog";

  if (!year) {
    console.log(`  [${collegeSlug}] Discovering latest catalog year on ${baseUrl}`);
    const discovered = await discoverLatestCatalog(
      baseUrl,
      config.catalogPath,
      programsPath,
    );
    year = discovered.year;
    // Always prefer the discovered catalogPath (it's been probed for 200 OK
    // and may include a year-prefix that the config didn't anticipate).
    catalogPath = discovered.catalogPath;
  }
  console.log(`  [${collegeSlug}] catalog year=${year} path=${catalogPath}`);

  const programsRoot = `/en/${year}/${catalogPath}/${programsPath}/`;
  console.log(`  [${collegeSlug}] Walking ${programsRoot} for program detail pages...`);
  let paths = await discoverProgramPaths(baseUrl, programsRoot, config.followSiblingPaths ?? false);
  console.log(`  [${collegeSlug}] Found ${paths.length} program detail pages`);

  // Fallback: some SmartCatalogIQ catalogs (phsc: /academic-programs/ → /prog-desc/)
  // place program detail pages in a SIBLING URL tree under the catalog root —
  // outside the configured programsPath, so the primary BFS finds nothing.
  // When that happens, walk the broader catalog root (/en/{year}/{catalogPath}/)
  // with a hard page cap so a huge catalog can't run away. Page-detail gate is
  // unchanged (<h1 class="degreeTitle">), so this only adds reach, never noise.
  // Working catalogs never enter this branch — the primary BFS always finds >0.
  if (paths.length === 0) {
    const catalogRoot = `/en/${year}/${catalogPath}/`;
    console.log(
      `  [${collegeSlug}] No programs at ${programsRoot}; falling back to broader BFS at ${catalogRoot} (cap 500)`,
    );
    paths = await discoverProgramPaths(baseUrl, catalogRoot, false, 500);
    console.log(`  [${collegeSlug}] Fallback found ${paths.length} program detail pages`);
  }

  if (paths.length === 0) {
    return {
      college_slug: collegeSlug,
      catalog_year: year,
      catalog_url: `${baseUrl}${programsRoot}`,
      scraped_at: new Date().toISOString(),
      programs: [],
    };
  }

  const programs: ProgramRequirement[] = [];
  let parsed = 0;
  let skipped = 0;
  await pmap(paths, CONCURRENCY, async (path) => {
    const url = `${baseUrl}${path}`;
    const html = await retryFetch(url, `program(${path})`);
    if (!html) {
      skipped++;
      return;
    }
    const program = parseProgramPage(html, url);
    if (!program) {
      skipped++;
      return;
    }
    programs.push(program);
    parsed++;
  });
  console.log(
    `  [${collegeSlug}] Parsed ${parsed} programs, skipped ${skipped}`,
  );

  return {
    college_slug: collegeSlug,
    catalog_year: year,
    catalog_url: `${baseUrl}${programsRoot}`,
    scraped_at: new Date().toISOString(),
    programs,
  };
}

/**
 * scrape-coursedog.ts (catalog template)
 *
 * Scrapes Coursedog tenant catalogs for course definitions + prereqs.
 *
 * Important scope distinction: Coursedog is a curriculum/catalog platform,
 * not a class-section scheduler. Coursedog colleges typically run their
 * actual class registration on Banner / Colleague / PeopleSoft, with
 * Coursedog providing the published course-catalog metadata only. So this
 * template emits course CATALOG data (code, title, credits, description,
 * prereqs) rather than per-term sections (CRN, instructor, schedule).
 *
 * Where this fits in the auto-add-state pipeline:
 *   - NOT a Phase 2 (course-section) scraper. Coursedog has no sections.
 *   - IS a Phase 4 (prereq) data source. Many Banner 8 colleges have a
 *     Coursedog catalog alongside; scraping it fills in the prereqs that
 *     Banner 8's search endpoint doesn't expose.
 *   - Output: data/{state}/coursedog-catalog/{slug}.json — used by the
 *     orchestrator to enrich prereqs.json and to provide a fallback
 *     course-list when sections aren't scrapable at all.
 *
 * Strictly additive — this is a new file. The existing
 * scripts/lib/scrape-coursedog-programs.ts (programs/degree requirements)
 * is unchanged.
 *
 * Usage as a library:
 *   import { scrapeCoursedogCatalog } from "../lib/scrape-coursedog";
 *   const r = await scrapeCoursedogCatalog({
 *     state: "ny",
 *     slug: "bmcc",
 *     catalogDomain: "bmcc.catalog.cuny.edu",
 *   });
 *
 * Smoke CLI:
 *   npx tsx scripts/lib/scrape-coursedog.ts --smoke \
 *     --domain catalog.nwfsc.edu --slug nwfsc --state fl
 */

import * as fs from "fs";
import * as path from "path";
import { chromium, type Browser, type Page } from "playwright";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CoursedogCourse {
  /** "ACG" (parsed from `code` like "ACG 2021"). */
  prefix: string;
  /** "2021" (digits + optional trailing letter). */
  number: string;
  /** Catalog title from `name` / `longName`. */
  title: string;
  /** Credit hours (max if range present). */
  credits: number | null;
  /** Catalog description, trimmed. */
  description: string;
  /** Human-readable prereq sentence ("ACG 2011 (min C) and BUL 2241"). */
  prerequisite_text: string | null;
  /** Course codes referenced in the requisites, deduped. */
  prerequisite_courses: string[];
}

export interface ScrapeCoursedogOptions {
  state: string;
  slug: string;
  /** Catalog hostname, e.g. "catalog.nwfsc.edu". No protocol, no path. */
  catalogDomain: string;
  /** When true, skip the JSON write — used by --smoke. */
  dryRun?: boolean;
  /** When true, suppress per-page progress output. */
  silent?: boolean;
  /** Page size for the courses-search request. Default 200. */
  pageSize?: number;
}

export interface ScrapeCoursedogResult {
  state: string;
  slug: string;
  catalogDomain: string;
  tenantId: string | null;
  catalogId: string | null;
  coursesCount: number;
  withPrereqs: number;
  courses: CoursedogCourse[];
  outputPath: string | null;
  error?: string;
}

// ---------------------------------------------------------------------------
// Coursedog API types (subset)
// ---------------------------------------------------------------------------

interface CoursedogRequisiteRule {
  condition?: string;
  credits?: number;
  restriction?: { selectN?: number; minimumCredits?: number };
  value?: {
    condition?: string;
    values?: Array<{ value: string[] | string; logic?: string }>;
    subSelections?: unknown[];
  };
  subRules?: CoursedogRequisiteRule[];
  gradeType?: string;
  grade?: string;
}

interface CoursedogRequisiteGroup {
  name?: string;
  type?: string;
  rules?: CoursedogRequisiteRule[];
}

interface CoursedogCourseDoc {
  _id: string;
  code?: string;
  subjectCode?: string;
  courseNumber?: string;
  name?: string;
  longName?: string;
  description?: string;
  credits?: { creditHours?: { min?: number; max?: number; operator?: string } };
  // Coursedog wraps requisites in either `requisites.requisitesSimple` (the
  // common shape) or sometimes flat at the top level. We try both.
  requisites?: {
    requisitesSimple?: CoursedogRequisiteGroup[];
  };
}

interface CourseSearchResponse {
  data: CoursedogCourseDoc[];
  listLength: number;
}

// ---------------------------------------------------------------------------
// Session capture (Playwright)
// ---------------------------------------------------------------------------

async function captureSession(
  page: Page,
  catalogDomain: string,
  silent: boolean
): Promise<{ tenantId: string; catalogId: string } | null> {
  let tenantId: string | null = null;
  let catalogId: string | null = null;

  const handler = (req: { url(): string }) => {
    const u = req.url();
    // Both endpoints carry tenant in the path; courses/search hits first
    // when the user lands on /courses.
    const m =
      u.match(/app\.coursedog\.com\/api\/v1\/cm\/([^/]+)\/courses\/search/) ||
      u.match(/app\.coursedog\.com\/api\/v1\/cm\/([^/]+)\/programs\/search/);
    if (m && !tenantId) tenantId = m[1];
    const cm = u.match(/catalogId=([^&]+)/);
    if (cm && !catalogId) catalogId = decodeURIComponent(cm[1]);
  };
  page.on("request", handler);

  try {
    await page.goto(`https://${catalogDomain}/courses`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
  } catch (e) {
    if (!silent) {
      console.warn(`  goto error: ${(e as Error).message}`);
    }
  }

  // Spin up to 30 seconds (60 ticks × 500ms) waiting for the API call to fire.
  for (let i = 0; i < 60 && (!tenantId || !catalogId); i++) {
    await page.waitForTimeout(500);
  }
  page.off("request", handler);

  if (!tenantId || !catalogId) return null;
  return { tenantId, catalogId };
}

// ---------------------------------------------------------------------------
// Course-list paging
// ---------------------------------------------------------------------------

const COURSES_FILTER_BODY = {
  condition: "AND",
  filters: [
    {
      filters: [
        {
          condition: "field",
          name: "status",
          inputType: "select",
          group: "course",
          type: "is",
          value: "Active",
        },
      ],
      condition: "and",
    },
  ],
};

async function listAllCourses(
  page: Page,
  tenantId: string,
  catalogId: string,
  pageSize: number,
  log: (m: string) => void
): Promise<CoursedogCourseDoc[]> {
  const all: CoursedogCourseDoc[] = [];
  let skip = 0;
  while (true) {
    const url =
      `https://app.coursedog.com/api/v1/cm/${tenantId}/courses/search/%24filters` +
      `?catalogId=${encodeURIComponent(catalogId)}` +
      `&skip=${skip}&limit=${pageSize}` +
      `&orderBy=courseGroupId.code`;

    const result = await page.evaluate(
      async ({ u, b }) => {
        const r = await fetch(u, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-requested-with": "catalog",
            Accept: "application/json",
          },
          body: JSON.stringify(b),
        });
        return { status: r.status, body: await r.text() };
      },
      { u: url, b: COURSES_FILTER_BODY }
    );

    if (result.status !== 200) {
      log(`  Search request returned HTTP ${result.status}; stopping.`);
      break;
    }
    const data = JSON.parse(result.body) as CourseSearchResponse;
    const batch = data.data ?? [];
    all.push(...batch);
    log(`  fetched ${all.length}/${data.listLength ?? "?"}`);
    if (batch.length < pageSize) break;
    skip += pageSize;
  }
  return all;
}

// ---------------------------------------------------------------------------
// Requisite tree → human-readable prereq text + course IDs
// ---------------------------------------------------------------------------

function walkRequisites(
  rules: CoursedogRequisiteRule[] | undefined,
  ids: Set<string>
): void {
  if (!rules) return;
  for (const rule of rules) {
    if (rule.value?.condition === "courses") {
      for (const v of rule.value.values ?? []) {
        const arr = Array.isArray(v.value) ? v.value : [v.value];
        for (const id of arr) {
          if (typeof id === "string" && id.length > 0) ids.add(id);
        }
      }
    }
    walkRequisites(rule.subRules, ids);
    if (rule.value && Array.isArray(rule.value.subSelections)) {
      for (const sub of rule.value.subSelections) {
        if (typeof sub === "object" && sub !== null && "rules" in sub) {
          walkRequisites(
            (sub as { rules?: CoursedogRequisiteRule[] }).rules,
            ids
          );
        }
      }
    }
  }
}

/** Resolve internal courseGroupIds back to "PREFIX NUMBER" using a course
 *  lookup. The Coursedog response keys courses as
 *  "{groupId}-{effectiveDate}"; strip the date suffix.
 */
async function resolveCourseIds(
  page: Page,
  tenantId: string,
  ids: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const chunkSize = 60;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize).join(",");
    const url =
      `https://app.coursedog.com/api/v1/cm/${tenantId}/courses` +
      `?courseGroupIds=${encodeURIComponent(chunk)}`;
    const result = await page.evaluate(async (u) => {
      const r = await fetch(u, {
        headers: {
          "x-requested-with": "catalog",
          Accept: "application/json",
        },
      });
      return { status: r.status, body: await r.text() };
    }, url);
    if (result.status !== 200) continue;
    const map = JSON.parse(result.body) as Record<string, CoursedogCourseDoc>;
    for (const [k, doc] of Object.entries(map)) {
      const bare = k.replace(/-\d{4}-\d{2}-\d{2}$/, "");
      const code = doc.code?.trim();
      if (code) out.set(bare, code);
    }
  }
  return out;
}

/**
 * Extract prereqs from a course doc. Tries two paths:
 *
 *   1. Structured tree (`requisites.requisitesSimple`). Some Coursedog
 *      tenants populate this with course-group-id references; we walk it
 *      and resolve via `idToCode` to get human-readable codes.
 *
 *   2. Description text fallback. Many tenants (NWFSC observed; common
 *      across Coursedog → Banner integrations) leave the structured tree
 *      empty and put prereqs as free text in `description`:
 *        "Prerequisite: ENC 1101 with a grade of C or better."
 *      A regex catches "Prerequisite[s]?: ..." through end-of-sentence and
 *      pulls course codes out of the captured text.
 *
 * If neither path finds anything, returns null/[].
 */
function extractPrereqs(
  doc: CoursedogCourseDoc,
  idToCode: Map<string, string>
): { text: string | null; courses: string[] } {
  // Path 1: structured tree
  const groups = doc.requisites?.requisitesSimple ?? [];
  if (groups.length > 0) {
    const ids = new Set<string>();
    for (const g of groups) walkRequisites(g.rules, ids);
    const courses: string[] = [];
    for (const id of ids) {
      const code = idToCode.get(id);
      if (code) courses.push(code);
    }
    if (courses.length > 0) {
      // Best-effort flat sentence — joining with " and " is technically a
      // simplification (Coursedog's tree can express "or" / "choose N of"
      // structures), but the orchestrator only consumes the course list
      // and the text is for human-readable display. Match Banner SSB /
      // Colleague template output shape.
      return { text: courses.join(" and "), courses };
    }
  }

  // Path 2: description-text fallback
  const desc = doc.description ?? "";
  // Match "Prerequisite:", "Prerequisites:", "PREREQUISITE:" etc., then
  // capture text until the next double-newline or paragraph break.
  const m = desc.match(/[Pp]rerequisite[s]?:\s*([^\n]{1,400})/);
  if (!m) return { text: null, courses: [] };
  const sentence = m[1].trim().replace(/\s+/g, " ");

  // Extract course codes from the sentence — both spaced ("ENC 1101") and
  // unspaced ("ENC1101"). The former is the catalog-display convention;
  // the latter is Banner-style. Normalize both to "PREFIX NUMBER".
  const codeRe = /\b([A-Z]{2,5})\s*-?\s*(\d{3,4}[A-Z]?)\b/g;
  const seen = new Set<string>();
  const courses: string[] = [];
  let cm;
  while ((cm = codeRe.exec(sentence)) !== null) {
    const norm = `${cm[1]} ${cm[2]}`;
    if (!seen.has(norm)) {
      seen.add(norm);
      courses.push(norm);
    }
  }
  if (courses.length === 0) {
    // Sentence had "Prerequisite:" but no parseable course codes — return
    // the human-readable text alone for display, with empty courses[].
    return { text: sentence, courses: [] };
  }
  return { text: sentence, courses };
}

// ---------------------------------------------------------------------------
// Main scrape
// ---------------------------------------------------------------------------

// Match both spaced ("ENC 1101") and unspaced ("CHM1046C") code formats.
// CUNY catalogs use "ACG 122"; FL/NWFSC catalogs use "CHM1046C". Both
// produce the same parsed prefix + number.
const COURSE_CODE_RE = /^([A-Z]{2,5})\s*(\d{2,4}[A-Z]?)$/;

function parseCode(doc: CoursedogCourseDoc): { prefix: string; number: string } | null {
  const code = doc.code?.trim();
  if (code) {
    const m = code.match(COURSE_CODE_RE);
    if (m) return { prefix: m[1], number: m[2] };
  }
  // Fallback: use subjectCode + courseNumber if present
  const prefix = doc.subjectCode?.trim().toUpperCase();
  const number = doc.courseNumber?.trim();
  if (prefix && number) return { prefix, number };
  return null;
}

function pickCredits(doc: CoursedogCourseDoc): number | null {
  const ch = doc.credits?.creditHours;
  if (!ch) return null;
  if (typeof ch.max === "number") return ch.max;
  if (typeof ch.min === "number") return ch.min;
  return null;
}

export async function scrapeCoursedogCatalog(
  opts: ScrapeCoursedogOptions
): Promise<ScrapeCoursedogResult> {
  const log = opts.silent ? () => {} : (m: string) => console.log(m);
  const result: ScrapeCoursedogResult = {
    state: opts.state,
    slug: opts.slug,
    catalogDomain: opts.catalogDomain,
    tenantId: null,
    catalogId: null,
    coursesCount: 0,
    withPrereqs: 0,
    courses: [],
    outputPath: null,
  };

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    log(`\n=== Coursedog catalog: ${opts.slug} (${opts.catalogDomain}) ===`);
    log(`  Capturing tenant + catalog ID...`);
    const session = await captureSession(page, opts.catalogDomain, !!opts.silent);
    if (!session) {
      result.error = `Failed to capture tenantId/catalogId from ${opts.catalogDomain}`;
      log(`  ${result.error}`);
      return result;
    }
    result.tenantId = session.tenantId;
    result.catalogId = session.catalogId;
    log(`  tenant=${session.tenantId} catalog=${session.catalogId}`);

    log(`  Listing courses...`);
    const docs = await listAllCourses(
      page,
      session.tenantId,
      session.catalogId,
      opts.pageSize ?? 200,
      log
    );
    log(`  Got ${docs.length} courses`);

    // Collect every requisite course-group ID so we can resolve them in batch.
    const allIds = new Set<string>();
    for (const d of docs) {
      const groups = d.requisites?.requisitesSimple ?? [];
      for (const g of groups) walkRequisites(g.rules, allIds);
    }
    log(`  Resolving ${allIds.size} prereq course IDs...`);
    const idToCode = await resolveCourseIds(
      page,
      session.tenantId,
      [...allIds]
    );
    log(`  Resolved ${idToCode.size}/${allIds.size}`);

    const out: CoursedogCourse[] = [];
    let withPrereqs = 0;
    for (const d of docs) {
      const parsed = parseCode(d);
      if (!parsed) continue;
      const prereqs = extractPrereqs(d, idToCode);
      if (prereqs.text) withPrereqs++;
      out.push({
        prefix: parsed.prefix,
        number: parsed.number,
        // `name` is the canonical display title at most tenants; `longName`
        // is often empty string (truthy by `??`), which suppressed the
        // title in early NWFSC testing. Use `||` to fall through.
        title: (d.name || d.longName || "").replace(/\s+/g, " ").trim(),
        credits: pickCredits(d),
        description: (d.description ?? "").replace(/\s+/g, " ").trim(),
        prerequisite_text: prereqs.text,
        prerequisite_courses: prereqs.courses,
      });
    }
    result.courses = out;
    result.coursesCount = out.length;
    result.withPrereqs = withPrereqs;

    if (!opts.dryRun) {
      const outDir = path.join(
        process.cwd(),
        "data",
        opts.state,
        "coursedog-catalog"
      );
      fs.mkdirSync(outDir, { recursive: true });
      const outFile = path.join(outDir, `${opts.slug}.json`);
      fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
      result.outputPath = outFile;
      log(`  → ${out.length} courses written to ${outFile} (${withPrereqs} with prereqs)`);
    } else {
      log(`  → ${out.length} courses (dry-run, not written)`);
    }
  } catch (e) {
    result.error = `Coursedog scrape error: ${e instanceof Error ? e.message : e}`;
    log(`  ${result.error}`);
  } finally {
    if (browser) await browser.close();
  }
  return result;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliArgs {
  smoke: boolean;
  domain?: string;
  slug?: string;
  state?: string;
  help: boolean;
  err?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { smoke: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--smoke") out.smoke = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--domain") out.domain = argv[++i];
    else if (a === "--slug") out.slug = argv[++i];
    else if (a === "--state") out.state = argv[++i];
    else out.err = `Unknown argument: ${a}`;
  }
  return out;
}

function printHelp() {
  console.log(`Usage:
  npx tsx scripts/lib/scrape-coursedog.ts --smoke \\
    --domain <catalogDomain> --slug <slug> [--state <state>]

Smoke-test the Coursedog catalog template against a single tenant. Read-only:
no JSON files written.

Examples:
  npx tsx scripts/lib/scrape-coursedog.ts --smoke \\
    --domain catalog.nwfsc.edu --slug nwfsc --state fl

  npx tsx scripts/lib/scrape-coursedog.ts --smoke \\
    --domain bmcc.catalog.cuny.edu --slug bmcc --state ny
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.err || !args.smoke) {
    if (args.err) console.error(`Error: ${args.err}`);
    if (!args.smoke && !args.help && !args.err)
      console.error("This file is a library. Add --smoke to run a read-only test.");
    printHelp();
    process.exit(args.err || !args.smoke ? 1 : 0);
  }
  if (!args.domain || !args.slug) {
    console.error("--smoke requires --domain and --slug");
    printHelp();
    process.exit(1);
  }

  const r = await scrapeCoursedogCatalog({
    state: args.state || "smoke",
    slug: args.slug,
    catalogDomain: args.domain,
    dryRun: true,
  });

  console.log("\n=== Smoke result ===");
  console.log(`  tenant:        ${r.tenantId}`);
  console.log(`  catalog:       ${r.catalogId}`);
  console.log(`  courses:       ${r.coursesCount}`);
  console.log(`  with prereqs:  ${r.withPrereqs}`);
  if (r.error) console.log(`  error:         ${r.error}`);
  if (r.courses.length > 0) {
    console.log(`\n  Sample (first 3 courses):`);
    for (const c of r.courses.slice(0, 3)) {
      console.log(
        `    ${c.prefix} ${c.number}  (${c.credits ?? "?"}cr)  ${c.title}`
      );
      if (c.prerequisite_text) {
        console.log(`      prereq: ${c.prerequisite_text}`);
      }
    }
  }
}

const isMain =
  import.meta.url.startsWith("file:") &&
  process.argv[1] &&
  import.meta.url === `file://${path.resolve(process.argv[1])}`;

if (isMain) {
  main().catch((e) => {
    console.error("Fatal:", e);
    process.exit(1);
  });
}

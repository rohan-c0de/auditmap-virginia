/**
 * scrape-coursedog-programs.ts — shared Coursedog program scraper.
 *
 * Coursedog is a hosted catalog/curriculum platform used by CUNY (all 7
 * community colleges), MA's Greenfield CC, and most SUNY community
 * colleges. Each customer publishes a Nuxt SSR catalog at a tenant
 * subdomain (e.g. bmcc.catalog.cuny.edu) which fetches data
 * client-side from app.coursedog.com. Cookies set by the catalog
 * subdomain are required for the API to return non-401 responses, so
 * we drive everything through Playwright + page.evaluate(fetch(...))
 * to inherit the page session — same pattern as the existing course
 * prereq scraper at scripts/ny/scrape-catalog-prereqs.ts.
 *
 * Architecture
 * ------------
 * 1. Open the catalog's /programs page; capture tenantId + catalogId
 *    from the first programs/search request that fires.
 * 2. List all programs via /api/v1/cm/{tenantId}/programs/search/$filters.
 * 3. For each program, GET /api/v1/cm/{tenantId}/programs/{programId}
 *    to retrieve its full document. The requirement structure lives
 *    in `requisites.requisitesSimple[]` — an array of top-level
 *    "requirement groups" (Common Core, Major Core, Electives, etc.)
 *    each containing a tree of rules.
 * 4. Walk the rules recursively to collect:
 *       - course-id leaves (rule.value.condition === "courses")
 *       - credit floors (rule.condition === "minimumCredits")
 *       - "choose N of" restrictions (completedAtLeastXOf / anyOf)
 * 5. Resolve internal course IDs to "PREFIX NUMBER" + title + credits
 *    via /api/v1/cm/{tenantId}/courses?courseGroupIds=… (batched).
 * 6. Emit one ProgramRequirement per program in the standard schema.
 *
 * Caveats
 * -------
 * - The Coursedog rule tree is more expressive than our flat
 *   RequirementGroup schema (recursive subRules, anyOf alternatives,
 *   minimumCreditsHere overrides). v1 flattens each top-level
 *   requisitesSimple entry into one RequirementGroup whose `courses`
 *   contains every concrete course referenced anywhere inside.
 *   choose_n is pulled from the *outermost* completedAtLeastXOf or
 *   anyOf restriction that wraps the group; credits_required from
 *   the outermost minimumCredits rule.
 * - degreeMaps (semester-by-semester suggested sequences) are
 *   ignored — they duplicate course coverage from requisitesSimple
 *   and would inflate counts.
 * - Total credits: prefer the program-wide minimumCredits rule
 *   under the "Degree Requirements" group; fall back to summing
 *   required-course credits across all groups.
 */

import { chromium, type Browser, type Page } from "playwright";
import * as cheerio from "cheerio";
import { parseCourseFromLabel } from "./scrape-acalog-programs.js";
import type {
  CollegePrograms,
  ProgramCredential,
  ProgramRequirement,
  RequiredCourse,
  RequirementGroup,
} from "../../lib/types.js";

export interface CoursedogProgramConfig {
  collegeSlug: string;
  /** Catalog domain, e.g. "bmcc.catalog.cuny.edu" (no scheme, no path). */
  catalogDomain: string;
  /** Catalog year for output metadata, e.g. "2025-2026". */
  catalogYear: string;
}

const CONCURRENCY = 4;
const PROGRAMS_PAGE_SIZE = 200;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Session capture
// ---------------------------------------------------------------------------

async function captureSession(
  page: Page,
  catalogDomain: string,
): Promise<{ tenantId: string; catalogId: string } | null> {
  let tenantId: string | null = null;
  let catalogId: string | null = null;

  const handler = (req: { url(): string }) => {
    const u = req.url();
    const m = u.match(/app\.coursedog\.com\/api\/v1\/cm\/([^/]+)\/programs\/search/);
    if (m && !tenantId) {
      tenantId = m[1];
      const cm = u.match(/catalogId=([^&]+)/);
      if (cm) catalogId = decodeURIComponent(cm[1]);
    }
  };
  page.on("request", handler);

  const url = `https://${catalogDomain}/programs`;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  } catch (e) {
    console.warn(`  [${catalogDomain}] goto error: ${(e as Error).message}`);
  }

  for (let i = 0; i < 60 && !tenantId; i++) {
    await page.waitForTimeout(500);
  }
  page.off("request", handler);

  if (!tenantId || !catalogId) return null;
  return { tenantId, catalogId };
}

// ---------------------------------------------------------------------------
// Coursedog API types
// ---------------------------------------------------------------------------

interface ProgramListItem {
  _id: string;
  id: string;
  code?: string;
  name?: string;
  longName?: string;
  catalogDisplayName?: string;
  degreeDesignation?: string;
  status?: string;
}

interface RequisiteRule {
  id?: string;
  condition?: string;
  credits?: number;
  restriction?: { selectN?: number; minimumCredits?: number };
  value?: {
    condition?: string;
    values?: Array<{ value: string[] | string; logic?: string }>;
    subSelections?: unknown[];
  };
  subRules?: RequisiteRule[];
  gradeType?: string;
  grade?: string;
}

interface RequisiteGroup {
  id?: string;
  name?: string;
  type?: string;
  rules?: RequisiteRule[];
}

interface ProgramDetail {
  _id: string;
  id: string;
  code?: string;
  name?: string;
  longName?: string;
  catalogDisplayName?: string;
  degreeDesignation?: string;
  type?: string;
  status?: string;
  requisites?: {
    requisitesSimple?: RequisiteGroup[];
    /** *_colleague_ethos tenants emit requirements as an inline HTML blob here
     *  instead of the structured requisitesSimple rule tree. */
    requisitesFreeform?: { value?: string } | string;
  };
  customFields?: Record<string, unknown>;
}

interface CourseDoc {
  _id: string;
  code?: string;
  subjectCode?: string;
  courseNumber?: string;
  name?: string;
  longName?: string;
  credits?: { creditHours?: { min?: number; max?: number } };
}

// ---------------------------------------------------------------------------
// API helpers — run inside the page so session cookies attach automatically
// ---------------------------------------------------------------------------

async function apiGet<T>(page: Page, url: string): Promise<T | null> {
  const result = await page.evaluate(async (u) => {
    try {
      const r = await fetch(u, {
        headers: { "x-requested-with": "catalog", Accept: "application/json" },
      });
      if (!r.ok) return { ok: false, status: r.status, data: null };
      return { ok: true, status: r.status, data: await r.json() };
    } catch (e) {
      return { ok: false, status: 0, data: null, error: String(e) };
    }
  }, url);
  if (!result.ok) return null;
  return result.data as T;
}

async function apiPost<T>(
  page: Page,
  url: string,
  body: unknown,
): Promise<T | null> {
  const result = await page.evaluate(
    async ({ u, b }) => {
      try {
        const r = await fetch(u, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-requested-with": "catalog",
            Accept: "application/json",
          },
          body: JSON.stringify(b),
        });
        if (!r.ok) return { ok: false, status: r.status, data: null };
        return { ok: true, status: r.status, data: await r.json() };
      } catch (e) {
        return { ok: false, status: 0, data: null, error: String(e) };
      }
    },
    { u: url, b: body },
  );
  if (!result.ok) return null;
  return result.data as T;
}

// Minimal filter body — only "Active" + catalogPrint, matching the same
// shape the catalog UI itself uses for the courses search.
const PROGRAMS_FILTER_BODY = {
  condition: "AND",
  filters: [
    {
      filters: [
        {
          id: "status-program",
          condition: "field",
          name: "status",
          inputType: "select",
          group: "program",
          type: "is",
          value: "Active",
          customField: false,
        },
      ],
      id: "I5KglKp3",
      condition: "and",
    },
  ],
};

// Empty filter — fetches ALL programs regardless of status. Fallback for
// tenants that store status as lowercase "active" (Banner-SQL / some Colleague
// syncs), which the case-sensitive "Active" filter above returns 0 for.
const EMPTY_FILTER_BODY = { condition: "AND", filters: [] };

/**
 * Whether a Coursedog program status counts as "active" for scraping. Tenants
 * vary in casing ("Active" vs "active"); a missing/blank status defaults to
 * active. Inactive / Archived / etc. are dropped. Exported for unit testing.
 */
export function isActiveProgramStatus(status?: string): boolean {
  const s = (status ?? "").trim().toLowerCase();
  return s === "" || s === "active";
}

/** Safety bound on pagination — 30 × 200 = 6,000 programs is far above any
 *  real catalog and prevents an unbounded loop if the API misbehaves. */
const MAX_PROGRAM_PAGES = 30;

async function listAllPrograms(
  page: Page,
  tenantId: string,
  catalogId: string,
): Promise<ProgramListItem[]> {
  const pageUrl = (skip: number) =>
    `https://app.coursedog.com/api/v1/cm/${tenantId}/programs/search/%24filters` +
    `?catalogId=${encodeURIComponent(catalogId)}` +
    `&skip=${skip}&limit=${PROGRAMS_PAGE_SIZE}` +
    `&orderBy=code&formatDependents=false`;

  // Page through results: the search endpoint caps each response at
  // PROGRAMS_PAGE_SIZE, so a single fetch silently truncated large catalogs
  // (cape-fear 473, central-carolina 654, del-mar 304). Keep fetching until a
  // short page signals the end.
  const fetchAll = async (filterBody: unknown): Promise<ProgramListItem[]> => {
    const out: ProgramListItem[] = [];
    for (let p = 0; p < MAX_PROGRAM_PAGES; p++) {
      const resp = await apiPost<{ data: ProgramListItem[]; listLength: number }>(
        page,
        pageUrl(p * PROGRAMS_PAGE_SIZE),
        filterBody,
      );
      const batch = resp?.data ?? [];
      out.push(...batch);
      if (batch.length < PROGRAMS_PAGE_SIZE) break;
    }
    return out;
  };

  let data = await fetchAll(PROGRAMS_FILTER_BODY);
  // Casing fallback: when the "Active"-filtered search returns nothing, the
  // tenant likely stores its status lowercase. Re-fetch unfiltered and keep
  // only active/unspecified programs (drop Inactive/Archived) so the catalog
  // isn't silently empty. Tenants that already return rows are untouched.
  if (data.length === 0) {
    data = (await fetchAll(EMPTY_FILTER_BODY)).filter((p) =>
      isActiveProgramStatus(p.status),
    );
  }
  return data;
}

async function getProgramDetail(
  page: Page,
  tenantId: string,
  programId: string,
): Promise<ProgramDetail | null> {
  const url = `https://app.coursedog.com/api/v1/cm/${tenantId}/programs/${encodeURIComponent(programId)}`;
  return apiGet<ProgramDetail>(page, url);
}

/**
 * Returns a map keyed by the BARE courseGroupId (no date suffix). The
 * Coursedog response keys docs as "{groupId}-{effectiveDate}" — we
 * strip the suffix so callers can look up by groupId directly.
 */
async function getCoursesByGroupIds(
  page: Page,
  tenantId: string,
  courseGroupIds: string[],
): Promise<Record<string, CourseDoc>> {
  if (courseGroupIds.length === 0) return {};
  const out: Record<string, CourseDoc> = {};
  const chunkSize = 60;
  for (let i = 0; i < courseGroupIds.length; i += chunkSize) {
    const ids = courseGroupIds.slice(i, i + chunkSize).join(",");
    const url =
      `https://app.coursedog.com/api/v1/cm/${tenantId}/courses` +
      `?courseGroupIds=${encodeURIComponent(ids)}` +
      `&useFetchingDegreeMapsCoursesLatestRevisionSettings=true`;
    const resp = await apiGet<Record<string, CourseDoc>>(page, url);
    if (resp) {
      for (const [k, doc] of Object.entries(resp)) {
        // "0875411-2025-08-25" → "0875411"
        const bare = k.replace(/-\d{4}-\d{2}-\d{2}$/, "");
        if (!out[bare]) out[bare] = doc;
      }
    }
    await sleep(50);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rule walker — flatten the rule tree into (courseIds, choose_n, credits)
// ---------------------------------------------------------------------------

interface FlattenedGroup {
  courseGroupIds: Set<string>;
  /** First non-null choose-N restriction encountered. */
  chooseN: number | null;
  /** First non-null minimumCredits rule encountered. */
  creditsRequired: number | null;
}

function walkRules(rules: RequisiteRule[] | undefined, acc: FlattenedGroup) {
  if (!rules) return;
  for (const rule of rules) {
    // Top-level credit floor — record once
    if (rule.condition === "minimumCredits" && typeof rule.credits === "number") {
      if (acc.creditsRequired === null) acc.creditsRequired = rule.credits;
    }
    // "Pick N of" / "earn at least N credits from" patterns
    if (
      rule.condition === "completedAtLeastXOf" ||
      rule.condition === "anyOf" ||
      rule.condition === "atLeastXCredits"
    ) {
      const n = rule.restriction?.selectN ?? null;
      if (n !== null && acc.chooseN === null) acc.chooseN = n;
    }
    // Leaf with course IDs
    if (rule.value?.condition === "courses") {
      for (const v of rule.value.values ?? []) {
        const arr = Array.isArray(v.value) ? v.value : [v.value];
        for (const id of arr) {
          if (typeof id === "string" && id.length > 0) acc.courseGroupIds.add(id);
        }
      }
    }
    // Recurse into nested rule structures
    walkRules(rule.subRules, acc);
    if (rule.value && Array.isArray(rule.value.subSelections)) {
      for (const sub of rule.value.subSelections) {
        if (typeof sub === "object" && sub !== null && "rules" in sub) {
          walkRules((sub as { rules?: RequisiteRule[] }).rules, acc);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Course-doc → RequiredCourse mapping
// ---------------------------------------------------------------------------

function courseToRequired(doc: CourseDoc | undefined): RequiredCourse | null {
  if (!doc) return null;
  // CUNY's `code` field is what the catalog displays ("ACC 122"); subjectCode
  // is sometimes a different SIS-side prefix ("ACCT"). Prefer `code` so the
  // emitted prefix matches what the rest of our system uses (course
  // search, prereq aggregation).
  const code = doc.code?.trim() ?? "";
  const codeMatch = code.match(/^([A-Z]{2,5})\s+(\d{2,4}[A-Z]?)$/);
  if (codeMatch) {
    const titleSrc = doc.longName ?? doc.name ?? "";
    return {
      prefix: codeMatch[1],
      number: codeMatch[2],
      title: titleSrc.replace(/\s+/g, " ").trim(),
      credits: doc.credits?.creditHours?.max ?? doc.credits?.creditHours?.min ?? null,
      or_alternatives: [],
    };
  }
  // Fall back to subjectCode + courseNumber if `code` is missing or oddly
  // formatted.
  const prefix = doc.subjectCode?.trim();
  const number = doc.courseNumber?.trim();
  if (!prefix || !number) return null;
  const titleSrc = doc.longName ?? doc.name ?? "";
  return {
    prefix: prefix.toUpperCase(),
    number,
    title: titleSrc.replace(/\s+/g, " ").trim(),
    credits: doc.credits?.creditHours?.max ?? doc.credits?.creditHours?.min ?? null,
    or_alternatives: [],
  };
}

// ---------------------------------------------------------------------------
// Credential classifier
// ---------------------------------------------------------------------------

function classifyCredential(
  degreeDesignation: string | undefined,
  type: string | undefined,
): ProgramCredential {
  const t = (degreeDesignation ?? "").toLowerCase();
  if (t.includes("aas") || t.includes("applied science")) return "AAS";
  if (t.includes("a.a.s")) return "AAS";
  if (t.includes("aa - associate in arts") || t.includes("associate in arts")) return "AA";
  if (t.includes("as - associate in science") || t.includes("associate in science")) return "AS";
  if (t.includes("certificate") || t.includes("certge") || t.includes("ge30") || t.includes("ge15")) return "certificate";
  if (t.includes("diploma")) return "diploma";
  if (type && type.toLowerCase().includes("certificate")) return "certificate";
  return "other";
}

/**
 * Parse a Coursedog `requisitesFreeform` HTML blob into RequirementGroups.
 * `*_colleague_ethos` tenants (e.g. cape-fear) publish requirements as inline
 * HTML — `<p><strong>Group</strong> (Take N credits)</p><ul><li><p>ENG 111 -
 * Title Credits: 3</p></li>…</ul>` — instead of the structured requisitesSimple
 * rule tree, so the normal walker yields nothing. Course-code formats vary
 * (plain space, hyphen-no-space, nbsp-hyphen) exactly like Acalog, so we reuse
 * `parseCourseFromLabel`. Group headers are <h3>/<h4>/<p><strong>; each course
 * is an <li>.
 */
export function parseFreeformRequisites(html: string): RequirementGroup[] {
  const $ = cheerio.load(html);
  const groups: RequirementGroup[] = [];
  let current: RequirementGroup | null = null;

  const flush = () => {
    if (current && current.courses.length > 0) groups.push(current);
    current = null;
  };

  $("h3, h4, p, li").each((_i, el) => {
    const $el = $(el);

    if ($el.is("li")) {
      // A course line. Strip the trailing "Credits: N" the catalog appends,
      // then reuse the Acalog label parser for the prefix/number.
      const raw = $el.text().replace(/\s+/g, " ").trim();
      const credM = raw.match(/credits?:\s*([\d.]+)/i);
      const credits = credM ? Number(credM[1]) : null;
      const label = raw.replace(/\s*credits?:\s*[\d.]+.*$/i, "").trim();
      const parsed = parseCourseFromLabel(label);
      if (!parsed) return;
      const cur =
        current ??
        (current = { name: "Requirements", credits_required: null, choose_n: null, courses: [] });
      const key = `${parsed.prefix} ${parsed.number}`;
      if (cur.courses.some((c) => `${c.prefix} ${c.number}` === key)) return;
      cur.courses.push({
        prefix: parsed.prefix,
        number: parsed.number,
        title: parsed.title,
        credits,
        or_alternatives: [],
      });
      return;
    }

    // A header (<h3>/<h4>/<p>). Skip the <p> nested inside a course <li>.
    if ($el.closest("li").length > 0) return;
    const headerText = $el.text().replace(/\s+/g, " ").trim();
    if (!headerText) return;
    flush();
    const name =
      (($el.find("strong").first().text() || headerText).trim().replace(/\s*\([^)]*\)\s*$/, "").trim()) ||
      "Requirements";
    const takeM = headerText.match(/take\s+(\d+)\s+credits?/i);
    current = { name, credits_required: takeM ? Number(takeM[1]) : null, choose_n: null, courses: [] };
  });

  flush();
  return groups;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function scrapeCoursedogPrograms(
  config: CoursedogProgramConfig,
): Promise<CollegePrograms> {
  const { collegeSlug, catalogDomain, catalogYear } = config;

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log(`  [${collegeSlug}] Capturing session at ${catalogDomain}…`);
    const session = await captureSession(page, catalogDomain);
    if (!session) {
      console.warn(`  [${collegeSlug}] Failed to capture tenantId/catalogId; aborting.`);
      return {
        college_slug: collegeSlug,
        catalog_year: catalogYear,
        catalog_url: `https://${catalogDomain}/programs`,
        scraped_at: new Date().toISOString(),
        programs: [],
      };
    }
    const { tenantId, catalogId } = session;
    console.log(`  [${collegeSlug}] tenant=${tenantId} catalog=${catalogId}`);

    const list = await listAllPrograms(page, tenantId, catalogId);
    console.log(`  [${collegeSlug}] Found ${list.length} programs`);

    // Walk all programs sequentially (Coursedog rate-limits are sensitive
    // to bursts; ~6/sec is comfortable). For each program: detail → flatten
    // → resolve courses → emit.
    const programs: ProgramRequirement[] = [];
    let parsed = 0;
    let skipped = 0;

    for (const item of list) {
      try {
        const detail = await getProgramDetail(page, tenantId, item._id);
        if (!detail) {
          skipped++;
          continue;
        }
        const requisitesSimple = detail.requisites?.requisitesSimple ?? [];
        let requirementGroups: RequirementGroup[] = [];

        if (requisitesSimple.length > 0) {
          // Flatten each top-level requisitesSimple entry.
          const flattened: { name: string; flat: FlattenedGroup }[] = [];
          const allCourseIds = new Set<string>();
          for (const group of requisitesSimple) {
            const flat: FlattenedGroup = {
              courseGroupIds: new Set(),
              chooseN: null,
              creditsRequired: null,
            };
            walkRules(group.rules, flat);
            for (const id of flat.courseGroupIds) allCourseIds.add(id);
            flattened.push({ name: (group.name ?? "Required Courses").trim(), flat });
          }

          // Resolve all course IDs once
          const courseDocs = await getCoursesByGroupIds(
            page,
            tenantId,
            [...allCourseIds],
          );

          // Build RequirementGroups
          for (const { name, flat } of flattened) {
            const courses: RequiredCourse[] = [];
            const seen = new Set<string>();
            for (const id of flat.courseGroupIds) {
              const doc = courseDocs[id];
              const rc = courseToRequired(doc);
              if (!rc) continue;
              const key = `${rc.prefix} ${rc.number}`;
              if (seen.has(key)) continue;
              seen.add(key);
              courses.push(rc);
            }
            if (courses.length === 0 && flat.creditsRequired === null) continue;
            requirementGroups.push({
              name,
              credits_required: flat.creditsRequired,
              choose_n: flat.chooseN,
              courses,
            });
          }
        } else {
          // Freeform fallback: *_colleague_ethos tenants (cape-fear, jackson,
          // south-suburban) publish requirements as an inline HTML blob instead
          // of the structured requisitesSimple rule tree. Parse the HTML —
          // course codes are inline, so no courseGroupId resolution is needed.
          const ff = detail.requisites?.requisitesFreeform;
          const ffHtml = typeof ff === "string" ? ff : ff?.value ?? "";
          if (ffHtml) requirementGroups = parseFreeformRequisites(ffHtml);
        }

        if (requirementGroups.length === 0) {
          skipped++;
          continue;
        }

        // Total credits — prefer the explicit "Degree Requirements"
        // minimumCredits floor. Don't fall back to summing course credits:
        // many CUNY programs encode alternative "Options" (concentrations)
        // as parallel top-level groups, and naïvely summing inflates the
        // total to absurd values (e.g. Bronx CC Liberal Arts had 14
        // option groups summing to 690 credits when the real answer is
        // ~60). Better to emit null than a misleading number.
        let totalCredits: number | null = null;
        const degreeReqGroup = requirementGroups.find((g) =>
          /degree requirement/i.test(g.name),
        );
        if (degreeReqGroup && degreeReqGroup.credits_required !== null) {
          totalCredits = degreeReqGroup.credits_required;
        } else {
          // Fallback 1: any group that names itself as a credit total
          // ("Total Credits", "Major Requirements - Total Credits", etc.).
          // Bronx CC encodes the program-wide credit floor this way.
          const anchor = requirementGroups.find(
            (g) =>
              g.credits_required !== null &&
              /(total credits|minimum credits|credits required)/i.test(g.name),
          );
          if (anchor) totalCredits = anchor.credits_required;
          // Fallback 2: GCC (Greenfield) embeds credits directly in group
          // names ("General Education Requirements: 32-33 Credits"). Sum
          // those tags across groups.
          if (totalCredits === null) {
            let sum = 0;
            let any = false;
            for (const g of requirementGroups) {
              const m = g.name.match(/:\s*(\d+)(?:\s*[-–]\s*\d+)?\s*credits?\b/i);
              if (m) {
                sum += Number(m[1]);
                any = true;
              }
            }
            if (any) totalCredits = sum;
          }
        }

        const credential = classifyCredential(detail.degreeDesignation, detail.type);
        const title =
          detail.catalogDisplayName?.trim() ||
          detail.longName?.trim() ||
          detail.name?.trim() ||
          item.code ||
          item._id;

        programs.push({
          title,
          credential,
          program_code: detail.code ?? null,
          catalog_url: `https://${catalogDomain}/programs/${detail.code ?? item._id}`,
          total_credits: totalCredits,
          gpa_minimum: 2.0,
          description: null,
          requirement_groups: requirementGroups,
          matched_program_slug: null,
        });
        parsed++;
      } catch (e) {
        console.warn(
          `  [${collegeSlug}]   ! ${item.code ?? item._id}: ${e instanceof Error ? e.message : e}`,
        );
        skipped++;
      }
      if ((parsed + skipped) % 10 === 0) {
        console.log(
          `  [${collegeSlug}]   progress: ${parsed} parsed, ${skipped} skipped`,
        );
      }
      await sleep(120);
    }

    console.log(
      `  [${collegeSlug}] Done: ${parsed} parsed, ${skipped} skipped`,
    );
    return {
      college_slug: collegeSlug,
      catalog_year: catalogYear,
      catalog_url: `https://${catalogDomain}/programs`,
      scraped_at: new Date().toISOString(),
      programs,
    };
  } finally {
    if (browser) await browser.close();
  }
}

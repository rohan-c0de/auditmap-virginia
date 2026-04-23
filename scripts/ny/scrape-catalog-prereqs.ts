/**
 * scrape-catalog-prereqs.ts (NY / CUNY)
 *
 * Scrapes course prerequisite text for the 7 CUNY community colleges, which
 * all publish their catalogs through Coursedog at {slug}.catalog.cuny.edu.
 *
 * Coursedog architecture
 * ----------------------
 * The catalog front-end is a Nuxt SSR app that fetches course data
 * client-side from app.coursedog.com. Every catalog page call requires
 * session cookies set by the tenant subdomain, so a bare curl returns 401.
 * We use Playwright to establish the session, then drive the JSON API via
 * `page.evaluate(fetch(...))` so requests inherit the page's cookies.
 *
 * Prereq field discovery
 * ----------------------
 * CUNY's course documents do NOT put prereq data in the obvious `requisites`
 * field (that's program requirement data — which programs/degrees require
 * the course). Real prereq text lives in `customFields.<obfuscated-key>`
 * as a string starting with "PREREQ/COREQ:" or similar. The obfuscated key
 * differs per school (e.g. QCC uses "Mmgow"). We locate it per-course by
 * scanning every customFields string value for the PREREQ marker.
 *
 * Output
 * ------
 * data/ny/prereqs.json keyed by "${PREFIX} ${NUMBER}" (e.g. "ENGL 101"),
 * value `{ text, courses }`. Matches the shape produced by VT/CT/RI/PA.
 *
 * Usage:
 *   npx tsx scripts/ny/scrape-catalog-prereqs.ts
 *   npx tsx scripts/ny/scrape-catalog-prereqs.ts --school qcc
 *   npx tsx scripts/ny/scrape-catalog-prereqs.ts --limit=50
 */

import * as fs from "fs";
import * as path from "path";
import { chromium, type Browser, type Page, type Request } from "playwright";

// CUNY community college Coursedog subdomains. Slug matches the subdomain.
// Some schools may 500 intermittently — we log and continue past failures.
const SCHOOLS: { slug: string; label: string }[] = [
  { slug: "bmcc", label: "Borough of Manhattan CC" },
  { slug: "bcc", label: "Bronx CC" },
  { slug: "guttman", label: "Guttman CC" },
  { slug: "hostos", label: "Hostos CC" },
  { slug: "kbcc", label: "Kingsborough CC" },
  { slug: "laguardia", label: "LaGuardia CC" },
  { slug: "qcc", label: "Queensborough CC" },
];

const PAGE_SIZE = 200;
const CONCURRENCY = 4;

interface PrereqEntry {
  text: string;
  courses: string[];
}

interface CourseDoc {
  _id: string;
  code?: string;
  subjectCode?: string;
  courseNumber?: string;
  name?: string;
  description?: string;
  customFields?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Session capture
// ---------------------------------------------------------------------------

async function captureCatalogSession(
  page: Page,
  slug: string,
): Promise<{ tenantId: string; catalogId: string } | null> {
  let tenantId: string | null = null;
  let catalogId: string | null = null;

  const handler = (req: Request) => {
    const u = req.url();
    const m = u.match(
      /app\.coursedog\.com\/api\/v1\/cm\/([^/]+)\/courses\/search/,
    );
    if (m && !tenantId) {
      tenantId = m[1];
      const cm = u.match(/catalogId=([^&]+)/);
      if (cm) catalogId = decodeURIComponent(cm[1]);
    }
  };
  page.on("request", handler);

  const listUrl = `https://${slug}.catalog.cuny.edu/courses`;
  try {
    await page.goto(listUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
  } catch (e) {
    console.warn(`  [${slug}] goto error: ${(e as Error).message}`);
  }

  // Wait up to 20s for the first Coursedog API request to fire.
  for (let i = 0; i < 40 && !tenantId; i++) {
    await page.waitForTimeout(500);
  }
  page.off("request", handler);

  if (!tenantId || !catalogId) return null;
  return { tenantId, catalogId };
}

// ---------------------------------------------------------------------------
// API helpers (run in-page so cookies are attached)
// ---------------------------------------------------------------------------

const SEARCH_BODY = {
  condition: "AND",
  filters: [
    {
      filters: [
        {
          id: "status-course",
          condition: "field",
          name: "status",
          inputType: "select",
          group: "course",
          type: "is",
          value: "Active",
          customField: false,
        },
        {
          id: "catalogPrint-course",
          condition: "field",
          name: "catalogPrint",
          inputType: "boolean",
          group: "course",
          type: "is",
          value: true,
          customField: false,
        },
      ],
      id: "I5KglKp3",
      condition: "and",
    },
  ],
};

async function fetchCourseList(
  page: Page,
  tenantId: string,
  catalogId: string,
  skip: number,
  limit: number,
): Promise<CourseDoc[]> {
  const url =
    `https://app.coursedog.com/api/v1/cm/${tenantId}/courses/search/%24filters` +
    `?catalogId=${encodeURIComponent(catalogId)}` +
    `&skip=${skip}&limit=${limit}` +
    `&orderBy=code` +
    `&columns=code,name,longName,subjectCode,courseNumber,_id,description,requisites,customFields` +
    `&formatDependents=false`;

  const result = await page.evaluate(
    async ({ url, body }) => {
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-requested-with": "catalog",
            Accept: "application/json",
          },
          body: JSON.stringify(body),
        });
        if (!r.ok) return { ok: false, status: r.status, data: null };
        return { ok: true, status: r.status, data: await r.json() };
      } catch (e) {
        return { ok: false, status: 0, data: null, error: String(e) };
      }
    },
    { url, body: SEARCH_BODY },
  );

  if (!result.ok) {
    throw new Error(`list fetch failed status=${result.status}`);
  }
  const d = result.data;
  if (Array.isArray(d)) return d as CourseDoc[];
  if (d && Array.isArray(d.data)) return d.data as CourseDoc[];
  if (d && Array.isArray(d.courses)) return d.courses as CourseDoc[];
  return [];
}

async function fetchCourseDetail(
  page: Page,
  tenantId: string,
  id: string,
): Promise<CourseDoc | null> {
  const url = `https://app.coursedog.com/api/v1/cm/${tenantId}/courses/${encodeURIComponent(id)}`;
  const result = await page.evaluate(async (url) => {
    try {
      const r = await fetch(url, {
        headers: {
          "x-requested-with": "catalog",
          Accept: "application/json",
        },
      });
      if (!r.ok) return { ok: false, status: r.status, data: null };
      return { ok: true, status: r.status, data: await r.json() };
    } catch (e) {
      return { ok: false, status: 0, data: null, error: String(e) };
    }
  }, url);
  if (!result.ok) return null;
  const d = result.data;
  return (d?.course ?? d) as CourseDoc | null;
}

// ---------------------------------------------------------------------------
// Prereq extraction
// ---------------------------------------------------------------------------

// CUNY prereq text typically begins with "PREREQ", "Prerequisite", or
// "PREREQ/COREQ". We accept any customField string value that matches.
const PREREQ_MARKER_RE = /\b(pre[- ]?req|prerequisite|co[- ]?req|corequisite)/i;

// Strip the leading "PREREQ/COREQ:" style label so `text` reads naturally.
const PREREQ_PREFIX_RE =
  /^(pre[- ]?req(?:uisite)?s?\s*(?:\/\s*co[- ]?req(?:uisite)?s?)?\s*:\s*)/i;

function extractPrereqString(course: CourseDoc): string | null {
  const cf = course.customFields;
  if (!cf || typeof cf !== "object") return null;
  // Prefer explicitly-named keys first, fall back to marker scan.
  const explicit = ["prerequisite", "prerequisites", "catalogPrerequisite"];
  for (const k of explicit) {
    const v = (cf as Record<string, unknown>)[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  for (const v of Object.values(cf)) {
    if (typeof v === "string" && PREREQ_MARKER_RE.test(v)) return v;
  }
  return null;
}

/**
 * Clean raw prereq text: trim label prefix, collapse whitespace, strip
 * trailing punctuation. Keep the actual content intact — the UI renders
 * this verbatim.
 */
function normalizePrereqText(raw: string): string {
  let t = raw.replace(/\s+/g, " ").trim();
  t = t.replace(PREREQ_PREFIX_RE, "").trim();
  t = t.replace(/[.;,]+\s*$/, "").trim();
  return t;
}

// Boilerplate that means "no real prereq". CUNY reuses a handful of these.
const BOILERPLATE_RE =
  /^(none|n\/a|not applicable|no prerequisites?( required)?)\.?$/i;

/**
 * Extract course codes referenced in the prereq text. CUNY uses three forms:
 *   1. "ENGL-101" (hyphenated — PeopleSoft-style)
 *   2. "ENGL 101" (spaced)
 *   3. "ENGL101"  (jammed)
 * All normalize to the canonical "PREFIX NUMBER" used elsewhere in this
 * repo's prereq data.
 */
function extractCourseCodes(
  text: string,
  selfKey: string,
): string[] {
  const out = new Set<string>();
  const re = /\b([A-Z]{2,5})[-\s]?(\d{2,4}[A-Z]?)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const code = `${m[1]} ${m[2]}`;
    if (code === selfKey) continue;
    out.add(code);
  }
  return Array.from(out).sort();
}

function courseKey(c: CourseDoc): string | null {
  if (c.subjectCode && c.courseNumber) {
    return `${String(c.subjectCode).toUpperCase().trim()} ${String(c.courseNumber).toUpperCase().trim()}`;
  }
  if (c.code) {
    const m = String(c.code).match(/^([A-Z]{2,5})[-\s]?(\d{2,4}[A-Z]?)/i);
    if (m) return `${m[1].toUpperCase()} ${m[2].toUpperCase()}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-school scrape
// ---------------------------------------------------------------------------

async function pmap<T, R>(
  items: T[],
  n: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      try {
        results[idx] = await fn(items[idx], idx);
      } catch (e) {
        console.error(`    pmap[${idx}] error: ${(e as Error).message}`);
        results[idx] = undefined as unknown as R;
      }
    }
  }
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

async function scrapeSchool(
  browser: Browser,
  school: { slug: string; label: string },
  limit: number,
): Promise<Record<string, PrereqEntry>> {
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  });
  const page = await ctx.newPage();

  console.log(`\n=== ${school.slug} (${school.label}) ===`);

  const session = await captureCatalogSession(page, school.slug);
  if (!session) {
    console.warn(`  [${school.slug}] could not capture session — skipping`);
    await ctx.close();
    return {};
  }
  const { tenantId, catalogId } = session;
  console.log(`  tenant=${tenantId} catalog=${catalogId}`);

  // Paginate list.
  const all: CourseDoc[] = [];
  let skip = 0;
  while (true) {
    let batch: CourseDoc[];
    try {
      batch = await fetchCourseList(page, tenantId, catalogId, skip, PAGE_SIZE);
    } catch (e) {
      console.error(`  [${school.slug}] list error at skip=${skip}: ${(e as Error).message}`);
      break;
    }
    if (batch.length === 0) break;
    all.push(...batch);
    console.log(`  listed ${all.length} courses (skip=${skip})`);
    if (batch.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
    if (limit > 0 && all.length >= limit) break;
  }

  let pool = all;
  if (limit > 0) pool = pool.slice(0, limit);

  // Check if list already includes customFields (columns param should have
  // returned them). If not, per-course detail fetches fill the gap.
  const sample = pool.find((c) => c.customFields && Object.keys(c.customFields).length > 0);
  const needDetail = !sample;
  if (needDetail) {
    console.log(`  list omitted customFields; fetching details for ${pool.length} courses`);
    const filled = await pmap(pool, CONCURRENCY, async (c) => {
      const d = await fetchCourseDetail(page, tenantId, c._id);
      return d ?? c;
    });
    pool = filled.filter((c): c is CourseDoc => !!c);
  } else {
    console.log(`  list included customFields — no detail fetches needed`);
  }

  const prereqs: Record<string, PrereqEntry> = {};
  let hits = 0;
  for (const c of pool) {
    const key = courseKey(c);
    if (!key) continue;
    const raw = extractPrereqString(c);
    if (!raw) continue;
    const text = normalizePrereqText(raw);
    if (!text || BOILERPLATE_RE.test(text)) continue;
    const courses = extractCourseCodes(text, key);
    prereqs[key] = { text, courses };
    hits++;
  }
  console.log(`  ${hits} courses with prereqs (of ${pool.length} scanned)`);

  await ctx.close();
  return prereqs;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const schoolArg = args.find((a) => a.startsWith("--school="))?.split("=")[1]
    ?? (args.indexOf("--school") >= 0 ? args[args.indexOf("--school") + 1] : null);
  const limit = parseInt(
    args.find((a) => a.startsWith("--limit="))?.split("=")[1] || "0",
    10,
  );

  const targets = schoolArg
    ? SCHOOLS.filter((s) => s.slug === schoolArg)
    : SCHOOLS;
  if (targets.length === 0) {
    console.error(`unknown school: ${schoolArg}`);
    console.error(`available: ${SCHOOLS.map((s) => s.slug).join(", ")}`);
    process.exit(1);
  }

  console.log("CUNY Coursedog prereq scraper");
  console.log(`  targets: ${targets.map((t) => t.slug).join(", ")}`);
  if (limit > 0) console.log(`  limit=${limit} per school`);

  const browser = await chromium.launch({ headless: true });
  const merged: Record<string, PrereqEntry> = {};
  const counts: { slug: string; count: number }[] = [];

  for (const school of targets) {
    try {
      const res = await scrapeSchool(browser, school, limit);
      counts.push({ slug: school.slug, count: Object.keys(res).length });
      // Merge: last writer wins. If two schools describe the same course key
      // with different text, keep the one with more referenced courses (more
      // informative). This is rare — CUNY codes like "ENGL 101" exist on
      // multiple campuses but the prereq boilerplate tends to match.
      for (const [k, v] of Object.entries(res)) {
        const existing = merged[k];
        if (!existing || v.courses.length > existing.courses.length) {
          merged[k] = v;
        }
      }
    } catch (e) {
      console.error(`  [${school.slug}] fatal: ${(e as Error).message}`);
      counts.push({ slug: school.slug, count: 0 });
    }
  }

  await browser.close();

  // Sort keys for deterministic output.
  const sorted: Record<string, PrereqEntry> = {};
  for (const k of Object.keys(merged).sort()) sorted[k] = merged[k];

  const outDir = path.join(process.cwd(), "data", "ny");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "prereqs.json");
  fs.writeFileSync(outPath, JSON.stringify(sorted, null, 2));

  console.log("\n=== Summary ===");
  for (const c of counts) console.log(`  ${c.slug}: ${c.count}`);
  console.log(`  merged unique keys: ${Object.keys(sorted).length}`);
  console.log(`\n✓ Wrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

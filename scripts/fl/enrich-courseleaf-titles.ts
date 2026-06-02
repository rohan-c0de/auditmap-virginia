/**
 * Fill empty course_title on already-scraped FL course files from a college's
 * CourseLeaf catalog.
 *
 * Why: scrape-broward.ts gets crn / prefix / number / schedule from the class-
 * schedule listing, but that listing has no title (see its line ~267:
 * `course_title: ""`). Every broward row therefore failed CourseSectionSchema
 * (course_title required) and the whole (college, term) aborted on import —
 * broward showed 0 courses on prod. Florida's SCNS titles vary across colleges
 * and a cross-college join only covered ~75%, so we use broward's OWN catalog.
 *
 * Broward's CourseLeaf catalog exposes per-prefix course pages at
 *   {base}/course-descriptions/{prefix}/
 * each containing blocks like:
 *   <span class="... detail-code ...">ACG2001</span>
 *   <span class="... detail-title ...">PRINCIPLES OF ACCOUNTING I</span>
 * which give a clean {PREFIX+NUMBER -> title} map. HTTP only (no JS/SSO).
 *
 * Usage:
 *   npx tsx scripts/fl/enrich-courseleaf-titles.ts --college broward \
 *     --catalog https://catalog.broward.edu
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const UA = "ccpath-catalog/1.0";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function get(url: string, retries = 2): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA } });
      if (!r.ok) throw new Error(`${r.status}`);
      return await r.text();
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw new Error(`${lastErr instanceof Error ? lastErr.message : lastErr} ${url}`);
}

function decode(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** "PRINCIPLES OF ACCOUNTING I" -> "Principles of Accounting I". */
function titleCase(s: string): string {
  const small = new Set(["of", "the", "and", "in", "to", "for", "a", "an", "with", "on", "at"]);
  const words = s.toLowerCase().split(/\s+/);
  return words
    .map((w, i) => {
      if (/^[ivx]+$/i.test(w)) return w.toUpperCase(); // roman numerals
      if (i > 0 && small.has(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ");
}

async function buildTitleMap(base: string): Promise<Map<string, string>> {
  const index = await get(`${base}/course-descriptions/`);
  const prefixes = [
    ...new Set(
      [...index.matchAll(/href="\/course-descriptions\/([a-z0-9-]+)\/"/gi)].map((m) =>
        m[1].toLowerCase()
      )
    ),
  ];
  console.log(`  ${prefixes.length} prefix pages to fetch`);
  const map = new Map<string, string>();
  for (const pfx of prefixes) {
    let html: string;
    try {
      html = await get(`${base}/course-descriptions/${pfx}/`);
    } catch (e) {
      console.warn(`    skip ${pfx}: ${(e as Error).message}`);
      continue;
    }
    // Pair each detail-code with the detail-title that follows it.
    const re =
      /class="[^"]*detail-code[^"]*"[^>]*>([^<]+)<\/span>\s*<span class="[^"]*detail-title[^"]*"[^>]*>([^<]*)<\/span>/gi;
    for (const m of html.matchAll(re)) {
      const code = decode(m[1]).replace(/\s+/g, "").toUpperCase(); // "ACG2001"
      const title = titleCase(decode(m[2]));
      if (code && title) map.set(code, title);
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return map;
}

/**
 * Fill empty course_title for an FL college from its CourseLeaf catalog,
 * with a statewide-SCNS fallback. Optionally drop sections that remain
 * untitleable after both sources. Reusable from scrape-broward.ts so a live
 * scrape stays titled; also exposed via the CLI below.
 */
export async function enrichCourseLeafTitles(opts: {
  college: string;
  catalogBase: string;
  dropUntitled?: boolean;
}): Promise<void> {
  const college = opts.college;
  const base = opts.catalogBase.replace(/\/$/, "");
  const dropUntitled = !!opts.dropUntitled;
  const dir = join(process.cwd(), "data", "fl", "courses", college);
  if (!existsSync(dir)) throw new Error(`No course dir: ${dir}`);

  console.log(`Building title map from ${base} ...`);
  const map = await buildTitleMap(base);
  console.log(`  catalog title map: ${map.size} courses`);

  // Fallback for courses scheduled but missing from the catalog course pages
  // (broward's vocational/clock-hour courses like AMT aren't under
  // /course-descriptions/). Florida's SCNS means PREFIX+NUMBER -> title is
  // shared statewide, so borrow the most-common title from other FL colleges.
  // Only used where the college's own catalog has no entry.
  const scns = new Map<string, string>();
  {
    const counts = new Map<string, Map<string, number>>();
    const flRoot = join(process.cwd(), "data", "fl", "courses");
    for (const c of readdirSync(flRoot)) {
      if (c === college) continue;
      const cdir = join(flRoot, c);
      if (!existsSync(cdir)) continue;
      for (const f of readdirSync(cdir).filter((x) => x.endsWith(".json"))) {
        let rows: Array<{ course_prefix?: string; course_number?: string; course_title?: string }>;
        try { rows = JSON.parse(readFileSync(join(cdir, f), "utf8")); } catch { continue; }
        for (const r of rows) {
          const t = (r.course_title || "").trim();
          if (!t) continue;
          const code = `${(r.course_prefix || "").toUpperCase()}${(r.course_number || "").toUpperCase()}`;
          if (!counts.has(code)) counts.set(code, new Map());
          const m = counts.get(code)!;
          m.set(t, (m.get(t) ?? 0) + 1);
        }
      }
    }
    for (const [code, m] of counts) {
      scns.set(code, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]);
    }
  }
  console.log(`  SCNS fallback map: ${scns.size} courses (from other FL colleges)`);

  let filled = 0;
  let stillEmpty = 0;
  let dropped = 0;
  let total = 0;
  const misses = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const path = join(dir, file);
    const rows = JSON.parse(readFileSync(path, "utf8")) as Array<{
      course_prefix?: string;
      course_number?: string;
      course_title?: string;
    }>;
    let changed = false;
    for (const r of rows) {
      total++;
      if ((r.course_title || "").trim()) continue;
      const code = `${(r.course_prefix || "").toUpperCase()}${(r.course_number || "").toUpperCase()}`;
      const t = map.get(code) ?? scns.get(code);
      if (t) {
        r.course_title = t;
        filled++;
        changed = true;
      } else {
        stillEmpty++;
        misses.add(code);
      }
    }
    // --drop-untitled: omit sections we still can't title (broward's vocational
    // / clock-hour courses, e.g. AMT, are absent from every catalog source).
    // Better to ship the titled majority than abort the whole college on an
    // untitleable tail. We OMIT incomplete rows — never fabricate a title.
    let outRows: typeof rows = rows;
    if (dropUntitled) {
      const before = rows.length;
      outRows = rows.filter((r) => (r.course_title || "").trim());
      const d = before - outRows.length;
      if (d > 0) { dropped += d; changed = true; }
    }
    if (changed) writeFileSync(path, JSON.stringify(outRows, null, 2) + "\n");
  }
  console.log(
    `\n${college}: ${total} rows — filled ${filled}, still empty ${stillEmpty}` +
      (dropUntitled ? `, dropped ${dropped} untitleable` : "")
  );
  if (misses.size) {
    console.log(`  unmatched codes (${misses.size}): ${[...misses].slice(0, 15).join(", ")}${misses.size > 15 ? " …" : ""}`);
  }
}

// CLI: `tsx scripts/fl/enrich-courseleaf-titles.ts --college broward --catalog <url> [--drop-untitled]`
const isDirectRun =
  import.meta.url.startsWith("file:") &&
  import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  const college = arg("college");
  const catalog = arg("catalog");
  if (!college || !catalog) {
    console.error("Usage: --college <slug> --catalog <https://catalog.host> [--drop-untitled]");
    process.exit(1);
  }
  enrichCourseLeafTitles({
    college,
    catalogBase: catalog,
    dropUntitled: process.argv.includes("--drop-untitled"),
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

/**
 * Fill empty course_title for an FL college using Florida's statewide course
 * numbering (SCNS): a given PREFIX+NUMBER carries the same course statewide, so
 * borrow the most-common title for that code from the *other* FL colleges that
 * already have titles. Sections still untitled after that (a code no other FL
 * college lists) are dropped when --drop-untitled is set — never fabricated.
 *
 * Why: scrape-seminolestate.ts scrapes the catalog SPA but currently captures
 * no course title (all rows have course_title ""), so every (college, term)
 * aborted on the title-required schema check and Seminole State showed 0
 * courses on prod. Its own catalog is a JS-rendered SPA we can't cleanly fetch;
 * the cross-college SCNS map covers ~77%.
 *
 * NOTE: the authoritative 100% source is the SCNS flat file (flscns.fldoe.org,
 * parsed in scrape-scns-flatfile.ts at offset 29-179) — wiring that in would
 * also title broward's vocational tail. Tracked as a follow-up; this uses the
 * already-on-disk cross-college titles to ship now.
 *
 * Usage:
 *   npx tsx scripts/fl/enrich-scns-titles.ts --college seminolestate [--drop-untitled]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const FL_COURSES = join(process.cwd(), "data", "fl", "courses");

interface Row {
  course_prefix?: string;
  course_number?: string;
  course_title?: string;
}

const codeOf = (r: Row) =>
  `${(r.course_prefix || "").toUpperCase()}|${(r.course_number || "").toUpperCase()}`;

/** Most-common title per PREFIX|NUMBER across all FL colleges except `exclude`. */
export function buildScnsTitleMap(exclude: string): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const college of readdirSync(FL_COURSES)) {
    if (college === exclude) continue;
    const dir = join(FL_COURSES, college);
    if (!statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      let rows: Row[];
      try { rows = JSON.parse(readFileSync(join(dir, f), "utf8")); } catch { continue; }
      for (const r of rows) {
        const t = (r.course_title || "").trim();
        if (!t) continue;
        const code = codeOf(r);
        if (!counts.has(code)) counts.set(code, new Map());
        const m = counts.get(code)!;
        m.set(t, (m.get(t) ?? 0) + 1);
      }
    }
  }
  const map = new Map<string, string>();
  for (const [code, m] of counts) {
    map.set(code, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  }
  return map;
}

export function enrichScnsTitles(opts: { college: string; dropUntitled?: boolean }): void {
  const { college } = opts;
  const dropUntitled = !!opts.dropUntitled;
  const dir = join(FL_COURSES, college);
  if (!existsSync(dir)) throw new Error(`No course dir: ${dir}`);

  const map = buildScnsTitleMap(college);
  console.log(`  SCNS title map: ${map.size} codes (from other FL colleges)`);

  let total = 0, filled = 0, dropped = 0, stillEmpty = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const path = join(dir, f);
    const rows = JSON.parse(readFileSync(path, "utf8")) as Row[];
    for (const r of rows) {
      total++;
      if ((r.course_title || "").trim()) continue;
      const t = map.get(codeOf(r));
      if (t) { r.course_title = t; filled++; } else stillEmpty++;
    }
    let out = rows;
    if (dropUntitled) {
      const before = rows.length;
      out = rows.filter((r) => (r.course_title || "").trim());
      dropped += before - out.length;
    }
    writeFileSync(path, JSON.stringify(out, null, 2) + "\n");
  }
  console.log(
    `  ${college}: ${total} rows — filled ${filled}, still empty ${stillEmpty}` +
      (dropUntitled ? `, dropped ${dropped}` : "")
  );
}

const isDirectRun =
  import.meta.url.startsWith("file:") &&
  import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  const args = process.argv.slice(2);
  const college = args[args.indexOf("--college") + 1];
  if (!college || college.startsWith("--")) {
    console.error("Usage: --college <slug> [--drop-untitled]");
    process.exit(1);
  }
  enrichScnsTitles({ college, dropUntitled: args.includes("--drop-untitled") });
}

export {};

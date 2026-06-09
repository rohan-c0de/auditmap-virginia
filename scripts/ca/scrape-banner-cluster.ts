/**
 * scrape-banner-cluster.ts
 *
 * California multi-college Banner SSB 9 *district* scraper.
 *
 * Three CA community-college districts run ONE public Banner SSB instance
 * that serves all of their member colleges from a single class-search feed.
 * The only way to tell which college a section belongs to is the
 * `campusDescription` field on each section. This scraper:
 *
 *   1. establishes a session against the district's single Banner host,
 *   2. fetches EVERY section across the whole instance once (paginated),
 *   3. buckets each section to a college slug by `campusDescription`,
 *   4. converts with the shared lib's `convertSection`, and
 *   5. writes per-college files at data/ca/courses/<slug>/<TERM>.json.
 *
 * This is deliberately NOT the per-host `scrapeBannerSsbCollege` flow (which
 * fetches the whole instance once *per college* and would triple the work and
 * mis-attribute sections). Splitting one feed across colleges is the entire
 * point — it also fixes a prior bug where KCCD's bakersfield-college and
 * porterville-college files each held the WHOLE-district mix (BC + CC +
 * Porterville sections), and cerro-coso-community-college had no file at all.
 *
 * Reuses the shared Banner SSB primitives from scripts/lib/scrape-banner-ssb.ts:
 *   getTerms, initSession, buildSubjectMap, searchSections, fetchPrerequisites,
 *   convertSection, defaultTermCodeToStandard, and the BannerSection type.
 * Term selection reuses pickRecentSsbTerms from scripts/lib/resolve-terms.ts.
 *
 * No Supabase import — this script only writes JSON. Import is a separate step.
 *
 * Usage:
 *   npx tsx scripts/ca/scrape-banner-cluster.ts
 *   npx tsx scripts/ca/scrape-banner-cluster.ts --district smcccd
 *   npx tsx scripts/ca/scrape-banner-cluster.ts --college skyline-college
 *   npx tsx scripts/ca/scrape-banner-cluster.ts --term 2026FA
 *   npx tsx scripts/ca/scrape-banner-cluster.ts --dry-run
 *
 * Flags compose: --district + --term restricts to one district + one term;
 * --college restricts output to one slug (the whole instance is still fetched,
 * since one fetch feeds every college, but only the chosen slug is written).
 */

import fs from "fs";
import path from "path";
import {
  BannerSection,
  ConvertedSection,
  PrereqInfo,
  ScraperHooks,
  getTerms,
  initSession,
  buildSubjectMap,
  searchSections,
  fetchPrerequisites,
  convertSection,
  defaultTermCodeToStandard,
} from "../lib/scrape-banner-ssb";
import { pickRecentSsbTerms } from "../lib/resolve-terms";

// Several CA Banner instances ship self-signed / chained certs that Node
// rejects by default. Matches the existing GA / resolve-terms escape hatch.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const STATE = "ca";
const APP_CONTEXT = "StudentRegistrationSsb";

// ---------------------------------------------------------------------------
// District definitions
//
// `campusToSlug` returns the college slug for a given raw `campusDescription`,
// or null if the section does not belong to any of this district's colleges
// (those are dropped and counted/reported for audit).
// ---------------------------------------------------------------------------

interface District {
  /** Short identifier used by --district and in logs. */
  name: string;
  /** Human-readable district name. */
  label: string;
  /** Banner SSB base host, no trailing slash. */
  baseUrl: string;
  /** All college slugs this district can produce (for the report + dry-run accounting). */
  slugs: string[];
  /** Resolve a raw campusDescription to a college slug, or null to drop. */
  campusToSlug: (campusDescription: string) => string | null;
}

const DISTRICTS: District[] = [
  {
    name: "smcccd",
    label: "San Mateo County CCD",
    baseUrl: "https://phx-ban-apps.smccd.edu",
    slugs: ["skyline-college", "canada-college", "college-of-san-mateo"],
    campusToSlug: (c) => {
      // SMCCCD uses exact full college names. Note: "Canada College" is
      // spelled WITHOUT the ñ in the data, matching the slug canada-college.
      const t = (c || "").trim();
      if (t === "Skyline College") return "skyline-college";
      if (t === "Canada College") return "canada-college";
      if (t === "College of San Mateo") return "college-of-san-mateo";
      return null;
    },
  },
  {
    name: "clpccd",
    label: "Chabot–Las Positas CCD",
    baseUrl: "https://banssprod.clpccd.cc.ca.us",
    slugs: ["chabot-college", "las-positas-college"],
    campusToSlug: (c) => {
      const t = (c || "").trim();
      if (t === "Chabot College") return "chabot-college";
      if (t === "Las Positas College") return "las-positas-college";
      return null;
    },
  },
  {
    name: "kccd",
    label: "Kern CCD",
    baseUrl: "https://reg-prod.ec.kccd.edu",
    slugs: [
      "bakersfield-college",
      "porterville-college",
      "cerro-coso-community-college",
    ],
    campusToSlug: (c) => {
      // KCCD prefixes every campus with a college tag:
      //   "BC ..."           -> Bakersfield College
      //   "Porterville ..."  -> Porterville College
      //   "CC ..."           -> Cerro Coso Community College
      // (Prior bug: BC/Porterville files each held the whole-district mix.)
      const t = (c || "").trim();
      if (t.startsWith("BC ")) return "bakersfield-college";
      if (t.startsWith("Porterville")) return "porterville-college";
      if (t.startsWith("CC ")) return "cerro-coso-community-college";
      return null;
    },
  },
];

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

interface Args {
  district?: string;
  college?: string;
  /** Standardized term filters (e.g. "2026FA"). Empty = all upcoming terms. */
  terms?: Set<string>;
  dryRun: boolean;
  help: boolean;
}

/**
 * Normalize a single --term token to standardized "YYYYxx" form. Accepts both
 * the standardized form ("2026FA") and the human-readable form the cron runner
 * passes from resolve-terms.ts ("Fall 2026"). Returns null if it can't parse.
 */
function normalizeTermToken(raw: string): string | null {
  const t = raw.trim();
  if (/^20\d{2}(FA|SP|SU)$/i.test(t)) return t.toUpperCase();
  const year = t.match(/\b(20\d{2})\b/)?.[1];
  if (!year) return null;
  const lower = t.toLowerCase();
  if (lower.includes("fall")) return `${year}FA`;
  if (lower.includes("spring") || lower.includes("winter")) return `${year}SP`;
  if (lower.includes("summer")) return `${year}SU`;
  return null;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { dryRun: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--help" || a === "-h") out.help = true;
    // --no-import is a no-op here: this scraper never imports to Supabase, it
    // only writes JSON. The unified cron runner passes it to every course
    // scraper (scheduled-scrape-v2.yml), so accept it silently.
    else if (a === "--no-import") {
      /* no-op */
    } else if (a === "--district") out.district = argv[++i]?.toLowerCase();
    else if (a === "--college") out.college = argv[++i];
    else if (a === "--term") {
      // The cron runner passes a comma-separated human-readable list
      // ("Fall 2026,Summer 2026"); a human may pass "2026FA". Accept both.
      const val = argv[++i] ?? "";
      out.terms = out.terms ?? new Set<string>();
      for (const tok of val.split(",")) {
        const std = normalizeTermToken(tok);
        if (std) out.terms.add(std);
        else if (tok.trim())
          console.error(`  WARNING: could not parse --term token "${tok.trim()}"`);
      }
    } else {
      console.error(`Unknown argument: ${a}`);
      out.help = true;
    }
  }
  return out;
}

function printHelp() {
  console.log(`California Banner SSB cluster scraper (3 districts, split by campusDescription)

Usage:
  npx tsx scripts/ca/scrape-banner-cluster.ts [--district <name>] [--college <slug>] [--term <2026FA>] [--dry-run]

Flags:
  --district <name>   Only scrape one district: ${DISTRICTS.map((d) => d.name).join(", ")}
  --college <slug>    Only write output for this college slug (whole instance is still fetched)
  --term <terms>      Only write these terms. Accepts standardized ("2026FA")
                      or human-readable ("Fall 2026"), comma-separated for multiple
  --no-import         No-op (this scraper never imports); accepted for cron parity
  --dry-run           Fetch + bucket + convert, but write no files
  --help              Show this help

Output: data/ca/courses/<slug>/<TERM>.json  (no Supabase import)`);
}

// ---------------------------------------------------------------------------
// Reporting accumulators
// ---------------------------------------------------------------------------

interface CountRow {
  slug: string;
  term: string;
  count: number;
  sample: ConvertedSection | null;
}

const countRows: CountRow[] = [];
const unmatchedByDistrict = new Map<string, Map<string, number>>();
const errors: string[] = [];

function recordUnmatched(district: string, campus: string) {
  let m = unmatchedByDistrict.get(district);
  if (!m) {
    m = new Map();
    unmatchedByDistrict.set(district, m);
  }
  const key = campus || "(empty)";
  m.set(key, (m.get(key) || 0) + 1);
}

// ---------------------------------------------------------------------------
// Per-district scrape
// ---------------------------------------------------------------------------

// We pass empty hooks → convertSection uses defaultDetectMode + raw
// campusDescription as the `campus` field, identical to the canonical flavor.
const HOOKS: ScraperHooks = {};

async function scrapeDistrict(district: District, args: Args): Promise<void> {
  console.log(`\n========================================`);
  console.log(`District: ${district.label} (${district.name})`);
  console.log(`Host: ${district.baseUrl}`);
  console.log(`========================================`);

  let terms;
  try {
    terms = await getTerms(district.baseUrl, undefined, APP_CONTEXT);
  } catch (e) {
    const msg = `[${district.name}] Could not fetch terms from ${district.baseUrl}: ${e}`;
    console.error(`  ERROR: ${msg}`);
    errors.push(msg);
    return;
  }

  // pickRecentSsbTerms drops "(View Only)" and past terms, keeping
  // current-calendar-term-and-later (Fall 2026 + Summer 2026 today).
  let targetTerms = pickRecentSsbTerms(terms);

  if (targetTerms.length === 0) {
    const msg = `[${district.name}] No upcoming terms. Available: ${terms
      .map((t) => `${t.description} (${t.code})`)
      .join(", ")}`;
    console.error(`  WARNING: ${msg}`);
    errors.push(msg);
    return;
  }

  // Apply --term filter (compare against the standardized form).
  if (args.terms && args.terms.size > 0) {
    targetTerms = targetTerms.filter((t) =>
      args.terms!.has(defaultTermCodeToStandard(t.code, t.description))
    );
    if (targetTerms.length === 0) {
      console.log(
        `  --term ${[...args.terms].join(",")} not among upcoming terms for ${district.name}; skipping.`
      );
      return;
    }
  }

  console.log(
    `  Terms to scrape: ${targetTerms
      .map((t) => `${t.description} (${t.code})`)
      .join(", ")}`
  );

  for (const term of targetTerms) {
    const standardTerm = defaultTermCodeToStandard(term.code, term.description);
    console.log(`\n  --- ${term.description} (${term.code} -> ${standardTerm}) ---`);

    try {
      await scrapeDistrictTerm(district, term.code, standardTerm, args);
    } catch (e) {
      const msg = `[${district.name}] Error scraping ${term.description}: ${e}`;
      console.error(`  ${msg}`);
      errors.push(msg);
    }
  }
}

async function scrapeDistrictTerm(
  district: District,
  termCode: string,
  standardTerm: string,
  args: Args
): Promise<void> {
  const cookies = await initSession(district.baseUrl, termCode, undefined, APP_CONTEXT);
  const subjectMap = await buildSubjectMap(
    district.baseUrl,
    termCode,
    cookies,
    undefined,
    APP_CONTEXT
  );
  console.log(`    Subject map: ${subjectMap.size} subjects`);

  const allSections = await searchSections(
    district.baseUrl,
    termCode,
    cookies,
    (m) => process.stdout.write(`\r    ${m.trim()}        `),
    undefined,
    APP_CONTEXT
  );
  process.stdout.write("\n");
  console.log(`    Fetched ${allSections.length} sections (whole instance)`);

  // Bucket sections by college slug.
  const bySlug = new Map<string, BannerSection[]>();
  let droppedCount = 0;
  for (const s of allSections) {
    const slug = district.campusToSlug(s.campusDescription || "");
    if (!slug) {
      droppedCount++;
      recordUnmatched(district.name, s.campusDescription || "");
      continue;
    }
    let arr = bySlug.get(slug);
    if (!arr) {
      arr = [];
      bySlug.set(slug, arr);
    }
    arr.push(s);
  }

  console.log(
    `    Bucketed: ${[...bySlug.entries()]
      .map(([slug, arr]) => `${slug}=${arr.length}`)
      .join(", ")}${droppedCount ? ` | dropped(unmatched)=${droppedCount}` : ""}`
  );

  // Prerequisites are course-level (subject+number), not section-level, and
  // courses can span colleges. Fetch ONCE for the whole instance and share the
  // map across all colleges — far fewer requests than per-college fetches.
  const prereqs = await fetchPrerequisites(
    district.baseUrl,
    termCode,
    allSections,
    cookies,
    subjectMap,
    (m) => process.stdout.write(`\r    ${m.trim()}        `),
    undefined,
    APP_CONTEXT
  );
  process.stdout.write("\n");
  console.log(`    Prereqs found for ${prereqs.size} courses`);

  // Convert + write per college.
  for (const slug of district.slugs) {
    if (args.college && args.college !== slug) continue;

    const sections = bySlug.get(slug) || [];
    if (sections.length === 0) {
      // Never write empty/stub files — leave existing data untouched.
      console.log(`    ${slug}: 0 sections — writing nothing.`);
      countRows.push({ slug, term: standardTerm, count: 0, sample: null });
      continue;
    }

    const converted: ConvertedSection[] = sections.map((s) => {
      const courseKey = `${s.subject} ${s.courseNumber}`;
      const prereq: PrereqInfo | undefined = prereqs.get(courseKey);
      return convertSection(s, slug, standardTerm, prereq, HOOKS);
    });

    if (!args.dryRun) {
      const outDir = path.join(process.cwd(), "data", STATE, "courses", slug);
      fs.mkdirSync(outDir, { recursive: true });
      const outFile = path.join(outDir, `${standardTerm}.json`);
      fs.writeFileSync(outFile, JSON.stringify(converted, null, 2));
    }

    const withPrereqs = converted.filter((c) => c.prerequisite_text).length;
    console.log(
      `    ${slug}: ${converted.length} sections${
        args.dryRun ? " (dry-run, not written)" : ` -> ${standardTerm}.json`
      } (${withPrereqs} with prereqs)`
    );
    countRows.push({
      slug,
      term: standardTerm,
      count: converted.length,
      sample: converted[0],
    });
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function printReport(args: Args) {
  console.log(`\n\n========================================`);
  console.log(`SUMMARY${args.dryRun ? " (DRY RUN — nothing written)" : ""}`);
  console.log(`========================================`);

  console.log(`\nslug -> term -> count:`);
  const sorted = [...countRows].sort(
    (a, b) => a.slug.localeCompare(b.slug) || a.term.localeCompare(b.term)
  );
  for (const r of sorted) {
    console.log(`  ${r.slug.padEnd(34)} ${r.term}  ${String(r.count).padStart(6)}`);
  }

  console.log(`\nOne sample row per college (first written term):`);
  const seen = new Set<string>();
  for (const r of sorted) {
    if (r.count === 0 || seen.has(r.slug) || !r.sample) continue;
    seen.add(r.slug);
    const s = r.sample;
    console.log(
      `  ${r.slug} [${r.term}]: ${s.course_prefix} ${s.course_number} "${s.course_title}" ` +
        `crn=${s.crn} campus="${s.campus}" mode=${s.mode} ` +
        `days="${s.days}" ${s.start_time}-${s.end_time} seats=${s.seats_open}/${s.seats_total} ` +
        `instr=${JSON.stringify(s.instructor)}`
    );
  }

  console.log(`\nUnmatched campusDescription values (dropped sections):`);
  if (unmatchedByDistrict.size === 0) {
    console.log(`  (none — every section matched a college)`);
  } else {
    for (const [district, m] of unmatchedByDistrict) {
      console.log(`  [${district}]`);
      for (const [campus, count] of [...m.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`    ${JSON.stringify(campus)}: ${count}`);
      }
    }
  }

  if (errors.length > 0) {
    console.log(`\nErrors:`);
    for (const e of errors) console.log(`  - ${e}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // Validate --college belongs to some district.
  if (args.college) {
    const known = DISTRICTS.some((d) => d.slugs.includes(args.college!));
    if (!known) {
      console.error(
        `Unknown --college "${args.college}". Known slugs: ${DISTRICTS.flatMap(
          (d) => d.slugs
        ).join(", ")}`
      );
      process.exit(1);
    }
  }

  // Select districts: explicit --district, else the district that owns --college,
  // else all.
  let districts = DISTRICTS;
  if (args.district) {
    districts = DISTRICTS.filter((d) => d.name === args.district);
    if (districts.length === 0) {
      console.error(
        `Unknown --district "${args.district}". Known: ${DISTRICTS.map((d) => d.name).join(", ")}`
      );
      process.exit(1);
    }
  } else if (args.college) {
    districts = DISTRICTS.filter((d) => d.slugs.includes(args.college!));
  }

  console.log(
    `California Banner cluster scrape — districts: ${districts
      .map((d) => d.name)
      .join(", ")}${args.college ? ` | college=${args.college}` : ""}${
      args.terms && args.terms.size > 0 ? ` | term=${[...args.terms].join(",")}` : ""
    }${args.dryRun ? " | DRY RUN" : ""}`
  );

  for (const district of districts) {
    await scrapeDistrict(district, args);
  }

  printReport(args);

  // Exit non-zero only if every district errored and nothing was produced.
  const anyData = countRows.some((r) => r.count > 0);
  if (!anyData && errors.length > 0) {
    process.exit(1);
  }
}

const isMain =
  import.meta.url.startsWith("file:") &&
  process.argv[1] &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  main().catch((e) => {
    console.error("Fatal:", e);
    process.exit(1);
  });
}

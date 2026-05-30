/**
 * Alabama — Statewide Transfer & Articulation (formerly STARS, now
 * "Alabama Transfers") scraper.
 *
 * The legacy `stars.troy.edu` host the auto-add-state TODO mentioned
 * doesn't resolve anymore — STARS was rebranded to Alabama Transfers
 * at alabamatransfers.com. The new site is a SvelteKit frontend backed
 * by a CraftCMS instance whose GraphQL API is publicly readable at
 *   https://admin.alabamatransfers.com/api
 *
 * Data model (per the AGSC framework):
 *   - 276 AGSC master courses, each with a canonical prefix+number
 *     (e.g. "AGP 130 · Poultry Production"). When any of the 23 AL
 *     community colleges teaches an AGSC course, it teaches it under
 *     this same prefix+number — that's the whole point of AGSC.
 *   - 14 receiving 4-year universities. Each maps every AGSC master
 *     course to its own catalog (e.g. AGSC AGP 130 ≡ Auburn POUL 1000).
 *   - The `courses` Craft entries hold the master list; each has a
 *     `courseEquivalencyTable` field of `coursesUniversitySpecific`
 *     entries — one row per university mapping. That's the equivalency
 *     data.
 *
 * Output schema matches the canonical transfer-equiv.json shape (see
 * data/nc/transfer-equiv.json or data/ga/transfer-equiv.json): an array
 * of { cc_prefix, cc_number, cc_course, cc_title, university, univ_*,
 * notes, no_credit, is_elective } records. We emit one row per
 * (AGSC course × university × AL CC). Records for CCs that don't
 * actually offer a given AGSC course are harmless — the UI filters
 * by what each CC actually scrapes.
 *
 * Usage:
 *   npx tsx scripts/al/scrape-transfer-stars.ts
 *   npx tsx scripts/al/scrape-transfer-stars.ts --dry-run
 */

import * as fs from "fs";
import * as path from "path";

const GRAPHQL_URL = "https://admin.alabamatransfers.com/api";
const STATE = "al";
const OUT_PATH = path.join(process.cwd(), "data", STATE, "transfer-equiv.json");

// All 23 ACCS community colleges (slugs from data/al/institutions.json).
// AGSC equivalencies are *system-wide* — an AGSC course at any AL CC
// shares the same prefix+number and therefore the same equivalency.
const ALL_AL_CCS: string[] = [
  "bevill-state-community-college",
  "bishop-state-community-college",
  "central-alabama-community-college",
  "chattahoochee-valley-community-college",
  "coastal-alabama-community-college",
  "enterprise-state-community-college",
  "gadsden-state-community-college",
  "george-c-wallace-community-college-dothan",
  "george-c-wallace-state-community-college-hanceville",
  "george-c-wallace-state-community-college-selma",
  "h-councill-trenholm-state-community-college",
  "j-f-drake-state-community-and-technical-college",
  "jefferson-state-community-college",
  "john-c-calhoun-state-community-college",
  "lawson-state-community-college",
  "lurleen-b-wallace-community-college",
  "marion-military-institute",
  "northeast-alabama-community-college",
  "northwest-shoals-community-college",
  "reid-state-technical-college",
  "shelton-state-community-college",
  "snead-state-community-college",
  "southern-union-state-community-college",
];

interface UniversitySpecificEntry {
  title: string;
  university: { title: string; slug: string }[];
  universityCourseAbbreviation: { title: string }[] | null;
  courseNumber: string | null;
  courseName: string | null;
  semesterHours: number | null;
  isAgscApproved: boolean | null;
  isLab: boolean | null;
  courseNote: string | null;
}

interface AgscCourseEntry {
  title: string;
  slug: string;
  courseAbbreviation: { title: string }[] | null;
  courseNumber: string | null;
  courseName: string | null;
  semesterHours: number | null;
  courseAreaNumber: number | null;
  courseEquivalencyTable: UniversitySpecificEntry[] | null;
}

interface TransferEquivRow {
  state: string;
  cc_prefix: string;
  cc_number: string;
  cc_course: string;
  cc_title: string;
  cc_credits: string;
  university: string;
  university_name: string;
  univ_course: string;
  univ_title: string;
  univ_credits: string;
  notes: string;
  no_credit: boolean;
  is_elective: boolean;
}

async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: variables ?? {} }),
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);
  const body = await res.json();
  if (body.errors) throw new Error(`GraphQL errors: ${JSON.stringify(body.errors)}`);
  return body.data as T;
}

const AGSC_COURSE_QUERY = `
  query AgscCourses($offset: Int!, $limit: Int!) {
    entries(section: "courses", offset: $offset, limit: $limit) {
      ... on courses_courses_Entry {
        title
        slug
        courseAbbreviation { title }
        courseNumber
        courseName
        semesterHours
        courseAreaNumber
        courseEquivalencyTable {
          ... on coursesUniversitySpecific_default_Entry {
            title
            university { title slug }
            universityCourseAbbreviation { title }
            courseNumber
            courseName
            semesterHours
            isAgscApproved
            isLab
            courseNote
          }
        }
      }
    }
  }
`;

async function fetchAllAgscCourses(): Promise<AgscCourseEntry[]> {
  const PAGE = 50;
  const all: AgscCourseEntry[] = [];
  let offset = 0;
  while (true) {
    const data = await gql<{ entries: AgscCourseEntry[] }>(AGSC_COURSE_QUERY, {
      offset,
      limit: PAGE,
    });
    const batch = data.entries ?? [];
    all.push(...batch);
    console.log(`  fetched ${all.length} AGSC courses`);
    if (batch.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

function buildRows(agsc: AgscCourseEntry[]): TransferEquivRow[] {
  const out: TransferEquivRow[] = [];
  for (const c of agsc) {
    const ccPrefix = c.courseAbbreviation?.[0]?.title?.trim();
    const ccNumber = c.courseNumber?.trim();
    if (!ccPrefix || !ccNumber) continue;
    const ccTitle = c.courseName?.trim() || "";
    const ccCredits = c.semesterHours != null ? String(c.semesterHours) : "";

    const mappings = c.courseEquivalencyTable ?? [];
    for (const m of mappings) {
      const univEntry = m.university?.[0];
      if (!univEntry) continue;
      const univPrefix = m.universityCourseAbbreviation?.[0]?.title?.trim() || "";
      const univNumber = m.courseNumber?.trim() || "";
      const univCourse = [univPrefix, univNumber].filter(Boolean).join(" ").trim();
      const univTitle = m.courseName?.trim() || "";
      const univCredits = m.semesterHours != null ? String(m.semesterHours) : "";
      // AGSC course not approved at this university = transfers as elective
      const isElective = m.isAgscApproved === false;
      // The CraftCMS data doesn't have explicit "no credit" flags. If the
      // university hasn't published a mapping at all the entry just wouldn't
      // exist, so every record here is credit-bearing by definition.
      const notes = m.courseNote?.trim() || "";

      for (const cc of ALL_AL_CCS) {
        out.push({
          state: STATE,
          cc_prefix: ccPrefix,
          cc_number: ccNumber,
          cc_course: `${ccPrefix} ${ccNumber}`,
          cc_title: ccTitle,
          cc_credits: ccCredits,
          university: univEntry.slug,
          university_name: univEntry.title,
          univ_course: univCourse,
          univ_title: univTitle,
          univ_credits: univCredits,
          notes,
          no_credit: false,
          is_elective: isElective,
        });
      }
    }
  }
  return out;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  console.log("🍑 Alabama Transfers (STARS) scraper");
  console.log(`   GraphQL: ${GRAPHQL_URL}`);

  console.log("\n• Fetching AGSC master courses…");
  const agsc = await fetchAllAgscCourses();
  console.log(`  ${agsc.length} AGSC courses`);

  const withMappings = agsc.filter(
    (c) => (c.courseEquivalencyTable?.length ?? 0) > 0
  ).length;
  console.log(`  ${withMappings} courses have at least one university mapping`);

  console.log("\n• Cross-producting against 23 AL community colleges…");
  const rows = buildRows(agsc);
  console.log(`  ${rows.length.toLocaleString()} transfer-equiv records`);

  // Summary by university
  const byUniv: Record<string, number> = {};
  for (const r of rows) byUniv[r.university] = (byUniv[r.university] || 0) + 1;
  console.log("\n  Per university:");
  for (const [u, n] of Object.entries(byUniv).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${u}: ${n.toLocaleString()}`);
  }

  if (dryRun) {
    console.log("\n(dry-run; nothing written)");
    return;
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(rows, null, 2) + "\n");
  console.log(`\n✅ Wrote ${rows.length.toLocaleString()} records → ${OUT_PATH}`);
}

main().catch((err) => {
  console.error("❌ STARS scraper failed:", err);
  process.exit(1);
});

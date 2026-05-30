/**
 * Illinois Eastern Community Colleges (IECC) — shared Banner SSB scraper
 *
 * Covers all 4 IECC colleges from a single Banner Student Self-Service
 * instance at https://banprodss1.iecc.edu:8447. The campusDescription
 * field on each section identifies which college owns it:
 *
 *   FRONTIER COMMUNITY COLLEGE → frontier-community-college
 *   LINCOLN TRAIL COLLEGE      → lincoln-trail-college
 *   OLNEY CENTRAL COLLEGE      → olney-central-college
 *   WABASH VALLEY COLLEGE      → wabash-valley-college
 *
 * "WORKFORCE EDUCATION" sections (a fifth campus filter on IECC's portal)
 * are dropped — they're non-credit training, not part of the credit catalog.
 *
 * One Banner session is initialized per term, sections are pulled in a single
 * paginated sweep, then split by campusDescription into 4 buckets. Prereqs
 * are fetched once per (subject, course-number) and reused across colleges.
 */
import fs from "fs";
import path from "path";
import {
  type BannerSection,
  type ConvertedSection,
  type PrereqInfo,
  buildSubjectMap,
  convertSection,
  defaultTermCodeToStandard,
  fetchPrerequisites,
  getTerms,
  initSession,
  searchSections,
} from "../lib/scrape-banner-ssb";
import { pickRecentSsbTerms } from "../lib/resolve-terms";

const STATE = "il";
const BASE_URL = "https://banprodss1.iecc.edu:8447";

const CAMPUS_TO_SLUG: Record<string, string> = {
  "FRONTIER COMMUNITY COLLEGE": "frontier-community-college",
  "LINCOLN TRAIL COLLEGE": "lincoln-trail-college",
  "OLNEY CENTRAL COLLEGE": "olney-central-college",
  "WABASH VALLEY COLLEGE": "wabash-valley-college",
};

function pickCollegeSlug(s: BannerSection): string | null {
  const campus =
    s.meetingsFaculty?.[0]?.meetingTime?.campusDescription ||
    s.campusDescription ||
    "";
  return CAMPUS_TO_SLUG[campus.trim().toUpperCase()] ?? null;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const collegeFilter = args
    .find((a) => a.startsWith("--college="))
    ?.split("=")[1];

  console.log("🟢 IECC Banner SSB scraper");
  console.log(`   Host: ${BASE_URL}`);

  const terms = await getTerms(BASE_URL);
  const targetTerms = pickRecentSsbTerms(terms);
  if (targetTerms.length === 0) {
    console.log(`   No active terms found. Available: ${terms.map((t) => t.description).join(", ")}`);
    return;
  }
  console.log(`   Terms: ${targetTerms.map((t) => `${t.description} (${t.code})`).join(", ")}`);

  // Aggregate written counts per (slug, term) across the run.
  const summary: Record<string, Record<string, number>> = {};

  for (const term of targetTerms) {
    const standardTerm = defaultTermCodeToStandard(term.code, term.description);
    console.log(`\n   === ${term.description} (${term.code} → ${standardTerm}) ===`);

    const cookies = await initSession(BASE_URL, term.code);
    const subjectMap = await buildSubjectMap(BASE_URL, term.code, cookies);
    console.log(`     Subject map: ${subjectMap.size} subjects`);

    const sections = await searchSections(BASE_URL, term.code, cookies, (m) =>
      console.log(`     ${m}`)
    );
    if (sections.length === 0) {
      console.log("     No sections; skipping term.");
      continue;
    }

    // Bucket by college slug; drop unknown campuses (WORKFORCE EDUCATION etc.).
    const bySlug: Record<string, BannerSection[]> = {};
    let dropped = 0;
    for (const s of sections) {
      const slug = pickCollegeSlug(s);
      if (!slug) {
        dropped++;
        continue;
      }
      if (collegeFilter && slug !== collegeFilter) continue;
      (bySlug[slug] ||= []).push(s);
    }
    console.log(
      `     Split ${sections.length} sections: ${Object.entries(bySlug)
        .map(([k, v]) => `${k}=${v.length}`)
        .join(", ")}${dropped ? ` (dropped ${dropped} non-credit)` : ""}`
    );

    // Prereqs are course-level (subject+number) — fetch once across all colleges.
    const prereqs = await fetchPrerequisites(
      BASE_URL,
      term.code,
      sections,
      cookies,
      subjectMap,
      (m) => console.log(`     ${m}`)
    );
    console.log(`     Prereqs: ${prereqs.size} courses`);

    for (const [slug, slugSections] of Object.entries(bySlug)) {
      const converted: ConvertedSection[] = slugSections.map((s) => {
        const key = `${s.subject} ${s.courseNumber}`;
        const prereq: PrereqInfo | undefined = prereqs.get(key);
        return convertSection(s, slug, standardTerm, prereq, {});
      });

      const outDir = path.join(process.cwd(), "data", STATE, "courses", slug);
      const outFile = path.join(outDir, `${standardTerm}.json`);
      if (dryRun) {
        console.log(`     [dry-run] ${slug}/${standardTerm}.json — ${converted.length} sections`);
      } else {
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(outFile, JSON.stringify(converted, null, 2) + "\n");
        console.log(`     ✓ ${slug}/${standardTerm}.json — ${converted.length} sections`);
      }
      (summary[slug] ||= {})[standardTerm] = converted.length;
    }
  }

  const totalSections = Object.values(summary)
    .flatMap((t) => Object.values(t))
    .reduce((a, b) => a + b, 0);
  console.log(
    `\n✅ Done — ${totalSections} sections across ${Object.keys(summary).length} colleges.`
  );
}

main().catch((err) => {
  console.error("❌ IECC scraper failed:", err);
  process.exit(1);
});

/**
 * University of Hawaiʻi Community Colleges (UHCC) — shared Banner SSB scraper
 *
 * All 6 UHCC community colleges share a single Banner Student Self-Service
 * instance at https://myuh.hawaii.edu. A search there returns the entire UH
 * system (Manoa, Hilo, West Oahu, Maui, the 6 community colleges, and
 * "World Wide Web" online-only sections). The owning campus for each row
 * is in `s.campusDescription` (and / or `s.meetingsFaculty[0].meetingTime.
 * campusDescription`). We split by that field and keep only the 6 community
 * colleges in our registry; everything else (4-year campuses, Maui, online-
 * only sections without a campus attribution, off-campus, blank) is dropped.
 *
 *   Hawaii Community College    → hawaii-community-college
 *   Honolulu Community College  → honolulu-community-college
 *   Kapiolani Community College → kapiolani-community-college
 *   Kauai Community College     → kauai-community-college
 *   Leeward Community College   → leeward-community-college
 *   Windward Community College  → windward-community-college
 *
 * Background: the original Hawaiʻi scrape (commit cdc92e5) did NOT split by
 * campusDescription — it wrote the full UH-system union into three different
 * colleges' directories, attaching the wrong `college_code` to each row.
 * This script replaces that bad data and adds the three colleges that the
 * original scrape skipped entirely.
 *
 * One Banner session is initialized per term, sections are pulled in a
 * single paginated sweep, then split by campusDescription into 6 buckets.
 * Prereqs are fetched once per (subject, course-number) and reused across
 * colleges.
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

const STATE = "hi";
// Public, no-login Banner host used by UH's "Class Availability" portal
// at hawaii.edu/myuhinfo/class-availability/. The internal/auth-required
// host at myuh.hawaii.edu redirects to SAML SSO and is unusable for
// scraping.
const BASE_URL = "https://www.sis.hawaii.edu:9234";

const CAMPUS_TO_SLUG: Record<string, string> = {
  "HAWAII COMMUNITY COLLEGE": "hawaii-community-college",
  "HONOLULU COMMUNITY COLLEGE": "honolulu-community-college",
  "KAPIOLANI COMMUNITY COLLEGE": "kapiolani-community-college",
  "KAUAI COMMUNITY COLLEGE": "kauai-community-college",
  "LEEWARD COMMUNITY COLLEGE": "leeward-community-college",
  "WINDWARD COMMUNITY COLLEGE": "windward-community-college",
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

  console.log("🌺 UHCC Banner SSB scraper");
  console.log(`   Host: ${BASE_URL}`);

  const terms = await getTerms(BASE_URL);
  const targetTerms = pickRecentSsbTerms(terms);
  if (targetTerms.length === 0) {
    console.log(
      `   No active terms found. Available: ${terms.map((t) => t.description).join(", ")}`
    );
    return;
  }
  console.log(
    `   Terms: ${targetTerms.map((t) => `${t.description} (${t.code})`).join(", ")}`
  );

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

    // Bucket by college slug; drop unknown campuses (UH Manoa, Hilo, West
    // Oahu, Maui, World Wide Web online-only without campus, off-campus, …).
    const bySlug: Record<string, BannerSection[]> = {};
    const droppedByCampus: Record<string, number> = {};
    for (const s of sections) {
      const slug = pickCollegeSlug(s);
      if (!slug) {
        const campus =
          s.meetingsFaculty?.[0]?.meetingTime?.campusDescription ||
          s.campusDescription ||
          "(blank)";
        droppedByCampus[campus] = (droppedByCampus[campus] || 0) + 1;
        continue;
      }
      if (collegeFilter && slug !== collegeFilter) continue;
      (bySlug[slug] ||= []).push(s);
    }
    console.log(
      `     Split ${sections.length} sections: ${Object.entries(bySlug)
        .map(([k, v]) => `${k}=${v.length}`)
        .join(", ")}`
    );
    if (Object.keys(droppedByCampus).length) {
      const droppedSummary = Object.entries(droppedByCampus)
        .sort((a, b) => b[1] - a[1])
        .map(([c, n]) => `${c}=${n}`)
        .join(", ");
      console.log(`     Dropped (not a UHCC community college): ${droppedSummary}`);
    }

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
        console.log(
          `     [dry-run] ${slug}/${standardTerm}.json — ${converted.length} sections`
        );
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
  console.error("❌ UHCC scraper failed:", err);
  process.exit(1);
});

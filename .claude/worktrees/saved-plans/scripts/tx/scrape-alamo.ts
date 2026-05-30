/**
 * Alamo Colleges District (San Antonio, TX) — shared Banner SSB scraper
 *
 * All 5 Alamo colleges share a single Banner SSB 9 instance at
 *   https://lum010.alamo.edu:8010/StudentRegistrationSsb
 * exposed as the public "Schedule of Classes" link from the college sites.
 * The auth-gated aces.alamo.edu Banner is for enrolled students; the
 * lum010 host has guest read-only access (no SSO).
 *
 * Each section's `campusDescription` identifies the owning college:
 *
 *   Northeast Lakeview College → northeast-lakeview-college
 *   Northwest Vista College    → northwest-vista-college
 *   Palo Alto College          → palo-alto-college
 *   San Antonio College        → san-antonio-college
 *   St. Philip's College       → st-philips-college
 *
 * Resolves issue #456 cluster #2 (Alamo, 5 colleges, TX). Closes the
 * `[fingerprint] custom HTML/SPA` TODOs for all five colleges from
 * the original TX auto-add-state PR (#453).
 *
 * Identical structure to scripts/il/scrape-iecc.ts and
 * scripts/hi/scrape-uhcc.ts — one Banner session per term, single
 * paginated sweep, split by campusDescription, prereqs fetched once
 * per (subject, course-number).
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

const STATE = "tx";
const BASE_URL = "https://lum010.alamo.edu:8010";

// Keys are normalized form: lowercase, no punctuation. Alamo's Banner
// instance is inconsistent — sometimes campusDescription is the full
// college name ("San Antonio College"), sometimes the 3-letter code
// ("SAC"), sometimes the HTML-entity-encoded form ("St. Philip&#39;s
// College"). All three variants are mapped here.
const CAMPUS_TO_SLUG: Record<string, string> = {
  "northeast lakeview college": "northeast-lakeview-college",
  "northwest vista college": "northwest-vista-college",
  "palo alto college": "palo-alto-college",
  "san antonio college": "san-antonio-college",
  "st philips college": "st-philips-college",
  // 3-letter campus codes (also returned by Banner for some sections)
  nlc: "northeast-lakeview-college",
  nvc: "northwest-vista-college",
  pac: "palo-alto-college",
  sac: "san-antonio-college",
  spc: "st-philips-college",
};

function normalize(s: string): string {
  return s
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[.'"’`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function pickCollegeSlug(s: BannerSection): string | null {
  const campus =
    s.meetingsFaculty?.[0]?.meetingTime?.campusDescription ||
    s.campusDescription ||
    "";
  return CAMPUS_TO_SLUG[normalize(campus)] ?? null;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const collegeFilter = args
    .find((a) => a.startsWith("--college="))
    ?.split("=")[1];

  console.log("🤠 Alamo Colleges District Banner SSB scraper");
  console.log(`   Host: ${BASE_URL}`);

  const terms = await getTerms(BASE_URL);
  // pickRecentSsbTerms filters to active enrollable terms; Alamo's term
  // descriptions include " (View Only)" for archived ones and
  // ": Undergrad degree/credential" for the current degree terms, so
  // the default heuristic works.
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
      console.log(
        `     Dropped (not an Alamo college): ${Object.entries(droppedByCampus)
          .sort((a, b) => b[1] - a[1])
          .map(([c, n]) => `${c}=${n}`)
          .join(", ")}`
      );
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
  console.error("❌ Alamo scraper failed:", err);
  process.exit(1);
});

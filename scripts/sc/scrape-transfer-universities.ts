/**
 * scrape-transfer-universities.ts
 *
 * Scrapes transfer equivalency data from USC Columbia, USC Upstate, and
 * College of Charleston for all SC technical colleges. These three use
 * Ellucian Banner JSON APIs (no auth required).
 *
 * Merges results with existing Clemson data in data/sc/transfer-equiv.json.
 *
 * Usage:
 *   npx tsx scripts/sc/scrape-transfer-universities.ts
 *   npx tsx scripts/sc/scrape-transfer-universities.ts --university usc
 */

import * as fs from "fs";
import * as path from "path";

interface TransferMapping {
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

// ---------------------------------------------------------------------------
// University configs
// ---------------------------------------------------------------------------

interface UniversityConfig {
  slug: string;
  name: string;
  getSchools: () => Promise<{ code: string; name: string }[]>;
  getEquivalencies: (schoolCode: string) => Promise<TransferMapping[]>;
}

// SC tech college slugs → names for matching
const SC_TECH_NAMES: Record<string, string> = {
  "aiken": "Aiken Technical College",
  "central-carolina": "Central Carolina Tech",
  "denmark": "Denmark Technical College",
  "florence-darlington": "Florence-Darlington Tech",
  "greenville": "Greenville Technical College",
  "horry-georgetown": "Horry-Georgetown Tech",
  "midlands": "Midlands Technical College",
  "northeastern": "Northeastern Technical College",
  "orangeburg-calhoun": "Orangeburg-Calhoun Tech",
  "piedmont": "Piedmont Technical College",
  "spartanburg": "Spartanburg Community College",
  "lowcountry": "Tech College of the Lowcountry",
  "tri-county": "Tri-County Technical College",
  "trident": "Trident Technical College",
  "williamsburg": "Williamsburg Technical College",
  "york": "York Technical College",
};

function isTechCollege(name: string): boolean {
  const n = name.toLowerCase();
  return Object.values(SC_TECH_NAMES).some(
    (tc) => n.includes(tc.toLowerCase().slice(0, 10))
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJSON(url: string): Promise<any> {
  const resp = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  return resp.json();
}

// ---------------------------------------------------------------------------
// USC Columbia + USC Upstate (shared Banner system)
// ---------------------------------------------------------------------------

function createUSCConfig(program: string, slug: string, name: string): UniversityConfig {
  const base = "https://banner.onecarolina.sc.edu/BannerExtensibility/internalPb/virtualDomains";

  return {
    slug,
    name,
    async getSchools() {
      const data = await fetchJSON(
        `${base}.Z_SVD_CODES-TREQ_STVSBGI?mepCode=COL&program=${encodeURIComponent(program)}&nation=US&state=SC`
      );
      return data
        .filter((s: any) => isTechCollege(s.SBGI_DESC))
        .map((s: any) => ({ code: s.SBGI_CODE, name: s.SBGI_DESC }));
    },
    async getEquivalencies(schoolCode: string) {
      const data = await fetchJSON(
        `${base}.Z_SVD_CODES-TREQ_EQUIV?mepCode=COL&program=${encodeURIComponent(program)}&inst=${schoolCode}&subjects=`
      );

      const mappings: TransferMapping[] = [];
      for (const row of data) {
        const transCourse = (row.TRANS_COURSE || "").trim();
        if (!transCourse) continue;

        const parts = transCourse.match(/^([A-Z]{2,4})\s+(\S+)$/);
        if (!parts) continue;

        const instCourse = (row.INST_COURSE || "").trim();
        const instTitle = (row.INST_TITLE || "").trim();

        // Skip "And" connector rows (multi-course equivalencies — keep primary only)
        if (row.CONNECTOR === "And") continue;

        const noCred = !instCourse || instCourse.includes("ELEC 0") || instTitle.toLowerCase().includes("no credit");
        const isElective = instCourse.includes("ELEC") || instTitle.toLowerCase().includes("elective");

        mappings.push({
          cc_prefix: parts[1],
          cc_number: parts[2],
          cc_course: transCourse,
          cc_title: (row.TRANS_TITLE || "").trim(),
          cc_credits: "",
          university: slug,
          university_name: name,
          univ_course: instCourse || "N/A",
          univ_title: instTitle || "No Equivalent",
          univ_credits: "",
          notes: "",
          no_credit: noCred,
          is_elective: isElective,
        });
      }
      return mappings;
    },
  };
}

// ---------------------------------------------------------------------------
// College of Charleston
// ---------------------------------------------------------------------------

const cofcConfig: UniversityConfig = {
  slug: "cofc",
  name: "College of Charleston",
  async getSchools() {
    // Use latest available term
    const terms = await fetchJSON(
      "https://ssb.cofc.edu/BannerExtensibility/internalPb/virtualDomains.TransferEquivTerm"
    );
    const term = terms[0]?.STVTERM_CODE || "202630";

    const data = await fetchJSON(
      `https://ssb.cofc.edu/BannerExtensibility/internalPb/virtualDomains.TransferEquivSchool?term=${term}&state=SC`
    );

    return data
      .filter((s: any) => isTechCollege(s.STVSBGI_DESC))
      .map((s: any) => ({
        code: s.STVSBGI_CODE + "|" + term, // pack term with code
        name: s.STVSBGI_DESC,
      }));
  },
  async getEquivalencies(schoolCodeAndTerm: string) {
    const [schoolCode, term] = schoolCodeAndTerm.split("|");

    const data = await fetchJSON(
      `https://ssb.cofc.edu/BannerExtensibility/internalPb/virtualDomains.TransferEquivUGGrid?term=${term}&state=SC&school=${schoolCode}`
    );

    const mappings: TransferMapping[] = [];
    for (const row of data) {
      const prefix = (row.A || "").trim();
      const number = (row.B || "").trim();
      if (!prefix || number === "---") continue; // Skip wildcard "All XXX Courses" rows

      const univPrefix = (row.D || "").trim();
      const univNumber = (row.E || "").trim();
      const univTitle = (row.G || "").trim();
      const univCourse = univPrefix && univNumber ? `${univPrefix} ${univNumber}` : "N/A";

      const noCred =
        univCourse === "N/A" ||
        univNumber === "N/X" ||
        univTitle.includes("NOT APPLICABLE");
      const isElective =
        univTitle.toLowerCase().includes("elective") ||
        univNumber.includes("X");

      // Skip "And" connector rows
      if (row.SHRTATC_CONNECTOR === "And") continue;

      mappings.push({
        cc_prefix: prefix,
        cc_number: number,
        cc_course: `${prefix} ${number}`,
        cc_title: (row.C || "").trim(),
        cc_credits: "",
        university: "cofc",
        university_name: "College of Charleston",
        univ_course: univCourse,
        univ_title: univTitle,
        univ_credits: "",
        notes: "",
        no_credit: noCred,
        is_elective: isElective,
      });
    }
    return mappings;
  },
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function scrapeUniversity(config: UniversityConfig): Promise<TransferMapping[]> {
  console.log(`\n=== ${config.name} (${config.slug}) ===`);

  const schools = await config.getSchools();
  console.log(`  Found ${schools.length} SC technical colleges`);

  const allMappings: TransferMapping[] = [];

  for (const school of schools) {
    process.stdout.write(`  ${school.name}...`);
    const mappings = await config.getEquivalencies(school.code);
    const transferable = mappings.filter((m) => !m.no_credit);
    console.log(` ${mappings.length} total, ${transferable.length} transferable`);
    allMappings.push(...mappings);
    await sleep(200);
  }

  const transferable = allMappings.filter((m) => !m.no_credit);
  console.log(`  Total: ${allMappings.length} equivalencies, ${transferable.length} transferable`);
  return allMappings;
}

async function main() {
  const args = process.argv.slice(2);
  const univIdx = args.indexOf("--university");
  const targetUniv = univIdx >= 0 ? args[univIdx + 1] : null;

  const universities: UniversityConfig[] = [
    createUSCConfig("......", "usc", "University of South Carolina"),
    createUSCConfig("UPSTATE", "usc-upstate", "USC Upstate"),
    cofcConfig,
  ];

  const targets = targetUniv
    ? universities.filter((u) => u.slug === targetUniv)
    : universities;

  if (targets.length === 0) {
    console.error(`Unknown university. Available: ${universities.map((u) => u.slug).join(", ")}`);
    process.exit(1);
  }

  let newMappings: TransferMapping[] = [];
  for (const univ of targets) {
    const mappings = await scrapeUniversity(univ);
    newMappings.push(...mappings);
  }

  // Filter out no-credit entries
  const transferable = newMappings.filter((m) => !m.no_credit);

  // Load existing data and merge
  const outPath = path.join(process.cwd(), "data", "sc", "transfer-equiv.json");
  let existing: TransferMapping[] = [];
  if (fs.existsSync(outPath)) {
    existing = JSON.parse(fs.readFileSync(outPath, "utf8"));
  }

  // Remove old entries for universities we just scraped
  const scrapedSlugs = new Set(targets.map((t) => t.slug));
  const kept = existing.filter((m) => !scrapedSlugs.has(m.university));

  const merged = [...kept, ...transferable];
  // Sort by cc_course then university
  merged.sort((a, b) =>
    a.cc_course.localeCompare(b.cc_course) || a.university.localeCompare(b.university)
  );

  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2) + "\n");
  console.log(
    `\nMerged: ${kept.length} existing + ${transferable.length} new = ${merged.length} total`
  );
  console.log(`Written to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * State audit data collector
 *
 * Reads every state's data files, config, and scraper declarations to produce
 * structured JSON for grading. This handles the mechanical file-counting and
 * quality-checking so the model can focus on interpretation.
 *
 * Usage:
 *   npx tsx .claude/skills/state-audit/scripts/collect-audit-data.ts        # all states
 *   npx tsx .claude/skills/state-audit/scripts/collect-audit-data.ts ny     # one state
 */

import * as fs from "fs";
import * as path from "path";

const ROOT = process.cwd();

interface AuditResult {
  slug: string;
  name: string;
  collegeCount: number;
  courses: {
    coveredColleges: number;
    collegeCount: number;
    missingColleges: string[];
    termsByCollege: Record<string, string[]>;
    uniqueTerms: string[];
    staleTerms: string[];
    suspiciousTerms: string[];
    totalSections: number;
    zeroCreditSections: number;
    sectionsByCollege: Record<string, number>;
    lowSectionColleges: string[];
  };
  prereqs: {
    exists: boolean;
    count: number;
    htmlContaminated: number;
    htmlSamples: string[];
    emptyCourseArrays: number;
    scraperDeclared: boolean;
    scraperManualOnly: boolean;
  };
  transfers: {
    exists: boolean;
    count: number;
    universities: string[];
    universityCount: number;
    directMatches: number;
    electiveOnly: number;
    noCredit: number;
    transferSupported: boolean;
    scraperDeclared: boolean;
    scraperManualOnly: boolean;
  };
  scorecard: {
    files: number;
    collegeCount: number;
  };
  scrapers: {
    coursesWired: boolean;
    coursesManualOnly: boolean;
    transfersWired: boolean;
    transfersManualOnly: boolean;
    prereqsWired: boolean;
    prereqsManualOnly: boolean;
    manualOnlyReasons: string[];
  };
  config: {
    seniorWaiverSet: boolean;
    seniorWaiverPlaceholder: boolean;
    popularCoursesCount: number;
    brandingComplete: boolean;
    brandingGaps: string[];
    defaultZipSet: boolean;
  };
}

function getStates(): string[] {
  const statesDir = path.join(ROOT, "lib", "states");
  return fs
    .readdirSync(statesDir)
    .filter((d) => {
      const p = path.join(statesDir, d);
      return (
        fs.statSync(p).isDirectory() &&
        fs.existsSync(path.join(p, "config.ts")) &&
        d !== "registry" &&
        d.length === 2
      );
    })
    .sort();
}

function readConfig(slug: string): string {
  return fs.readFileSync(
    path.join(ROOT, "lib", "states", slug, "config.ts"),
    "utf-8",
  );
}

function extractNumber(configText: string, field: string): number {
  const m = configText.match(new RegExp(`${field}:\\s*(\\d+)`));
  return m ? parseInt(m[1], 10) : 0;
}

function extractBoolean(configText: string, field: string): boolean {
  const m = configText.match(new RegExp(`${field}:\\s*(true|false)`));
  return m ? m[1] === "true" : false;
}

function extractStringArray(configText: string, field: string): string[] {
  const m = configText.match(new RegExp(`${field}:\\s*\\[([^\\]]*?)\\]`, "s"));
  if (!m) return [];
  const items = m[1].match(/"([^"]+)"/g);
  return items ? items.map((s) => s.replace(/"/g, "")) : [];
}

function currentTerms(): { current: string[]; staleThreshold: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const terms: string[] = [];
  // Current and upcoming terms
  terms.push(`${year}FA`, `${year}SP`, `${year}SU`);
  terms.push(`${year + 1}SP`, `${year + 1}FA`, `${year + 1}SU`);
  // Previous semester is still acceptable
  if (month <= 6) {
    terms.push(`${year - 1}FA`);
  }

  // Stale = more than 2 semesters ago
  const staleYear = month <= 6 ? year - 1 : year;
  const staleSeason = month <= 6 ? "SP" : "FA";
  return { current: terms, staleThreshold: `${staleYear}${staleSeason}` };
}

function isStale(term: string, threshold: string): boolean {
  return term < threshold;
}

function isSuspicious(term: string): boolean {
  const now = new Date();
  const year = now.getFullYear();
  // Non-standard term codes (like 2027XX)
  if (!/^\d{4}(FA|SP|SU)$/.test(term)) return true;
  // More than 1 year in the future
  const termYear = parseInt(term.substring(0, 4), 10);
  if (termYear > year + 1) return true;
  return false;
}

function auditState(slug: string): AuditResult {
  const configText = readConfig(slug);
  const collegeCount = extractNumber(configText, "collegeCount");

  // Extract state name
  const nameMatch = configText.match(/name:\s*"([^"]+)"/);
  const name = nameMatch ? nameMatch[1] : slug.toUpperCase();

  // --- Courses ---
  const coursesDir = path.join(ROOT, "data", slug, "courses");
  const courseColleges = fs.existsSync(coursesDir)
    ? fs.readdirSync(coursesDir).filter((d) =>
        fs.statSync(path.join(coursesDir, d)).isDirectory(),
      )
    : [];

  const termsByCollege: Record<string, string[]> = {};
  const sectionsByCollege: Record<string, number> = {};
  let totalSections = 0;
  let zeroCreditSections = 0;
  const allTerms = new Set<string>();

  for (const college of courseColleges) {
    const collegeDir = path.join(coursesDir, college);
    const termFiles = fs.readdirSync(collegeDir).filter((f) => f.endsWith(".json"));
    const terms: string[] = [];
    let collegeSections = 0;

    for (const tf of termFiles) {
      const term = tf.replace(".json", "");
      terms.push(term);
      allTerms.add(term);
      try {
        const sections = JSON.parse(
          fs.readFileSync(path.join(collegeDir, tf), "utf-8"),
        );
        if (Array.isArray(sections)) {
          collegeSections += sections.length;
          for (const s of sections) {
            if (s.credits === 0) zeroCreditSections++;
          }
        }
      } catch {}
    }

    termsByCollege[college] = terms.sort();
    sectionsByCollege[college] = collegeSections;
    totalSections += collegeSections;
  }

  // Find missing colleges by comparing with institutions.json
  const instsPath = path.join(ROOT, "data", slug, "institutions.json");
  let allCollegeSlugs: string[] = [];
  if (fs.existsSync(instsPath)) {
    try {
      const insts = JSON.parse(fs.readFileSync(instsPath, "utf-8"));
      allCollegeSlugs = insts.map((i: { id?: string; college_slug?: string }) => i.id || i.college_slug);
    } catch {}
  }
  const missingColleges = allCollegeSlugs.filter(
    (s) => s && !courseColleges.includes(s),
  );

  const { staleThreshold } = currentTerms();
  const uniqueTerms = Array.from(allTerms).sort();
  const staleTerms = uniqueTerms.filter((t) => isStale(t, staleThreshold));
  const suspiciousTerms = uniqueTerms.filter((t) => isSuspicious(t));
  const lowSectionColleges = Object.entries(sectionsByCollege)
    .filter(([, count]) => count < 50)
    .map(([college]) => college);

  // --- Prereqs ---
  const prereqsPath = path.join(ROOT, "data", slug, "prereqs.json");
  let prereqCount = 0;
  let htmlContaminated = 0;
  let emptyCourseArrays = 0;
  const htmlSamples: string[] = [];

  if (fs.existsSync(prereqsPath)) {
    try {
      const prereqs = JSON.parse(fs.readFileSync(prereqsPath, "utf-8"));
      const entries = Object.entries(prereqs);
      prereqCount = entries.length;

      for (const [key, entry] of entries) {
        const e = entry as { text?: string; courses?: string[] };
        if (e.text && /<[a-z][^>]*>/i.test(e.text)) {
          htmlContaminated++;
          if (htmlSamples.length < 3) {
            htmlSamples.push(`${key}: ${e.text.substring(0, 120)}...`);
          }
        }
        if (e.courses && e.courses.length === 0) {
          emptyCourseArrays++;
        }
      }
    } catch {}
  }

  const prereqScraperDeclared = /scrapers[\s\S]*?prereqs\s*:\s*(\[|{)/.test(configText);
  const prereqManualOnly = /\/\/\s*manual-only:.*prereq/i.test(configText);

  // --- Transfers ---
  const transferPath = path.join(ROOT, "data", slug, "transfer-equiv.json");
  let transferCount = 0;
  let directMatches = 0;
  let electiveOnly = 0;
  let noCredit = 0;
  const universities = new Set<string>();

  if (fs.existsSync(transferPath)) {
    try {
      const transfers = JSON.parse(fs.readFileSync(transferPath, "utf-8"));
      if (Array.isArray(transfers)) {
        transferCount = transfers.length;
        for (const t of transfers) {
          if (t.university) universities.add(t.university);
          if (t.no_credit) noCredit++;
          else if (t.is_elective) electiveOnly++;
          else directMatches++;
        }
      }
    } catch {}
  }

  const transferSupported = extractBoolean(configText, "transferSupported");
  const transferScraperDeclared = /scrapers[\s\S]*?transfers\s*:\s*\[/.test(configText);
  const transferManualOnly = /\/\/\s*manual-only:.*transfer/i.test(configText);

  // --- Scorecard ---
  const scorecardDir = path.join(ROOT, "data", slug, "scorecard");
  const scorecardFiles = fs.existsSync(scorecardDir)
    ? fs.readdirSync(scorecardDir).filter((f) => f.endsWith(".json")).length
    : 0;

  // --- Scrapers ---
  const coursesWired = /scrapers[\s\S]*?courses\s*:\s*\[/.test(configText);
  const coursesManualOnly = /\/\/\s*manual-only:.*course/i.test(configText);
  const manualOnlyReasons: string[] = [];
  const manualMatches = configText.match(/\/\/\s*manual-only:\s*(.+)/g);
  if (manualMatches) {
    for (const m of manualMatches) {
      manualOnlyReasons.push(m.replace(/\/\/\s*manual-only:\s*/, "").trim());
    }
  }

  // --- Config ---
  const seniorWaiverSet = !/seniorWaiver:\s*null/.test(configText) &&
    /seniorWaiver:\s*\{/.test(configText);
  const seniorWaiverPlaceholder = /verify with|placeholder|not yet verified/i.test(
    configText.match(/seniorWaiver:\s*\{([\s\S]*?)\}/)?.[1] || "",
  );
  const popularCourses = extractStringArray(configText, "popularCourses");
  const defaultZipSet = /defaultZip:\s*"[^"]+"/i.test(configText);

  const brandingGaps: string[] = [];
  for (const field of ["siteName", "tagline", "footerText", "disclaimer"]) {
    const m = configText.match(new RegExp(`${field}:\\s*"([^"]*)"`));
    if (!m || m[1] === "") brandingGaps.push(field);
  }

  return {
    slug,
    name,
    collegeCount,
    courses: {
      coveredColleges: courseColleges.length,
      collegeCount,
      missingColleges,
      termsByCollege,
      uniqueTerms,
      staleTerms,
      suspiciousTerms,
      totalSections,
      zeroCreditSections,
      sectionsByCollege,
      lowSectionColleges,
    },
    prereqs: {
      exists: fs.existsSync(prereqsPath),
      count: prereqCount,
      htmlContaminated,
      htmlSamples,
      emptyCourseArrays,
      scraperDeclared: prereqScraperDeclared,
      scraperManualOnly: prereqManualOnly,
    },
    transfers: {
      exists: fs.existsSync(transferPath),
      count: transferCount,
      universities: Array.from(universities).sort(),
      universityCount: universities.size,
      directMatches,
      electiveOnly,
      noCredit,
      transferSupported,
      scraperDeclared: transferScraperDeclared,
      scraperManualOnly: transferManualOnly,
    },
    scorecard: {
      files: scorecardFiles,
      collegeCount,
    },
    scrapers: {
      coursesWired,
      coursesManualOnly,
      transfersWired: transferScraperDeclared,
      transfersManualOnly: transferManualOnly,
      prereqsWired: prereqScraperDeclared,
      prereqsManualOnly: prereqManualOnly,
      manualOnlyReasons,
    },
    config: {
      seniorWaiverSet,
      seniorWaiverPlaceholder,
      popularCoursesCount: popularCourses.length,
      brandingComplete: brandingGaps.length === 0,
      brandingGaps,
      defaultZipSet,
    },
  };
}

function main() {
  const targetSlug = process.argv[2]?.toLowerCase();
  const states = targetSlug ? [targetSlug] : getStates();

  const results: AuditResult[] = [];
  for (const slug of states) {
    try {
      results.push(auditState(slug));
    } catch (e) {
      console.error(`Error auditing ${slug}: ${e}`);
    }
  }

  console.log(JSON.stringify(results, null, 2));
}

main();

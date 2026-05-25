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

export type Grade = "A" | "B" | "C" | "D" | "F";
export type Dimension = "courses" | "prereqs" | "transfers" | "scorecard" | "config";

export interface GradeResult {
  grade: Grade;
  reason: string;
}

const GRADE_RANK: Record<Grade, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 };

/** Returns the worst (lowest) of two grades. */
function worse(a: Grade, b: Grade): Grade {
  return GRADE_RANK[a] <= GRADE_RANK[b] ? a : b;
}

/** Cap a grade so it cannot drop below B. Used for documented-ceiling exemptions. */
function capAtB(g: GradeResult, reason: string): GradeResult {
  if (GRADE_RANK[g.grade] >= GRADE_RANK["B"]) return g;
  return { grade: "B", reason: `ceiling: ${reason}` };
}

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
  /** Documented structural ceilings from StateConfig.documentedCeilings. */
  documentedCeilings: {
    transfers: boolean;
    transfersReason?: string;
    scorecard: boolean;
    scorecardReason?: string;
    courseColleges: string[];
  };
  /**
   * Deterministic per-dimension grades (A–F) computed by the collector.
   * Composite = worst of the five dimensions. `limitedBy` names which
   * dimension produced the composite grade. `ceilingsApplied` records
   * which documentedCeilings exemptions were used (each caps its
   * dimension at a B floor — the dimension can still earn A on its own
   * merits if the data is actually there).
   */
  grades: {
    courses: GradeResult;
    prereqs: GradeResult;
    transfers: GradeResult;
    scorecard: GradeResult;
    config: GradeResult;
    composite: Grade;
    limitedBy: Dimension;
    ceilingsApplied: Array<{ dimension: Dimension; reason: string }>;
  };
  /**
   * Optional prod-vs-local coverage check (only populated when --check-prod
   * is passed). For each college with >0 local sections, fetches
   * https://communitycollegepath.com/{state}/college/{slug} and counts
   * course-code occurrences in the rendered HTML. Pages with Supabase data
   * have hundreds of occurrences; pages where the Supabase import skipped
   * the college have zero. The audit's `coveredColleges` count reflects
   * on-disk data only — this dimension surfaces the gap between "we
   * committed sections to git" and "students can actually find them".
   * Real-world example: SCKTC in KY had 823 sections on disk but 0 on
   * prod because its data landed before import-on-merge.yml existed and
   * no subsequent KY-courses import ever ran.
   */
  prodCoverage?: {
    checked: boolean;
    /** Slugs with local sections but 0 course codes on the prod page. */
    missingOnProd: string[];
    /** Slugs successfully verified on prod (>=20 course-code mentions). */
    verifiedOnProd: string[];
    /** Slugs where the prod fetch errored (network / 404 / parse). */
    fetchErrors: string[];
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

// ---------------------------------------------------------------------------
// Graders — one per dimension, plus composite. Pure functions over the
// AuditResult sub-objects. Thresholds are documented in SKILL.md and the
// snapshot test set in grade-snapshot.test.ts.
// ---------------------------------------------------------------------------

function gradeCourses(
  courses: AuditResult["courses"],
  ceilingCourseColleges: string[],
): GradeResult {
  // Exempt documented-ceiling colleges from the coverage denominator.
  const exemptSet = new Set(ceilingCourseColleges);
  const adjustedTotal = courses.collegeCount - ceilingCourseColleges.length;
  const adjustedCovered = courses.coveredColleges - courses.missingColleges
    .filter((s) => exemptSet.has(s))
    .length;
  // (If a ceiling slug isn't actually in missingColleges it doesn't change
  // covered, but the denominator drops — which only helps coverage.)
  const denom = Math.max(1, adjustedTotal);
  const coverage = adjustedCovered / denom;
  const stale = courses.staleTerms.length;
  const suspicious = courses.suspiciousTerms.length;

  if (coverage < 0.15) {
    return { grade: "F", reason: `coverage ${(coverage * 100).toFixed(0)}% (${adjustedCovered}/${denom})` };
  }
  if (coverage < 0.5) {
    return { grade: "D", reason: `coverage ${(coverage * 100).toFixed(0)}% (${adjustedCovered}/${denom})` };
  }
  if (coverage < 0.85) {
    return { grade: "C", reason: `coverage ${(coverage * 100).toFixed(0)}% (${adjustedCovered}/${denom})` };
  }
  if (coverage < 0.95 || stale > 0 || suspicious > 0) {
    const bits: string[] = [];
    if (coverage < 0.95) bits.push(`coverage ${(coverage * 100).toFixed(0)}%`);
    if (stale > 0) bits.push(`${stale} stale term(s)`);
    if (suspicious > 0) bits.push(`${suspicious} suspicious term(s)`);
    return { grade: "B", reason: bits.join("; ") };
  }
  return { grade: "A", reason: `full coverage (${adjustedCovered}/${denom}), terms clean` };
}

function gradeTransfers(
  transfers: AuditResult["transfers"],
  ceiling: AuditResult["documentedCeilings"],
): GradeResult {
  const wired = transfers.scraperDeclared;
  const unis = transfers.universityCount;
  const count = transfers.count;
  const supported = transfers.transferSupported;

  if (count === 0 && !ceiling.transfers) {
    return { grade: "F", reason: "no transfer data" };
  }
  if (count === 0 && ceiling.transfers) {
    // Ceiling acknowledged; nothing to grade but ceiling cap will lift to B.
    return { grade: "F", reason: "no transfer data (ceiling-exempt)" };
  }
  if (!wired) {
    return { grade: "D", reason: `data exists (${count}) but scraper not wired — will go stale` };
  }
  if (unis <= 1 || count < 500) {
    return { grade: "C", reason: `thin: ${unis} university, ${count} mappings` };
  }
  if (unis < 3 || count < 1000) {
    return { grade: "B", reason: `${unis} universities, ${count} mappings` };
  }
  if (!supported) {
    return { grade: "B", reason: `${unis} universities, ${count} mappings, but transferSupported=false` };
  }
  return { grade: "A", reason: `${unis} universities, ${count} mappings, wired` };
}

function gradePrereqs(
  prereqs: AuditResult["prereqs"],
  scrapers: AuditResult["scrapers"],
): GradeResult {
  if (!prereqs.exists) {
    return { grade: "F", reason: "no prereqs file" };
  }
  if (prereqs.count === 0) {
    return { grade: "D", reason: "file exists but empty" };
  }
  if (prereqs.htmlContaminated > 0) {
    return { grade: "C", reason: `${prereqs.htmlContaminated} entries have HTML contamination` };
  }
  if (prereqs.count < 10) {
    return { grade: "C", reason: `only ${prereqs.count} entries` };
  }
  const wired = scrapers.prereqsWired;
  if (prereqs.count < 100) {
    return { grade: "B", reason: `${prereqs.count} entries${wired ? "" : ", not wired"}` };
  }
  if (!wired) {
    return { grade: "B", reason: `${prereqs.count} entries but scraper not wired` };
  }
  return { grade: "A", reason: `${prereqs.count} entries, wired, clean` };
}

function gradeScorecard(
  scorecard: AuditResult["scorecard"],
  ceiling: AuditResult["documentedCeilings"],
): GradeResult {
  const denom = Math.max(1, scorecard.collegeCount);
  const coverage = scorecard.files / denom;
  if (scorecard.files === 0 && !ceiling.scorecard) {
    return { grade: "F", reason: "no scorecard directory" };
  }
  if (scorecard.files === 0 && ceiling.scorecard) {
    return { grade: "F", reason: "no scorecard (ceiling-exempt)" };
  }
  if (coverage < 0.5) {
    return { grade: "D", reason: `${scorecard.files}/${denom} scorecards (${(coverage * 100).toFixed(0)}%)` };
  }
  if (coverage < 0.8) {
    return { grade: "C", reason: `${scorecard.files}/${denom} scorecards (${(coverage * 100).toFixed(0)}%)` };
  }
  if (coverage < 1.0) {
    return { grade: "B", reason: `${scorecard.files}/${denom} scorecards` };
  }
  return { grade: "A", reason: `${scorecard.files}/${denom} scorecards` };
}

function gradeConfig(config: AuditResult["config"]): GradeResult {
  // Count gaps. Senior-waiver placeholder is treated as a soft red flag (D).
  if (config.seniorWaiverPlaceholder) {
    return { grade: "D", reason: "seniorWaiver placeholder text detected" };
  }
  const gaps: string[] = [];
  if (!config.seniorWaiverSet) gaps.push("seniorWaiver missing");
  if (config.popularCoursesCount === 0) gaps.push("popularCourses empty");
  if (!config.defaultZipSet) gaps.push("defaultZip missing");
  if (!config.brandingComplete) gaps.push(`branding: ${config.brandingGaps.join(", ")}`);

  if (gaps.length === 0) return { grade: "A", reason: "all config fields populated" };
  if (gaps.length === 1) return { grade: "B", reason: gaps[0] };
  if (gaps.length === 2) return { grade: "C", reason: gaps.join("; ") };
  if (gaps.length === 3) return { grade: "D", reason: gaps.join("; ") };
  return { grade: "F", reason: `skeleton (${gaps.length} gaps): ${gaps.join("; ")}` };
}

export function computeGrades(r: Omit<AuditResult, "grades">): AuditResult["grades"] {
  const ceilingsApplied: Array<{ dimension: Dimension; reason: string }> = [];

  // Grade each dimension.
  let courses = gradeCourses(r.courses, r.documentedCeilings.courseColleges);
  if (r.documentedCeilings.courseColleges.length > 0) {
    ceilingsApplied.push({
      dimension: "courses",
      reason: `${r.documentedCeilings.courseColleges.length} college(s) exempted from coverage denominator`,
    });
  }

  let transfers = gradeTransfers(r.transfers, r.documentedCeilings);
  if (r.documentedCeilings.transfers && GRADE_RANK[transfers.grade] < GRADE_RANK["B"]) {
    const reason = r.documentedCeilings.transfersReason || "documented transfer ceiling";
    transfers = capAtB(transfers, reason);
    ceilingsApplied.push({ dimension: "transfers", reason });
  }

  const prereqs = gradePrereqs(r.prereqs, r.scrapers);

  let scorecard = gradeScorecard(r.scorecard, r.documentedCeilings);
  if (r.documentedCeilings.scorecard && GRADE_RANK[scorecard.grade] < GRADE_RANK["B"]) {
    const reason = r.documentedCeilings.scorecardReason || "documented scorecard ceiling";
    scorecard = capAtB(scorecard, reason);
    ceilingsApplied.push({ dimension: "scorecard", reason });
  }

  const config = gradeConfig(r.config);

  // Composite = worst dimension. `limitedBy` names that dimension.
  const dims: Array<[Dimension, GradeResult]> = [
    ["courses", courses],
    ["prereqs", prereqs],
    ["transfers", transfers],
    ["scorecard", scorecard],
    ["config", config],
  ];
  let composite: Grade = "A";
  let limitedBy: Dimension = "courses";
  for (const [name, g] of dims) {
    const next = worse(composite, g.grade);
    if (next !== composite) {
      composite = next;
      limitedBy = name;
    } else if (next === g.grade && g.grade !== "A") {
      // Tie: keep the first one (stable order: courses → prereqs → transfers → scorecard → config).
    }
  }

  return { courses, prereqs, transfers, scorecard, config, composite, limitedBy, ceilingsApplied };
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

  // --- Documented ceilings — opt-in field on StateConfig signaling that
  // a dimension's gap is a real-world constraint, not unfinished work.
  // The grader treats these as ignored for tier purposes.
  let ceilingTransfers = false;
  let ceilingTransfersReason: string | undefined;
  let ceilingScorecard = false;
  let ceilingScorecardReason: string | undefined;
  const ceilingCourseColleges: string[] = [];
  const ceilingBlockMatch = configText.match(
    /documentedCeilings\s*:\s*\{([\s\S]*?)\n\s{0,4}\}/,
  );
  if (ceilingBlockMatch) {
    const body = ceilingBlockMatch[1];
    const transfersReasonMatch = body.match(/(^|\n)\s*transfers\s*:\s*"((?:[^"\\]|\\.)*)"/);
    const transfersMultiLineMatch = !transfersReasonMatch
      ? body.match(/(^|\n)\s*transfers\s*:\s*\n?\s*"((?:[^"\\]|\\.)*)"/)
      : null;
    if (transfersReasonMatch) {
      ceilingTransfers = true;
      ceilingTransfersReason = transfersReasonMatch[2];
    } else if (transfersMultiLineMatch) {
      ceilingTransfers = true;
      ceilingTransfersReason = transfersMultiLineMatch[2];
    } else if (/(^|\n)\s*transfers\s*:/.test(body)) {
      ceilingTransfers = true;
    }
    const scorecardReasonMatch = body.match(/(^|\n)\s*scorecard\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (scorecardReasonMatch) {
      ceilingScorecard = true;
      ceilingScorecardReason = scorecardReasonMatch[2];
    } else if (/(^|\n)\s*scorecard\s*:/.test(body)) {
      ceilingScorecard = true;
    }
    const coursesMatch = body.match(/courses\s*:\s*\[([\s\S]*?)\]/);
    if (coursesMatch) {
      const slugs = coursesMatch[1].match(/collegeSlug\s*:\s*"([^"]+)"/g) || [];
      for (const s of slugs) {
        const m = s.match(/"([^"]+)"/);
        if (m) ceilingCourseColleges.push(m[1]);
      }
    }
  }

  const base: Omit<AuditResult, "grades"> = {
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
    documentedCeilings: {
      transfers: ceilingTransfers,
      ...(ceilingTransfersReason ? { transfersReason: ceilingTransfersReason } : {}),
      scorecard: ceilingScorecard,
      ...(ceilingScorecardReason ? { scorecardReason: ceilingScorecardReason } : {}),
      courseColleges: ceilingCourseColleges,
    },
  };
  return { ...base, grades: computeGrades(base) };
}

// ---------------------------------------------------------------------------
// Prod-vs-local coverage check
// ---------------------------------------------------------------------------

const PROD_BASE = "https://communitycollegepath.com";
const PROD_COURSE_CODE_RE = /\b[A-Z]{2,5}\s*[0-9]{2,4}\b/g;
const PROD_COURSE_CODE_THRESHOLD = 20; // pages with real Supabase data have hundreds; empty pages have 0

async function fetchProdCollegeCourseCount(
  state: string,
  collegeSlug: string,
): Promise<{ ok: true; codeCount: number } | { ok: false; error: string }> {
  const url = `${PROD_BASE}/${state}/college/${collegeSlug}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "cc-coursemap-audit/1.0" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const html = await res.text();
    const matches = html.match(PROD_COURSE_CODE_RE);
    return { ok: true, codeCount: matches ? new Set(matches).size : 0 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function checkProdCoverage(
  state: string,
  sectionsByCollege: Record<string, number>,
): Promise<NonNullable<AuditResult["prodCoverage"]>> {
  const collegesWithLocalData = Object.entries(sectionsByCollege)
    .filter(([, n]) => n > 0)
    .map(([slug]) => slug);
  const missingOnProd: string[] = [];
  const verifiedOnProd: string[] = [];
  const fetchErrors: string[] = [];
  // Serial requests — keeps us polite to the prod CDN and avoids triggering
  // any rate-limit / WAF. Even on a 58-college state (NC) this is ~58 *
  // ~2s = ~2 min, acceptable for an audit invocation.
  for (const slug of collegesWithLocalData) {
    const r = await fetchProdCollegeCourseCount(state, slug);
    if (!r.ok) {
      fetchErrors.push(`${slug}: ${r.error}`);
    } else if (r.codeCount < PROD_COURSE_CODE_THRESHOLD) {
      missingOnProd.push(slug);
    } else {
      verifiedOnProd.push(slug);
    }
  }
  return { checked: true, missingOnProd, verifiedOnProd, fetchErrors };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const checkProd = args.includes("--check-prod");
  const positional = args.filter((a) => !a.startsWith("--"));
  const targetSlug = positional[0]?.toLowerCase();
  const states = targetSlug ? [targetSlug] : getStates();

  const results: AuditResult[] = [];
  for (const slug of states) {
    try {
      const r = auditState(slug);
      if (checkProd) {
        // eslint-disable-next-line no-await-in-loop
        r.prodCoverage = await checkProdCoverage(slug, r.courses.sectionsByCollege);
      }
      results.push(r);
    } catch (e) {
      console.error(`Error auditing ${slug}: ${e}`);
    }
  }

  console.log(JSON.stringify(results, null, 2));
}

main();

#!/usr/bin/env tsx
/**
 * Trigger G — course-scarcity detection (data-driven).
 *
 * Mines `data/{state}/courses/<college>/<term>.json` for each covered
 * state and emits a candidate when the state has a meaningful multi-choice
 * catalog (>= 50 courses where students can pick from >= 5 colleges) AND
 * the course-availability-guide cluster has no spoke yet for that state.
 *
 * The core insight: community college course catalogs are bimodal. A small
 * "universal" set of gen-ed courses (ENG 111, PSY 150, BIO 111, etc.) runs
 * at every college in the state system. The majority of the catalog
 * concentrates at 1–3 "anchor campuses" — students who need those courses
 * must commute, go online, or find alternatives.
 *
 * Each candidate carries a precomputed slice file at
 * .blog-pipeline/slices/course-scarcity/{state}.json with: coverage
 * distribution, top universal courses, top point-source courses, anchor
 * campuses, and scarcest course prefixes. The drafter consumes the slice
 * verbatim — every numeric claim must come from this file, not LLM
 * speculation.
 *
 * Emit threshold:
 *   - multiChoiceCount >= 50   (validates real cross-college common numbering)
 *   - collegeCount >= 5         (single-institution states can't tell a scarcity story)
 *
 * States expected to fire: NC, VA, GA, TN, KY, SC, FL
 * States that won't: MD (no common numbering), NY (CUNY too narrow),
 *   DC/RI/DE/VT (single institution), NH/ME/AL (marginal)
 */
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { articles } from "../../../../content/blog/index";
import { getAllStates } from "../../../../lib/states/registry";

const REPO_ROOT = resolve(__dirname, "../../../..");
const DISABLED = resolve(REPO_ROOT, ".blog-pipeline/DISABLED");
const CLUSTER = "course-availability-guide";
const SLICE_OUT_DIR = resolve(REPO_ROOT, ".blog-pipeline/slices/course-scarcity");

// Minimum number of courses where a student can choose from >= 5 colleges.
// Validates that the state has real cross-college common course numbering.
const MULTI_CHOICE_MIN = 50;
// Minimum number of colleges in the dataset to tell a scarcity story.
const MIN_COLLEGE_COUNT = 5;
// Minimum sections at a single college for a course to qualify as "point-source"
const POINT_SOURCE_MIN_SECTIONS = 5;
// Minimum sections across all colleges for a course to qualify as "scarce" (not noise)
const SCARCE_MIN_SECTIONS = 3;
// Minimum college count for "multi-choice" classification
const MULTI_CHOICE_COLLEGE_MIN = 5;

type CoverageBucket = "universal" | "common" | "selective" | "scarce" | "point-source";

type CourseEntry = {
  courseId: string;
  title: string;
  colleges: Set<string>;
  totalSections: number;
  sectionsByCollege: Map<string, number>;
};

type Candidate = {
  triggerSource: "course-scarcity";
  topic: string;
  targetReader: string;
  searchIntentHypothesis: string;
  articleType: "state-spoke";
  state: string;
  cluster: string;
  nonDuplicateRationale: string;
  dataSlicePaths: string[];
  rankScore: number;
};

type StateStats = {
  state: string;
  generatedAt: string;
  collegeCount: number;
  totalSections: number;
  uniqueCourseIds: number;
  terms: string[];
  coverageDistribution: Record<CoverageBucket, { count: number; pct: number }>;
  multiChoiceCount: number;
  scarcityRatio: number;
  topUniversalCourses: Array<{
    courseId: string;
    title: string;
    colleges: number;
    pct: number;
    sections: number;
  }>;
  topPointSourceCourses: Array<{
    courseId: string;
    title: string;
    colleges: number;
    sections: number;
    collegeName: string;
  }>;
  anchorCampuses: Array<{
    college: string;
    exclusiveCourses: number;
    pct: number;
    totalSections: number;
  }>;
  scarcestPrefixes: Array<{
    prefix: string;
    totalCourses: number;
    scarceCourses: number;
    scarcePct: number;
  }>;
  perCollege: Array<{
    college: string;
    totalSections: number;
    uniqueCourses: number;
    exclusiveCourses: number;
    universalCourses: number;
  }>;
};

function computeStats(stateSlug: string): StateStats | null {
  const coursesDir = resolve(REPO_ROOT, `data/${stateSlug}/courses`);
  if (!existsSync(coursesDir)) return null;

  // course map: courseId → CourseEntry
  const courseMap = new Map<string, CourseEntry>();
  const collegesInState = new Set<string>();
  const termsInState = new Set<string>();
  let totalSections = 0;

  for (const college of readdirSync(coursesDir)) {
    const collegeDir = resolve(coursesDir, college);
    let termFiles: string[] = [];
    try {
      termFiles = readdirSync(collegeDir).filter(
        (f) => /20\d\d/.test(f) && f.endsWith(".json")
      );
    } catch {
      continue;
    }

    let collegeSectionCount = 0;

    for (const f of termFiles) {
      try {
        const raw = readFileSync(resolve(collegeDir, f), "utf-8");
        const data = JSON.parse(raw);
        if (!Array.isArray(data)) continue;

        const term = f.replace(".json", "");
        termsInState.add(term);

        for (const r of data) {
          const prefix = (r.course_prefix || "").trim().toUpperCase();
          const number = (r.course_number || "").trim();
          const title = (r.course_title || "").trim();
          if (!prefix || !number) continue;

          const courseId = `${prefix}-${number}`;
          const collegeName = r.college_code || college;

          if (!courseMap.has(courseId)) {
            courseMap.set(courseId, {
              courseId,
              title,
              colleges: new Set(),
              totalSections: 0,
              sectionsByCollege: new Map(),
            });
          }
          const entry = courseMap.get(courseId)!;
          entry.colleges.add(collegeName);
          entry.totalSections++;
          entry.sectionsByCollege.set(
            collegeName,
            (entry.sectionsByCollege.get(collegeName) ?? 0) + 1
          );

          collegeSectionCount++;
          totalSections++;
        }
      } catch {
        continue;
      }
    }

    if (collegeSectionCount > 0) {
      collegesInState.add(college);
    }
  }

  const collegeCount = collegesInState.size;
  if (collegeCount < MIN_COLLEGE_COUNT || totalSections === 0) return null;

  // Classify each course into a coverage bucket
  const bucketCounts: Record<CoverageBucket, number> = {
    universal: 0,
    common: 0,
    selective: 0,
    scarce: 0,
    "point-source": 0,
  };

  const topUniversalCourses: StateStats["topUniversalCourses"] = [];
  const topPointSourceCourses: StateStats["topPointSourceCourses"] = [];

  // anchor campus: exclusiveCourses count
  const anchorMap = new Map<string, number>();
  // per-college: exclusiveCourses + uniqueCourses + totalSections + universalCourses
  const perCollegeMap = new Map<
    string,
    { totalSections: number; uniqueCourses: number; exclusiveCourses: number; universalCourses: number }
  >();
  for (const c of collegesInState) {
    perCollegeMap.set(c, { totalSections: 0, uniqueCourses: 0, exclusiveCourses: 0, universalCourses: 0 });
  }

  // prefix scarcity: prefix → { total, scarce }
  const prefixMap = new Map<string, { total: number; scarce: number }>();

  let multiChoiceCount = 0;

  for (const [, entry] of courseMap) {
    const coveragePct = (entry.colleges.size / collegeCount) * 100;
    const prefix = entry.courseId.split("-")[0];

    // Classify
    let bucket: CoverageBucket;
    if (entry.colleges.size === 1 && entry.totalSections >= POINT_SOURCE_MIN_SECTIONS) {
      bucket = "point-source";
    } else if (coveragePct >= 80) {
      bucket = "universal";
    } else if (coveragePct >= 50) {
      bucket = "common";
    } else if (coveragePct >= 25) {
      bucket = "selective";
    } else if (entry.totalSections >= SCARCE_MIN_SECTIONS) {
      bucket = "scarce";
    } else {
      // too few sections to classify reliably — skip
      continue;
    }
    bucketCounts[bucket]++;

    // multi-choice count
    if (entry.colleges.size >= MULTI_CHOICE_COLLEGE_MIN) multiChoiceCount++;

    // track universal courses
    if (bucket === "universal") {
      topUniversalCourses.push({
        courseId: entry.courseId,
        title: entry.title,
        colleges: entry.colleges.size,
        pct: Math.round(coveragePct * 10) / 10,
        sections: entry.totalSections,
      });
    }

    // track point-source courses
    if (bucket === "point-source") {
      const onlyCollege = [...entry.colleges][0];
      topPointSourceCourses.push({
        courseId: entry.courseId,
        title: entry.title,
        colleges: 1,
        sections: entry.totalSections,
        collegeName: onlyCollege,
      });
      // anchor campus tracking
      anchorMap.set(onlyCollege, (anchorMap.get(onlyCollege) ?? 0) + 1);
      // per-college exclusive courses
      const pc = perCollegeMap.get(onlyCollege);
      if (pc) pc.exclusiveCourses++;
    }

    // per-college: unique courses + universal courses
    for (const c of entry.colleges) {
      const pc = perCollegeMap.get(c);
      if (pc) {
        pc.uniqueCourses++;
        if (bucket === "universal") pc.universalCourses++;
      }
    }

    // prefix scarcity
    if (!prefixMap.has(prefix)) prefixMap.set(prefix, { total: 0, scarce: 0 });
    const p = prefixMap.get(prefix)!;
    p.total++;
    if (bucket === "scarce" || bucket === "point-source") p.scarce++;
  }

  // populate per-college totalSections
  for (const [, entry] of courseMap) {
    for (const [college, count] of entry.sectionsByCollege) {
      const pc = perCollegeMap.get(college);
      if (pc) pc.totalSections += count;
    }
  }

  const totalClassified = Object.values(bucketCounts).reduce((a, b) => a + b, 0);

  const coverageDistribution = Object.fromEntries(
    (Object.keys(bucketCounts) as CoverageBucket[]).map((k) => [
      k,
      {
        count: bucketCounts[k],
        pct: totalClassified > 0 ? Math.round((bucketCounts[k] / totalClassified) * 1000) / 10 : 0,
      },
    ])
  ) as StateStats["coverageDistribution"];

  const scarcityRatio =
    totalClassified > 0
      ? Math.round(
          ((bucketCounts.scarce + bucketCounts["point-source"]) / totalClassified) * 1000
        ) / 10
      : 0;

  // sort topUniversalCourses by college coverage desc, take top 10
  topUniversalCourses.sort((a, b) => b.colleges - a.colleges || b.sections - a.sections);
  const topUniversal = topUniversalCourses.slice(0, 10);

  // sort topPointSourceCourses by section count desc, take top 10
  topPointSourceCourses.sort((a, b) => b.sections - a.sections);
  const topPointSource = topPointSourceCourses.slice(0, 10);

  // anchor campuses: top 5 by exclusive course count
  const anchorCampuses = [...anchorMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([college, exclusiveCourses]) => ({
      college,
      exclusiveCourses,
      pct: Math.round((exclusiveCourses / (bucketCounts["point-source"] || 1)) * 1000) / 10,
      totalSections: perCollegeMap.get(college)?.totalSections ?? 0,
    }));

  // scarcest prefixes: top 5 by scarcePct (minimum 5 courses in prefix)
  const scarcestPrefixes = [...prefixMap.entries()]
    .filter(([, v]) => v.total >= 5)
    .map(([prefix, v]) => ({
      prefix,
      totalCourses: v.total,
      scarceCourses: v.scarce,
      scarcePct: Math.round((v.scarce / v.total) * 1000) / 10,
    }))
    .sort((a, b) => b.scarcePct - a.scarcePct)
    .slice(0, 5);

  // per-college summary sorted by totalSections desc
  const perCollege = [...perCollegeMap.entries()]
    .map(([college, v]) => ({ college, ...v }))
    .sort((a, b) => b.totalSections - a.totalSections);

  const terms = [...termsInState].sort();

  return {
    state: stateSlug,
    generatedAt: new Date().toISOString(),
    collegeCount,
    totalSections,
    uniqueCourseIds: courseMap.size,
    terms,
    coverageDistribution,
    multiChoiceCount,
    scarcityRatio,
    topUniversalCourses: topUniversal,
    topPointSourceCourses: topPointSource,
    anchorCampuses,
    scarcestPrefixes,
    perCollege,
  };
}

function detect(): Candidate[] {
  const states = getAllStates();
  const candidates: Candidate[] = [];

  const existingSpokes = articles.filter(
    (a) => a.cluster === CLUSTER && a.clusterRole === "spoke"
  );
  const coveredStates = new Set(
    existingSpokes.map((s) => s.state).filter((s): s is string => s !== null)
  );

  mkdirSync(SLICE_OUT_DIR, { recursive: true });

  for (const s of states) {
    if (coveredStates.has(s.slug)) continue;

    const stats = computeStats(s.slug);
    if (!stats) continue;

    // Threshold: meaningful multi-choice catalog + enough colleges for a scarcity story
    if (stats.multiChoiceCount < MULTI_CHOICE_MIN) {
      process.stderr.write(
        `[detect-course-scarcity] ${s.slug}: skip — multiChoiceCount ${stats.multiChoiceCount} < ${MULTI_CHOICE_MIN}\n`
      );
      continue;
    }
    if (stats.collegeCount < MIN_COLLEGE_COUNT) {
      process.stderr.write(
        `[detect-course-scarcity] ${s.slug}: skip — collegeCount ${stats.collegeCount} < ${MIN_COLLEGE_COUNT}\n`
      );
      continue;
    }

    const slicePath = resolve(SLICE_OUT_DIR, `${s.slug}.json`);
    writeFileSync(slicePath, JSON.stringify(stats, null, 2));

    candidates.push({
      triggerSource: "course-scarcity",
      topic: `${s.name} community college course availability: which courses are offered at every college vs. concentrated at anchor campuses`,
      targetReader: `${s.name} community college student who needs a specific course and isn't sure if their campus offers it or has to find it elsewhere`,
      searchIntentHypothesis: `User searching "${s.name.toLowerCase()} community college course availability" or "community college class not available at my campus ${s.name.toLowerCase()}" wants to know which courses are universally available vs. which require driving to a specific anchor campus`,
      articleType: "state-spoke",
      state: s.slug,
      cluster: CLUSTER,
      nonDuplicateRationale: `Cluster "${CLUSTER}" has ${existingSpokes.length} spoke(s), none for ${s.name}. Detector confirmed ${stats.multiChoiceCount} multi-choice courses across ${stats.collegeCount} colleges (${stats.totalSections} sections). Anchor campus: ${stats.anchorCampuses[0]?.college ?? "n/a"} with ${stats.anchorCampuses[0]?.exclusiveCourses ?? 0} exclusive courses.`,
      dataSlicePaths: [
        `data/${s.slug}/courses`,
        `lib/states/${s.slug}/config.ts`,
        `.blog-pipeline/slices/course-scarcity/${s.slug}.json`,
      ],
      rankScore:
        stats.multiChoiceCount +
        stats.collegeCount * 10 +
        Math.min(stats.topPointSourceCourses.length * 5, 50),
    });
  }

  candidates.sort((a, b) => b.rankScore - a.rankScore);
  return candidates;
}

function main() {
  if (existsSync(DISABLED)) {
    process.stdout.write(JSON.stringify({ candidates: [], disabled: true }));
    process.exit(0);
  }
  try {
    const candidates = detect();
    process.stderr.write(
      `[detect-course-scarcity] found ${candidates.length} candidate(s)\n`
    );
    process.stdout.write(JSON.stringify({ candidates }, null, 2));
    process.exit(0);
  } catch (err) {
    process.stderr.write(`[detect-course-scarcity] error: ${String(err)}\n`);
    process.stdout.write(JSON.stringify({ candidates: [], error: String(err) }));
    process.exit(1);
  }
}

main();

/**
 * build-subject-vocab.ts
 *
 * Phase 1 of the semantic-resolution effort (see #228 follow-up):
 * builds data/{state}/subject-vocab.json — a compact catalog summary
 * that downstream resolution code (and the Phase 3 LLM resolver) uses
 * to map free-text major terms ("geography", "premed", "coding") onto
 * actual programs and subject prefixes that exist in this state's data.
 *
 * Data sources:
 *   • data/{state}/courses/{college}/{term}.json — raw section data
 *     scraped per state. Aggregated by (prefix, number) so we count
 *     UNIQUE courses, not sections.
 *   • data/{state}/programs/{college}.json — program documents.
 *
 * Output shape (per state):
 *   {
 *     state, generated_at,
 *     subjects: [{ prefix, name, course_count, section_count,
 *                  colleges, sample_titles }],
 *     program_titles: [unique title strings]
 *   }
 *
 * The "name" field is a best-effort human-readable label inferred from
 * the most common leading-word of course titles for that prefix.
 * Downstream consumers don't depend on it being precise — sample_titles
 * is the authoritative signal — but it makes the JSON readable.
 *
 * Idempotent: re-running with no data changes produces no diff.
 *
 * Usage:
 *   npx tsx scripts/build-subject-vocab.ts            # all states
 *   npx tsx scripts/build-subject-vocab.ts va vt      # specific states
 *   npx tsx scripts/build-subject-vocab.ts --dry-run  # preview, no writes
 */

import * as fs from "fs";
import * as path from "path";

interface CourseSection {
  course_prefix?: string;
  course_number?: string;
  course_title?: string;
}

interface ProgramFile {
  programs?: Array<{ title?: string }>;
}

interface SubjectEntry {
  prefix: string;
  name: string;
  course_count: number;
  section_count: number;
  colleges: string[];
  sample_titles: string[];
}

interface SubjectVocab {
  state: string;
  generated_at: string;
  subjects: SubjectEntry[];
  program_titles: string[];
}

const DATA_ROOT = path.join(process.cwd(), "data");

// Common filler words — never used as the inferred subject name even if
// they're the modal token across titles for a prefix.
const FILLER_WORDS = new Set([
  "introduction",
  "intro",
  "principles",
  "general",
  "fundamentals",
  "advanced",
  "applied",
  "elementary",
  "intermediate",
  "basic",
  "topics",
  "selected",
  "special",
  "the",
  "an",
  "of",
  "and",
  "for",
  "to",
  "in",
  "on",
  "with",
  "from",
  "into",
  "course",
  "courses",
  "study",
  "studies",
  "lab",
  "laboratory",
  "lecture",
  "seminar",
  "honors",
  "co-op",
  "internship",
  "research",
  "directed",
  "independent",
]);

// Curated map of standard community-college subject codes to human-readable
// names. Used FIRST — applies whenever the prefix is in this map regardless
// of what's in course titles. Word-count inference is the fallback for
// prefixes not listed here. Covers the ~50 most common across CC systems.
const CURATED_PREFIX_NAMES: Record<string, string> = {
  ACC: "Accounting", ACCT: "Accounting", ACG: "Accounting",
  ADJ: "Administration of Justice",
  ART: "Art", ARTG: "Art", ARTH: "Art History", ARTS: "Art",
  AST: "Astronomy", ASTR: "Astronomy",
  AUT: "Automotive", AUTO: "Automotive", AUMT: "Automotive", ATR: "Automotive",
  BIO: "Biology", BIOL: "Biology", BIOT: "Biotechnology",
  BUS: "Business", BUSN: "Business",
  CHM: "Chemistry", CHEM: "Chemistry",
  CHD: "Child Development", CD: "Child Development",
  CIS: "Computer Information Systems", CIT: "Computer Information Technology",
  CJ: "Criminal Justice", CJU: "Criminal Justice", CRJ: "Criminal Justice",
  COM: "Communication", COMM: "Communication", CMS: "Communication",
  CON: "Construction",
  CSC: "Computer Science", CSCI: "Computer Science", CSE: "Computer Science",
  CST: "Communication Studies",
  CUL: "Culinary Arts", CULA: "Culinary Arts",
  DAN: "Dance", DANC: "Dance",
  ECE: "Early Childhood Education", ECED: "Early Childhood Education",
  ECO: "Economics", ECON: "Economics",
  EDU: "Education", EDUC: "Education",
  EGR: "Engineering", ENGE: "Engineering", ENGR: "Engineering", EGT: "Engineering Technology",
  ENG: "English", ENGL: "English",
  ENV: "Environmental Science", ENVS: "Environmental Science",
  ESL: "English as a Second Language",
  FIN: "Finance",
  FRE: "French", FREN: "French",
  GEO: "Geography", GEOG: "Geography",
  GIS: "Geographic Information Systems",
  HIS: "History", HIST: "History",
  HIT: "Health Information Technology", HIM: "Health Information Management",
  HLT: "Health", HEA: "Health",
  HUM: "Humanities",
  HVA: "HVAC", HVAC: "HVAC",
  ITN: "Information Technology Networking",
  ITP: "Information Technology Programming",
  ITE: "Information Technology Essentials",
  JOU: "Journalism", JOUR: "Journalism",
  LGL: "Legal Studies",
  MAR: "Marketing", MKT: "Marketing", MKTG: "Marketing",
  MAT: "Mathematics", MATH: "Mathematics", MTH: "Mathematics",
  MGT: "Management", MGMT: "Management",
  MUS: "Music", MUSC: "Music",
  NUR: "Nursing", NURS: "Nursing", NSG: "Nursing", ADN: "Nursing",
  PHI: "Philosophy", PHIL: "Philosophy",
  PHY: "Physics", PHYS: "Physics",
  POL: "Political Science", POLS: "Political Science", PLS: "Political Science",
  PSY: "Psychology", PSYC: "Psychology",
  PUB: "Public Administration",
  REL: "Religion",
  SDV: "Student Development",
  SOC: "Sociology",
  SPA: "Spanish", SPAN: "Spanish", SPN: "Spanish",
  SPC: "Speech",
  THE: "Theatre", THEA: "Theatre", THTR: "Theatre",
  WEL: "Welding", WLD: "Welding", WLDG: "Welding",
};

function listStates(arg: string[]): string[] {
  if (arg.length > 0) return arg;
  return fs
    .readdirSync(DATA_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

function readJsonSafe<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch {
    return null;
  }
}

function walkCourseFiles(stateDir: string): string[] {
  const coursesRoot = path.join(stateDir, "courses");
  if (!fs.existsSync(coursesRoot)) return [];
  const files: string[] = [];
  for (const college of fs.readdirSync(coursesRoot, { withFileTypes: true })) {
    if (!college.isDirectory()) continue;
    const dir = path.join(coursesRoot, college.name);
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith(".json")) files.push(path.join(dir, f));
    }
  }
  return files;
}

function inferSubjectName(prefix: string, titles: string[]): string {
  // 1. Curated map wins when present — handles BIO, MTH, ENG, CHM, etc.
  const curated = CURATED_PREFIX_NAMES[prefix];
  if (curated) return curated;

  // 2. Otherwise, count *all* content-word occurrences (not just first
  //    word — that biased toward "Introduction"/"Principles"/etc.). Pick
  //    the most common non-filler word ≥4 chars.
  const counts = new Map<string, number>();
  for (const t of titles) {
    const words = t
      .split(/\s+/)
      .map((w) => w.replace(/[^a-zA-Z]/g, "").toLowerCase())
      .filter((w) => w.length >= 4 && !FILLER_WORDS.has(w));
    // Dedupe within a single title so a 3-mention of "Biology" in one title
    // doesn't dominate the cross-title count.
    for (const w of new Set(words)) {
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }

  let best: string | null = null;
  let bestCount = 0;
  for (const [w, c] of counts) {
    if (c > bestCount) {
      best = w;
      bestCount = c;
    }
  }
  // Require the modal word to appear in ≥40% of titles before claiming it
  // as the subject name; otherwise the signal is noisy and we return the
  // raw prefix.
  if (best && bestCount / Math.max(1, titles.length) >= 0.4) {
    return best.charAt(0).toUpperCase() + best.slice(1);
  }
  return prefix;
}

function buildState(state: string): SubjectVocab {
  const stateDir = path.join(DATA_ROOT, state);

  // ── Subjects (from course sections) ─────────────────────────────────
  // Map prefix → { sectionCount, colleges:Set, courses:Map<number, longest title> }
  const byPrefix = new Map<
    string,
    {
      sections: number;
      colleges: Set<string>;
      courses: Map<string, string>;
    }
  >();

  for (const file of walkCourseFiles(stateDir)) {
    const sections = readJsonSafe<CourseSection[]>(file);
    if (!Array.isArray(sections)) continue;
    // Course directory is data/{state}/courses/{college}/{term}.json
    const college = path.basename(path.dirname(file));
    for (const s of sections) {
      const prefix = (s.course_prefix ?? "").trim().toUpperCase();
      const number = (s.course_number ?? "").trim();
      const title = (s.course_title ?? "").replace(/\s+/g, " ").trim();
      if (!prefix || !number) continue;
      let entry = byPrefix.get(prefix);
      if (!entry) {
        entry = { sections: 0, colleges: new Set(), courses: new Map() };
        byPrefix.set(prefix, entry);
      }
      entry.sections += 1;
      entry.colleges.add(college);
      // Keep the longest title we've seen for a given course — abbreviated
      // titles ("Biology I") get superseded by the fuller form ("General
      // Biology I") when both appear across colleges.
      const prev = entry.courses.get(number) ?? "";
      if (title.length > prev.length) entry.courses.set(number, title);
    }
  }

  const subjects: SubjectEntry[] = [];
  for (const [prefix, entry] of byPrefix) {
    const titles = [...entry.courses.values()].filter(Boolean);
    const sampleTitles = [...new Set(titles)]
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 5);
    subjects.push({
      prefix,
      name: inferSubjectName(prefix, titles),
      course_count: entry.courses.size,
      section_count: entry.sections,
      colleges: [...entry.colleges].sort(),
      sample_titles: sampleTitles,
    });
  }
  subjects.sort((a, b) => {
    // Sort by section_count desc — most-offered subjects first
    if (b.section_count !== a.section_count) {
      return b.section_count - a.section_count;
    }
    return a.prefix.localeCompare(b.prefix);
  });

  // ── Program titles (from data/{state}/programs/*.json) ───────────────
  const programsDir = path.join(stateDir, "programs");
  const titleSet = new Set<string>();
  if (fs.existsSync(programsDir)) {
    for (const f of fs.readdirSync(programsDir)) {
      if (!f.endsWith(".json")) continue;
      const data = readJsonSafe<ProgramFile>(path.join(programsDir, f));
      for (const p of data?.programs ?? []) {
        const t = (p.title ?? "").replace(/\s+/g, " ").trim();
        if (t) titleSet.add(t);
      }
    }
  }
  const program_titles = [...titleSet].sort((a, b) => a.localeCompare(b));

  return {
    state,
    generated_at: new Date().toISOString(),
    subjects,
    program_titles,
  };
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const states = listStates(args.filter((a) => !a.startsWith("--")));

  let totalSubjects = 0;
  let totalTitles = 0;
  for (const state of states) {
    const vocab = buildState(state);
    totalSubjects += vocab.subjects.length;
    totalTitles += vocab.program_titles.length;
    const outPath = path.join(DATA_ROOT, state, "subject-vocab.json");
    if (!dryRun) {
      fs.writeFileSync(outPath, JSON.stringify(vocab, null, 2));
    }
    console.log(
      `${dryRun ? "[dry-run] " : ""}${state.padEnd(4)} subjects=${vocab.subjects.length
        .toString()
        .padStart(4)}  programs=${vocab.program_titles.length
        .toString()
        .padStart(5)}  → ${path.relative(process.cwd(), outPath)}`,
    );
  }
  console.log(
    `\n${states.length} states · ${totalSubjects} subjects · ${totalTitles} unique program titles`,
  );
  if (dryRun) console.log("(dry run — no files written)");
}

main();

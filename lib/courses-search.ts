import type { CourseSection, Institution } from "./types";
import { getZipCoordinates, calculateDistance } from "./geo";
import { searchSections, getDistinctSubjects } from "./courses";
import { subjectName } from "./subjects";

// ---------------------------------------------------------------------------
// Cross-college search
//
// Split out of `lib/courses.ts` so that the `fs`/`path` import chain (via
// `./geo`'s zip-code lookup) doesn't get pulled into edge-runtime bundles
// that only need the Supabase-backed core from `lib/courses.ts`.
// ---------------------------------------------------------------------------

export interface CourseGroup {
  prefix: string;
  number: string;
  title: string;
  credits: number;
  colleges: CollegeGroup[];
  totalSections: number;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

export interface CollegeGroup {
  slug: string;
  name: string;
  distance: number | null;
  auditAllowed: boolean | null;
  sections: CourseSection[];
}

// Empty-state recovery: when a query matches courses but the mode/days/timeOfDay
// filters knock the result to zero, each suggestion reports how many
// courses/sections would match if that ONE filter were dropped — so the UI can
// offer "show N sections without the {evening} filter" instead of a dead end.
export interface RecoverySuggestion {
  drop: "mode" | "days" | "timeOfDay";
  /** Human label for the dropped filter, e.g. "evening", "online", "day". */
  droppedLabel: string;
  totalCourses: number;
  totalSections: number;
}

export interface SearchRecovery {
  suggestions: RecoverySuggestion[];
}

/** Parse a search query into structured parts */
export function parseQuery(q: string): {
  prefix: string | null;
  number: string | null;
  keyword: string | null;
} {
  const trimmed = q.trim().toUpperCase();

  // "ENG 111" or "ENG111"
  const exactMatch = trimmed.match(/^([A-Z]{2,4})\s*(\d{3})$/);
  if (exactMatch) {
    return { prefix: exactMatch[1], number: exactMatch[2], keyword: null };
  }

  // "ENG" (subject prefix only)
  const prefixMatch = trimmed.match(/^([A-Z]{2,4})$/);
  if (prefixMatch) {
    return { prefix: prefixMatch[1], number: null, keyword: null };
  }

  // Otherwise treat as keyword search on title
  return { prefix: null, number: null, keyword: q.trim().toLowerCase() };
}

// Filler words dropped when rescuing a no-result natural-language keyword query
// (e.g. "math courses without prerequisite" → "math"). Two groups:
//   1. Generic course / qualifier words.
//   2. Level / scope descriptors (intro, intermediate, advanced, principles…).
// Descriptors are dropped because in the 0-result rescue a bare descriptor token
// re-queries as a title substring and matches EVERY same-level course across all
// subjects — e.g. "Intermediate Arabic" pulled in "Intermediate Algebra",
// "Intermediate Accounting", etc. into the results grid. The SUBJECT token
// ("arabic") identifies the course and survives; a level word never names a
// subject, so dropping it only ever narrows cross-subject noise. A query that is
// ONLY descriptors yields no tokens → no rescue (acceptable; too vague to
// recover precisely).
const KEYWORD_FILLER = new Set([
  // generic course / qualifier words
  "course", "courses", "class", "classes", "section", "sections",
  "without", "with", "no", "not", "any", "all", "some", "that", "which",
  "have", "having", "has", "the", "for", "and", "or", "to", "do", "does",
  "prerequisite", "prerequisites", "prereq", "prereqs", "requisite", "requisites",
  "requirement", "requirements", "require", "requires", "required", "need", "needs",
  // level / scope descriptors (identify a LEVEL, not a subject)
  "intro", "introduction", "introductory", "beginning", "beginner", "beginners",
  "elementary", "intermediate", "advanced", "general", "principles",
  "fundamental", "fundamentals", "basic", "basics", "foundation", "foundations",
  "survey",
  // common English question / stop / intent words. Raw NL sentences reach the
  // rescue when the /ask page searches the whole question (e.g. "are there any
  // prerequisites for Intermediate Arabic II") — without these, "are" and
  // "there" substring-match "softwARE", "THEREapy", etc. across every subject.
  // None of these ever names a subject.
  "are", "was", "were", "what", "whats", "when", "where", "how", "why", "who",
  "whose", "whom", "can", "could", "will", "would", "should", "shall", "may",
  "might", "must", "did", "there", "here", "this", "these", "those", "you",
  "your", "yours", "our", "their", "them", "they", "its", "about", "from",
  "than", "then", "also", "only", "just", "into", "want", "wants", "looking",
  "show", "find", "take", "get", "available", "offered",
]);

/**
 * Reduce a free-text keyword to its meaningful tokens for the zero-result
 * rescue: lowercase, strip punctuation, drop filler words and tokens under 3
 * chars. "math courses without prerequisite?" → ["math"].
 */
export function meaningfulKeywordTokens(keyword: string): string[] {
  return keyword
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !KEYWORD_FILLER.has(t));
}

/** Check if a time string falls in a time-of-day bucket */
export function matchesTimeOfDay(
  startTime: string,
  bucket: "morning" | "afternoon" | "evening"
): boolean {
  if (!startTime || startTime === "TBA") return false;
  const match = startTime.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return false;
  let hours = parseInt(match[1], 10);
  const period = match[3].toUpperCase();
  if (period === "PM" && hours !== 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;

  switch (bucket) {
    case "morning":
      return hours < 12;
    case "afternoon":
      return hours >= 12 && hours < 17;
    case "evening":
      return hours >= 17;
  }
}

/** Check if a course meets on ANY of the given filter days (OR logic) */
export function sectionMatchesDays(days: string, filterDays: string[]): boolean {
  if (!days) return false;
  const tokens = days.split(" ");
  return filterDays.some((fd) => tokens.includes(fd));
}

/**
 * Search courses across all colleges.
 * Returns results grouped by course, then by college.
 */
export async function searchCoursesAcrossColleges(
  term: string,
  query: string,
  institutions: Institution[],
  filters: {
    mode?: string;
    days?: string[];
    timeOfDay?: "morning" | "afternoon" | "evening";
    zip?: string;
  } = {},
  limit = 10,
  offset = 0,
  state = "va"
): Promise<{
  courses: CourseGroup[];
  totalCourses: number;
  totalSections: number;
  totalColleges: number;
  recovery?: SearchRecovery;
}> {
  let { prefix, number, keyword } = parseQuery(query);
  // Push the query predicate into Postgres instead of loading every section
  // for the term and filtering in JS (which 504'd on large states like CA,
  // ~188k rows). The JS filters below still run on this already-narrowed set,
  // so output is unchanged — just over 10s–1000s of rows.
  let allCourses = await searchSections(term, state, { prefix, number, keyword });

  // Zero-result rescue for natural-language keyword phrases. A keyword like
  // "math courses without prerequisite" matches no course TITLE verbatim, so the
  // server-side search returns nothing (this also happens when the /ask
  // classifier leaves `keyword` null and the client searches the raw sentence).
  // Strip filler words and re-query on the remaining subject token(s). Because a
  // short subject word re-parses as a PREFIX (e.g. "math" → MATH), this recovers
  // the whole subject, not just title matches. Only runs when the normal search
  // found nothing, so it can never change a query that already returns results.
  if (allCourses.length === 0 && keyword) {
    const tokens = meaningfulKeywordTokens(keyword);
    if (tokens.length > 0) {
      // Resolve each token to THIS state's actual subject prefixes via subject
      // names — so "math" → MTH (VA) / MAT (NC) / MATH (CT,TX), not a literal
      // "MATH" that only some states use. Query those prefixes, plus each token
      // as a title keyword (to catch title-only words like "calculus" that
      // aren't subject names). Union + dedupe.
      const subjects = await getDistinctSubjects(term, state);
      const matchPrefixes = subjects.filter((p) =>
        tokens.some(
          (t) => p.toLowerCase().includes(t) || subjectName(p).toLowerCase().includes(t),
        ),
      );
      const seen = new Set<string>();
      const union: CourseSection[] = [];
      const add = (rows: CourseSection[]) => {
        for (const r of rows) {
          const k = `${r.course_prefix}-${r.course_number}-${r.college_code}-${r.crn}`;
          if (!seen.has(k)) {
            seen.add(k);
            union.push(r);
          }
        }
      };
      for (const p of matchPrefixes) {
        add(await searchSections(term, state, { prefix: p, number: null, keyword: null }));
      }
      for (const t of tokens) {
        add(await searchSections(term, state, { prefix: null, number: null, keyword: t }));
      }
      if (union.length > 0) {
        allCourses = union;
        prefix = null;
        number = null;
        keyword = null; // already matched per-token above
      }
    }
  }

  // Build institution lookup
  const instMap = new Map<string, Institution>();
  for (const inst of institutions) {
    instMap.set(inst.college_slug, inst);
  }

  // Get user coordinates for distance
  let userCoords: { lat: number; lng: number } | null = null;
  if (filters.zip) {
    const zipInfo = getZipCoordinates(filters.zip, state);
    if (zipInfo) userCoords = { lat: zipInfo.lat, lng: zipInfo.lng };
  }

  // Non-query filters (mode/days/time) — shared by the main pass and the
  // zero-result keyword rescue below so they stay in sync.
  const passesFilters = (s: CourseSection): boolean => {
    if (filters.mode && s.mode !== filters.mode) return false;
    if (filters.days && filters.days.length > 0 && !sectionMatchesDays(s.days, filters.days)) return false;
    if (filters.timeOfDay && !matchesTimeOfDay(s.start_time, filters.timeOfDay)) return false;
    return true;
  };

  // Step 1a: query match only (prefix/number/keyword reflect the rescue's
  // effective parse when it ran). This is the set the mode/days/timeOfDay
  // filters narrow — kept separate so empty-state recovery can re-count it
  // with one filter dropped, without re-querying.
  const queryMatched = allCourses.filter((s) => {
    if (prefix && s.course_prefix !== prefix) return false;
    if (number && s.course_number !== number) return false;
    if (keyword && !s.course_title.toLowerCase().includes(keyword)) return false;
    return true;
  });

  // Step 1b: apply the mode/days/timeOfDay hard filters.
  const matched = queryMatched.filter(passesFilters);

  // Step 2: Group by course (prefix+number), then by college
  const courseMap = new Map<
    string,
    {
      prefix: string;
      number: string;
      title: string;
      credits: number;
      prerequisite_text: string | null;
      prerequisite_courses: string[];
      byCollege: Map<string, CourseSection[]>;
    }
  >();

  for (const s of matched) {
    const courseKey = `${s.course_prefix}-${s.course_number}`;
    if (!courseMap.has(courseKey)) {
      courseMap.set(courseKey, {
        prefix: s.course_prefix,
        number: s.course_number,
        title: s.course_title,
        credits: s.credits,
        prerequisite_text: s.prerequisite_text || null,
        prerequisite_courses: s.prerequisite_courses || [],
        byCollege: new Map(),
      });
    }
    const group = courseMap.get(courseKey)!;
    // Fill in prerequisites from the first section that has them
    if (!group.prerequisite_text && s.prerequisite_text) {
      group.prerequisite_text = s.prerequisite_text;
      group.prerequisite_courses = s.prerequisite_courses || [];
    }
    if (!group.byCollege.has(s.college_code)) {
      group.byCollege.set(s.college_code, []);
    }
    group.byCollege.get(s.college_code)!.push(s);
  }

  // Step 3: Build response with distance calculations
  const allCollegeSlugs = new Set<string>();
  const courseGroups: CourseGroup[] = [];

  for (const [, data] of courseMap) {
    const colleges: CollegeGroup[] = [];

    for (const [slug, sections] of data.byCollege) {
      allCollegeSlugs.add(slug);
      const inst = instMap.get(slug);

      let distance: number | null = null;
      if (userCoords && inst && inst.campuses.length > 0) {
        // Use nearest campus
        distance = Math.min(
          ...inst.campuses.map((c) =>
            calculateDistance(userCoords!.lat, userCoords!.lng, c.lat, c.lng)
          )
        );
        distance = Math.round(distance * 10) / 10;
      }

      colleges.push({
        slug,
        name: inst?.name || slug,
        distance,
        auditAllowed: inst?.audit_policy?.allowed ?? null,
        sections,
      });
    }

    // Sort colleges: by distance if available, else by name
    colleges.sort((a, b) => {
      if (a.distance !== null && b.distance !== null)
        return a.distance - b.distance;
      if (a.distance !== null) return -1;
      if (b.distance !== null) return 1;
      return a.name.localeCompare(b.name);
    });

    courseGroups.push({
      prefix: data.prefix,
      number: data.number,
      title: data.title,
      credits: data.credits,
      colleges,
      totalSections: colleges.reduce((sum, c) => sum + c.sections.length, 0),
      prerequisite_text: data.prerequisite_text,
      prerequisite_courses: data.prerequisite_courses,
    });
  }

  // Sort course groups: most sections first (most available)
  courseGroups.sort((a, b) => b.totalSections - a.totalSections);

  const totalCourses = courseGroups.length;
  const totalSections = matched.length;
  const totalColleges = allCollegeSlugs.size;

  // Paginate
  const paginated = courseGroups.slice(offset, offset + limit);

  // Empty-state recovery. When the query DID match courses but the hard filters
  // zeroed the result, re-count `queryMatched` (the same already-fetched set)
  // with each applied filter dropped individually, so the UI can offer a way
  // forward instead of a dead end. Skipped when the query itself matched
  // nothing (queryMatched empty) — then "try a different keyword" is the right
  // message, not "drop a filter".
  let recovery: SearchRecovery | undefined;
  if (totalCourses === 0 && queryMatched.length > 0) {
    const applied: Array<"mode" | "days" | "timeOfDay"> = [];
    if (filters.mode) applied.push("mode");
    if (filters.days && filters.days.length > 0) applied.push("days");
    if (filters.timeOfDay) applied.push("timeOfDay");

    if (applied.length > 0) {
      const okMode = (s: CourseSection) => !filters.mode || s.mode === filters.mode;
      const okDays = (s: CourseSection) =>
        !(filters.days && filters.days.length > 0) || sectionMatchesDays(s.days, filters.days);
      const okTime = (s: CourseSection) =>
        !filters.timeOfDay || matchesTimeOfDay(s.start_time, filters.timeOfDay);
      // For each dropped filter, keep the OTHER two and count distinct courses + sections.
      const keepPred: Record<"mode" | "days" | "timeOfDay", (s: CourseSection) => boolean> = {
        mode: (s) => okDays(s) && okTime(s),
        days: (s) => okMode(s) && okTime(s),
        timeOfDay: (s) => okMode(s) && okDays(s),
      };
      const labelFor: Record<"mode" | "days" | "timeOfDay", string> = {
        mode: filters.mode || "mode",
        days: "day",
        timeOfDay: filters.timeOfDay || "time",
      };
      const suggestions: RecoverySuggestion[] = applied
        .map((drop) => {
          const courseSet = new Set<string>();
          let sections = 0;
          for (const s of queryMatched) {
            if (keepPred[drop](s)) {
              courseSet.add(`${s.course_prefix}-${s.course_number}`);
              sections++;
            }
          }
          return { drop, droppedLabel: labelFor[drop], totalCourses: courseSet.size, totalSections: sections };
        })
        .filter((x) => x.totalSections > 0)
        .sort((a, b) => b.totalSections - a.totalSections);
      if (suggestions.length > 0) recovery = { suggestions };
    }
  }

  return {
    courses: paginated,
    totalCourses,
    totalSections,
    totalColleges,
    ...(recovery ? { recovery } : {}),
  };
}

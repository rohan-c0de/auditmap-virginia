import type { CourseSection, Institution } from "./types";
import { getZipCoordinates, calculateDistance } from "./geo";
import { searchSections, getDistinctSubjects } from "./courses";
import { subjectName, subjectPrefixesForName } from "./subjects";

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
  /** "City, ST" from the college's primary campus address, or null if it can't
   * be parsed. Lets a result card convey proximity even with no zip entered. */
  city: string | null;
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

/**
 * Derive a "City, ST" label from a campus street address like
 * "1247 Jimmie Kerr Road, Graham, NC 27253" → "Graham, NC". The city is the
 * second-to-last comma segment (so multi-word cities like "Lake Jackson" and
 * "Corpus Christi" survive); the state is the first token of the last segment
 * (dropping the ZIP, including ZIP+4). Returns null when the address doesn't
 * have at least street/city/"ST ZIP" parts, so the UI just omits it.
 */
export function cityFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 3) return null;
  const city = parts[parts.length - 2];
  const stateAbbr = parts[parts.length - 1].split(/\s+/)[0];
  if (!city || !stateAbbr) return null;
  return `${city}, ${stateAbbr}`;
}

/** Parse a search query into structured parts */
export function parseQuery(q: string): {
  prefix: string | null;
  number: string | null;
  keyword: string | null;
} {
  const trimmed = q.trim().toUpperCase();

  // "ENG 111" or "ENG111" — also 4-digit numbering ("ENGL 1301", TX/FL).
  // With only \d{3}, "ENGL 1301" fell through to the title-keyword path and
  // returned the corequisite courses that MENTION it, not the course itself.
  const exactMatch = trimmed.match(/^([A-Z]{2,4})\s*(\d{3,4})$/);
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
    /** Optional cap in miles around `zip`; ignored without a resolvable zip. */
    radius?: number;
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

  // Subject-aware keyword search. A keyword like "english" only title-matches
  // colleges that literally word their titles that way — Houston CC titles
  // ENGL 1301 "Composition I", so its sections never matched while Austin CC's
  // "English…" titles did. Resolve the keyword as a subject NAME ("english" →
  // ENG/ENGL/ENC via lib/subjects.ts) and UNION those prefixes' sections with
  // the title matches, so per-college title wording can't hide a subject.
  // Restricted to prefixes the state actually offers (getDistinctSubjects is
  // cached) so unused prefixes never cost a query.
  let subjectPrefixes: string[] = [];
  if (keyword) {
    const candidates = subjectPrefixesForName(keyword);
    if (candidates.length > 0) {
      const stateSubjects = new Set(await getDistinctSubjects(term, state));
      subjectPrefixes = candidates.filter((p) => stateSubjects.has(p));
    }
  }
  const subjectPrefixSet = new Set(subjectPrefixes);

  // Push the query predicate into Postgres instead of loading every section
  // for the term and filtering in JS (which 504'd on large states like CA,
  // ~188k rows). The JS filters below still run on this already-narrowed set,
  // so output is unchanged — just over 10s–1000s of rows.
  let allCourses: CourseSection[];
  if (subjectPrefixes.length > 0) {
    const batches = await Promise.all([
      searchSections(term, state, { prefix: null, number: null, keyword }),
      ...subjectPrefixes.map((p) =>
        searchSections(term, state, { prefix: p, number: null, keyword: null })
      ),
    ]);
    // Dedupe across batches (a "English Composition" title row also arrives
    // via its ENG prefix batch). The key includes the meeting fields because
    // one CRN can have several meeting rows and CourseSection carries no row
    // id — crn alone would collapse a lecture+lab pair into one row.
    const seen = new Set<string>();
    allCourses = [];
    for (const rows of batches) {
      for (const r of rows) {
        const k = `${r.college_code}|${r.crn}|${r.course_prefix}${r.course_number}|${r.days}|${r.start_time}|${r.end_time}`;
        if (!seen.has(k)) {
          seen.add(k);
          allCourses.push(r);
        }
      }
    }
  } else {
    allCourses = await searchSections(term, state, { prefix, number, keyword });
  }

  // Zero-result rescue for natural-language keyword phrases. A keyword like
  // "math courses without prerequisite" matches no course TITLE verbatim, so the
  // server-side search returns nothing (this also happens when the /ask
  // classifier leaves `keyword` null and the client searches the raw sentence).
  // Strip filler words and re-query on the remaining subject token(s). Only runs
  // when the normal search found nothing, so it can never change a query that
  // already returns results.
  //
  // Also fires for a bare-PREFIX parse that found nothing: "math" parses as
  // prefix MATH, but a state that numbers its math courses MAT (NC) has no MATH
  // rows — the subject-name match below ("mathematics".includes("math")) then
  // recovers the state's real prefix instead of dead-ending at 0 results.
  const rescueKeyword =
    keyword ?? (prefix && !number ? query.trim().toLowerCase() : null);
  if (allCourses.length === 0 && rescueKeyword) {
    const tokens = meaningfulKeywordTokens(rescueKeyword);
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

  // Per-college distance to the user's zip (nearest campus), computed once and
  // shared by the radius filter, the per-college display value, and the course
  // ordering so the three can never disagree.
  const collegeDistance = new Map<string, number>();
  if (userCoords) {
    for (const inst of institutions) {
      if (inst.campuses.length === 0) continue;
      const d = Math.min(
        ...inst.campuses.map((c) =>
          calculateDistance(userCoords!.lat, userCoords!.lng, c.lat, c.lng)
        )
      );
      collegeDistance.set(inst.college_slug, Math.round(d * 10) / 10);
    }
  }

  // Optional radius cap (miles around the zip). Scopes the section universe
  // BEFORE the query/mode/days/timeOfDay steps — like `term` does — so the
  // empty-state recovery counts never suggest sections at colleges outside the
  // radius. Colleges with no campus coordinates are kept: we can't show a
  // distance for them, but we also can't prove they're far.
  const radius = filters.radius;
  if (userCoords && radius && radius > 0) {
    allCourses = allCourses.filter((s) => {
      const d = collegeDistance.get(s.college_code);
      return d === undefined || d <= radius;
    });
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
    // A section matches a keyword by title OR by belonging to a subject prefix
    // the keyword resolved to — without the prefix clause this re-filter would
    // strip the subject-union rows whose titles don't contain the keyword
    // (the entire point of the union).
    if (
      keyword &&
      !s.course_title.toLowerCase().includes(keyword) &&
      !subjectPrefixSet.has(s.course_prefix)
    )
      return false;
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

      // Nearest-campus distance, precomputed once per college above.
      const distance: number | null = collegeDistance.get(slug) ?? null;

      colleges.push({
        slug,
        name: inst?.name || slug,
        // Primary-campus city, so a result conveys where the college is even
        // when no zip was entered (no distance computed).
        city: cityFromAddress(inst?.campuses?.[0]?.address),
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

  // Sort course groups: with a zip, nearest offering college first (each
  // group's colleges are already distance-sorted, so colleges[0] is its
  // nearest), availability breaking ties — so a Houston student sees Houston
  // CC's courses before Austin CC's. Without a zip: most sections first,
  // unchanged.
  if (userCoords) {
    const nearest = (g: CourseGroup) =>
      g.colleges[0]?.distance ?? Number.POSITIVE_INFINITY;
    courseGroups.sort(
      (a, b) => nearest(a) - nearest(b) || b.totalSections - a.totalSections
    );
  } else {
    courseGroups.sort((a, b) => b.totalSections - a.totalSections);
  }

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

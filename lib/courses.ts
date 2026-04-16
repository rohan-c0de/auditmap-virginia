import type { CourseSection } from "./types";
import { supabase } from "./supabase";

// ---------------------------------------------------------------------------
// In-memory cache (server-side, survives across requests in dev/prod)
// ---------------------------------------------------------------------------

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface CacheEntry<T> {
  data: T;
  expires: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (entry && entry.expires > Date.now()) return entry.data;

  // Deduplicate concurrent requests for the same key
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const promise = fn()
    .then((data) => {
      cache.set(key, { data, expires: Date.now() + CACHE_TTL });
      inflight.delete(key);
      return data;
    })
    .catch((err) => {
      inflight.delete(key);
      throw err;
    });

  inflight.set(key, promise);
  return promise;
}

/**
 * Load all course sections for a given college and term from Supabase.
 */
export async function loadCoursesForCollege(
  collegeSlug: string,
  term: string,
  state = "va"
): Promise<CourseSection[]> {
  return cached(`courses:${state}:${collegeSlug}:${term}`, async () => {
    // Supabase caps rows at 1000 by default. Paginate in parallel to get
    // everything for colleges with more than 1000 sections (e.g. NOVA ~2000+).
    const { count, error: countErr } = await supabase
      .from("courses")
      .select("id", { count: "exact", head: true })
      .eq("college_code", collegeSlug)
      .eq("term", term)
      .eq("state", state);

    if (countErr || !count || count === 0) {
      if (countErr) console.error("loadCoursesForCollege count error:", countErr.message);
      return [];
    }

    const PAGE_SIZE = 1000;
    const pages = Math.ceil(count / PAGE_SIZE);
    const promises: Promise<CourseSection[]>[] = [];

    for (let i = 0; i < pages; i++) {
      const start = i * PAGE_SIZE;
      const end = start + PAGE_SIZE - 1;
      promises.push(
        (async () => {
          const { data, error } = await supabase
            .from("courses")
            .select("*")
            .eq("college_code", collegeSlug)
            .eq("term", term)
            .eq("state", state)
            .range(start, end);
          if (error) {
            console.error(`loadCoursesForCollege page ${i} error:`, error.message);
            return [];
          }
          return (data || []).map(mapRow);
        })()
      );
    }

    const results = await Promise.all(promises);
    return results.flat();
  });
}

/**
 * Get all term codes that have at least one course in Supabase for a state.
 * Uses RPC function to avoid downloading all rows.
 */
export async function getAvailableTerms(state = "va"): Promise<string[]> {
  return cached(`terms:${state}`, async () => {
    // Use RPC if available, fallback to manual distinct
    const { data, error } = await supabase.rpc("get_distinct_terms", {
      p_state: state,
    });

    if (!error && data) {
      return (data as { term: string }[]).map((r) => r.term).sort();
    }

    // Fallback: select distinct via select + limit (less efficient but works without RPC)
    console.warn("get_distinct_terms RPC not available, using fallback");
    const { data: fallback, error: fbErr } = await supabase
      .from("courses")
      .select("term")
      .eq("state", state)
      .limit(50000);

    if (fbErr || !fallback) return [];

    const terms = new Set<string>();
    for (const row of fallback) {
      terms.add(row.term);
    }
    return Array.from(terms).sort();
  });
}

/**
 * Return the sorted list of terms that have at least one section of a given
 * subject prefix at a given college. Targeted `SELECT term` scan — returns
 * only the term column for matching rows (~hundreds of rows) instead of the
 * full catalog per term. Used to build the term selector on the subject page
 * without paying for a full `loadCoursesForCollege` × N_terms round trip.
 */
export async function getTermsWithDataForCollegeSubject(
  collegeSlug: string,
  prefix: string,
  state = "va"
): Promise<string[]> {
  return cached(
    `termsForCollegeSubject:${state}:${collegeSlug}:${prefix}`,
    async () => {
      // Paginate the term-only scan to handle subjects at large colleges
      // that exceed the 1000-row default cap (rare but possible).
      const seen = new Set<string>();
      const PAGE_SIZE = 1000;
      let page = 0;
      while (true) {
        const start = page * PAGE_SIZE;
        const { data, error } = await supabase
          .from("courses")
          .select("term")
          .eq("college_code", collegeSlug)
          .eq("course_prefix", prefix)
          .eq("state", state)
          .range(start, start + PAGE_SIZE - 1);
        if (error) {
          console.error(
            "getTermsWithDataForCollegeSubject error:",
            error.message
          );
          break;
        }
        if (!data || data.length === 0) break;
        for (const row of data) seen.add(row.term);
        if (data.length < PAGE_SIZE) break;
        page++;
      }
      return Array.from(seen).sort();
    }
  );
}

/**
 * Return the count of course sections for a college/term without loading all data.
 */
export async function getCourseCount(
  collegeSlug: string,
  term: string,
  state = "va"
): Promise<number> {
  return cached(`count:${state}:${collegeSlug}:${term}`, async () => {
    const { count, error } = await supabase
      .from("courses")
      .select("id", { count: "exact", head: true })
      .eq("college_code", collegeSlug)
      .eq("term", term)
      .eq("state", state);

    if (error) return 0;
    return count || 0;
  });
}

/**
 * Filter an array of course sections by optional subject prefix, day pattern,
 * and delivery mode.
 */
export function filterCourses(
  courses: CourseSection[],
  filters: { subject?: string; days?: string; mode?: string }
): CourseSection[] {
  return courses.filter((course) => {
    if (filters.subject && course.course_prefix !== filters.subject) {
      return false;
    }

    if (filters.days && !course.days.includes(filters.days)) {
      return false;
    }

    if (filters.mode && course.mode !== filters.mode) {
      return false;
    }

    return true;
  });
}

/**
 * Check whether the course data for a college/term is stale (more than 3 days
 * old based on the most recent created_at timestamp).
 */
export async function isDataStale(
  collegeSlug: string,
  term: string,
  state = "va"
): Promise<boolean> {
  const { data, error } = await supabase
    .from("courses")
    .select("created_at")
    .eq("college_code", collegeSlug)
    .eq("term", term)
    .eq("state", state)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) return true;

  const ageMs = Date.now() - new Date(data[0].created_at).getTime();
  const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
  return ageMs > threeDaysMs;
}

/**
 * Trim fields not used by client components (CourseTable, ScheduleBuilder)
 * before serializing into the RSC payload. Reduces college-page HTML for
 * large colleges by actually omitting redundant/unused data:
 *  - college_code, term: same for every course on a college page (redundant)
 *  - seats_open, seats_total: not displayed on college page
 *  - prerequisite_courses: unused by any component
 *
 * The returned type is cast as CourseSection[] since client components only
 * read the subset of fields that remain.
 */
export function trimCoursesForClient(
  courses: CourseSection[]
): CourseSection[] {
  return courses.map(
    ({
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      college_code,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      term,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      seats_open,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      seats_total,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      prerequisite_courses,
      ...rest
    }) => rest as CourseSection
  );
}

/**
 * Extract a sorted list of unique course prefixes (subjects) from an array of
 * course sections.
 */
export function getUniqueSubjects(courses: CourseSection[]): string[] {
  const subjects = new Set<string>();

  for (const course of courses) {
    subjects.add(course.course_prefix);
  }

  return Array.from(subjects).sort();
}

// ---------------------------------------------------------------------------
// Cross-college search
// ---------------------------------------------------------------------------

/**
 * Load all courses from all colleges for a given term from Supabase.
 * Uses parallel pagination for speed.
 */
export async function loadAllCourses(
  term: string,
  state = "va"
): Promise<CourseSection[]> {
  return cached(`allCourses:${state}:${term}`, async () => {
    // First, get total count to know how many pages we need
    const { count, error: countErr } = await supabase
      .from("courses")
      .select("id", { count: "exact", head: true })
      .eq("term", term)
      .eq("state", state);

    if (countErr || !count || count === 0) return [];

    // Fetch all pages in parallel (much faster than sequential)
    const PAGE_SIZE = 1000;
    const pages = Math.ceil(count / PAGE_SIZE);
    const promises: Promise<CourseSection[]>[] = [];

    for (let i = 0; i < pages; i++) {
      const start = i * PAGE_SIZE;
      const end = start + PAGE_SIZE - 1;
      promises.push(
        (async () => {
          const { data, error } = await supabase
            .from("courses")
            .select("*")
            .eq("term", term)
            .eq("state", state)
            .range(start, end);
          if (error) {
            console.error(`loadAllCourses page ${i} error:`, error.message);
            return [];
          }
          return (data || []).map(mapRow);
        })()
      );
    }

    const results = await Promise.all(promises);
    return results.flat();
  });
}

/**
 * Load all sections for a single course (prefix + number) across the state.
 * Targeted query — pulls ~10–100 rows instead of the full ~30k state catalog.
 * Used by the course detail pSEO pages to keep CPU + origin transfer small.
 */
export async function loadCourseByCode(
  prefix: string,
  number: string,
  term: string,
  state = "va"
): Promise<CourseSection[]> {
  return cached(`course:${state}:${term}:${prefix}:${number}`, async () => {
    const { data, error } = await supabase
      .from("courses")
      .select("*")
      .eq("state", state)
      .eq("term", term)
      .eq("course_prefix", prefix)
      .eq("course_number", number);

    if (error) {
      console.error("loadCourseByCode error:", error.message);
      return [];
    }
    return (data || []).map(mapRow);
  });
}

/**
 * Load all sections for one subject prefix across the state.
 * Targeted query — pulls only the rows for that prefix (typically 100–2000)
 * instead of the full state catalog. Used by the subject pSEO pages.
 *
 * Paginates in parallel because some popular subjects (e.g. ENG, MTH) can
 * exceed the Supabase 1000-row default cap.
 */
export async function loadCoursesBySubject(
  prefix: string,
  term: string,
  state = "va"
): Promise<CourseSection[]> {
  return cached(`subject:${state}:${term}:${prefix}`, async () => {
    const { count, error: countErr } = await supabase
      .from("courses")
      .select("id", { count: "exact", head: true })
      .eq("state", state)
      .eq("term", term)
      .eq("course_prefix", prefix);

    if (countErr || !count || count === 0) {
      if (countErr) console.error("loadCoursesBySubject count error:", countErr.message);
      return [];
    }

    const PAGE_SIZE = 1000;
    const pages = Math.ceil(count / PAGE_SIZE);
    const promises: Promise<CourseSection[]>[] = [];

    for (let i = 0; i < pages; i++) {
      const start = i * PAGE_SIZE;
      const end = start + PAGE_SIZE - 1;
      promises.push(
        (async () => {
          const { data, error } = await supabase
            .from("courses")
            .select("*")
            .eq("state", state)
            .eq("term", term)
            .eq("course_prefix", prefix)
            .range(start, end);
          if (error) {
            console.error(`loadCoursesBySubject page ${i} error:`, error.message);
            return [];
          }
          return (data || []).map(mapRow);
        })()
      );
    }

    const results = await Promise.all(promises);
    return results.flat();
  });
}

/**
 * Single scan returning both distinct course codes and per-prefix section
 * counts for a state+term. Used by the sitemap so it doesn't have to pull
 * the full row catalog (~9 MB) just to enumerate URLs (~50 KB).
 */
export async function getSitemapCourseIndex(
  term: string,
  state = "va"
): Promise<{
  codes: { prefix: string; number: string }[];
  subjectSectionCounts: Map<string, number>;
}> {
  return cached(`sitemapIndex:${state}:${term}`, async () => {
    const seen = new Set<string>();
    const codes: { prefix: string; number: string }[] = [];
    const subjectSectionCounts = new Map<string, number>();

    const PAGE_SIZE = 1000;
    let page = 0;
    while (true) {
      const start = page * PAGE_SIZE;
      const { data: rows, error } = await supabase
        .from("courses")
        .select("course_prefix,course_number")
        .eq("state", state)
        .eq("term", term)
        .range(start, start + PAGE_SIZE - 1);
      if (error || !rows || rows.length === 0) break;
      for (const r of rows) {
        const key = `${r.course_prefix}-${r.course_number}`;
        if (!seen.has(key)) {
          seen.add(key);
          codes.push({ prefix: r.course_prefix, number: r.course_number });
        }
        subjectSectionCounts.set(
          r.course_prefix,
          (subjectSectionCounts.get(r.course_prefix) || 0) + 1
        );
      }
      if (rows.length < PAGE_SIZE) break;
      page++;
    }
    return { codes, subjectSectionCounts };
  });
}

/**
 * Return distinct subject prefixes for a state+term.
 * Used by subject pages to build "browse other subjects" links without
 * loading the full state catalog.
 */
export async function getDistinctSubjects(
  term: string,
  state = "va"
): Promise<string[]> {
  return cached(`distinctSubjects:${state}:${term}`, async () => {
    // Fallback scan that pulls only the prefix column — even without an RPC
    // this is ~50 KB instead of the 9 MB for the full catalog.
    const seen = new Set<string>();
    const PAGE_SIZE = 1000;
    let page = 0;
    while (true) {
      const start = page * PAGE_SIZE;
      const { data: rows, error } = await supabase
        .from("courses")
        .select("course_prefix")
        .eq("state", state)
        .eq("term", term)
        .range(start, start + PAGE_SIZE - 1);
      if (error || !rows || rows.length === 0) break;
      for (const r of rows) seen.add(r.course_prefix);
      if (rows.length < PAGE_SIZE) break;
      page++;
    }
    return Array.from(seen).sort();
  });
}

/**
 * Return distinct (course_prefix, course_number) pairs for a state+term.
 * Used by the sitemap to enumerate course detail URLs without pulling the
 * entire course catalog. Falls back to a paginated 2-column scan if the
 * Supabase RPC is missing.
 */
export async function getDistinctCourseCodes(
  term: string,
  state = "va"
): Promise<{ prefix: string; number: string }[]> {
  return cached(`distinctCourses:${state}:${term}`, async () => {
    // Try RPC first (most efficient: server-side DISTINCT)
    const { data, error } = await supabase.rpc("get_distinct_course_codes", {
      p_state: state,
      p_term: term,
    });

    if (!error && data) {
      return (data as { course_prefix: string; course_number: string }[]).map(
        (r) => ({ prefix: r.course_prefix, number: r.course_number })
      );
    }

    // Fallback: select only the two columns we need (cheaper than select *)
    console.warn("get_distinct_course_codes RPC missing, using fallback scan");
    const seen = new Set<string>();
    const out: { prefix: string; number: string }[] = [];
    const PAGE_SIZE = 1000;
    let page = 0;
    while (true) {
      const start = page * PAGE_SIZE;
      const { data: rows, error: pageErr } = await supabase
        .from("courses")
        .select("course_prefix,course_number")
        .eq("state", state)
        .eq("term", term)
        .range(start, start + PAGE_SIZE - 1);
      if (pageErr || !rows || rows.length === 0) break;
      for (const r of rows) {
        const key = `${r.course_prefix}-${r.course_number}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ prefix: r.course_prefix, number: r.course_number });
        }
      }
      if (rows.length < PAGE_SIZE) break;
      page++;
    }
    return out;
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map a Supabase row to a CourseSection object.
 * Handles field name mapping and type coercion.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): CourseSection {
  return {
    college_code: row.college_code,
    term: row.term,
    course_prefix: row.course_prefix,
    course_number: row.course_number,
    course_title: row.course_title,
    credits: Number(row.credits) || 0,
    crn: row.crn,
    days: row.days || "",
    start_time: row.start_time || "",
    end_time: row.end_time || "",
    start_date: row.start_date || "",
    location: row.location || "",
    campus: row.campus || "",
    mode: row.mode || "in-person",
    instructor: row.instructor || null,
    seats_open: row.seats_open ?? null,
    seats_total: row.seats_total ?? null,
    prerequisite_text: row.prerequisite_text || null,
    prerequisite_courses: row.prerequisite_courses || [],
  };
}

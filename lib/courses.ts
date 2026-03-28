import fs from "fs";
import path from "path";
import type { CourseSection, Institution } from "./types";
import { getZipCoordinates, calculateDistance } from "./geo";

const DATA_DIR = path.join(process.cwd(), "data", "courses");

// Module-level cache for all-college data
let allCoursesCache: { term: string; data: CourseSection[] } | null = null;

/**
 * Load all course sections for a given college and term from the static JSON
 * file at data/courses/{slug}/{term}.json.
 */
export function loadCoursesForCollege(
  collegeSlug: string,
  term: string
): CourseSection[] {
  const filePath = path.join(DATA_DIR, collegeSlug, `${term}.json`);

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as CourseSection[];
  } catch {
    return [];
  }
}

/**
 * Scan the data/courses directory tree and return all term identifiers that
 * have at least one JSON file present across any college.
 */
export function getAvailableTerms(): string[] {
  const terms = new Set<string>();

  try {
    const slugs = fs.readdirSync(DATA_DIR);

    for (const slug of slugs) {
      const slugDir = path.join(DATA_DIR, slug);
      if (!fs.statSync(slugDir).isDirectory()) continue;

      const files = fs.readdirSync(slugDir);
      for (const file of files) {
        if (file.endsWith(".json")) {
          terms.add(file.replace(".json", ""));
        }
      }
    }
  } catch {
    // data directory may not exist yet
  }

  return Array.from(terms).sort();
}

/**
 * Return the number of course sections for a college/term combination without
 * loading the full array into the caller's scope.
 */
export function getCourseCount(collegeSlug: string, term: string): number {
  return loadCoursesForCollege(collegeSlug, term).length;
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
 * Check whether the data file for a college/term is stale (more than 8 days
 * old based on file modification time).
 */
export function isDataStale(collegeSlug: string, term: string): boolean {
  const filePath = path.join(DATA_DIR, collegeSlug, `${term}.json`);

  try {
    const stat = fs.statSync(filePath);
    const ageMs = Date.now() - stat.mtimeMs;
    const eightDaysMs = 8 * 24 * 60 * 60 * 1000;
    return ageMs > eightDaysMs;
  } catch {
    // If the file does not exist, consider it stale
    return true;
  }
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
 * Load all courses from all colleges for a given term.
 * Uses a module-level cache to avoid re-reading files on repeated calls.
 */
export function loadAllCourses(term: string): CourseSection[] {
  if (allCoursesCache && allCoursesCache.term === term) {
    return allCoursesCache.data;
  }

  const all: CourseSection[] = [];
  try {
    const slugs = fs.readdirSync(DATA_DIR);
    for (const slug of slugs) {
      const slugDir = path.join(DATA_DIR, slug);
      if (!fs.statSync(slugDir).isDirectory()) continue;
      const courses = loadCoursesForCollege(slug, term);
      all.push(...courses);
    }
  } catch {
    // data directory may not exist
  }

  allCoursesCache = { term, data: all };
  return all;
}

/** Parse a search query into structured parts */
function parseQuery(q: string): {
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

/** Check if a time string falls in a time-of-day bucket */
function matchesTimeOfDay(
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

/** Check if a course meets on a given day */
function sectionMatchesDay(days: string, filterDay: string): boolean {
  if (!days) return false;
  return days.split(" ").includes(filterDay);
}

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

/**
 * Search courses across all colleges.
 * Returns results grouped by course, then by college.
 */
export function searchCoursesAcrossColleges(
  term: string,
  query: string,
  institutions: Institution[],
  filters: {
    mode?: string;
    day?: string;
    timeOfDay?: "morning" | "afternoon" | "evening";
    zip?: string;
  } = {},
  limit = 10,
  offset = 0
): {
  courses: CourseGroup[];
  totalCourses: number;
  totalSections: number;
  totalColleges: number;
} {
  const allCourses = loadAllCourses(term);
  const { prefix, number, keyword } = parseQuery(query);

  // Build institution lookup
  const instMap = new Map<string, Institution>();
  for (const inst of institutions) {
    instMap.set(inst.vccs_slug, inst);
  }

  // Get user coordinates for distance
  let userCoords: { lat: number; lng: number } | null = null;
  if (filters.zip) {
    const zipInfo = getZipCoordinates(filters.zip);
    if (zipInfo) userCoords = { lat: zipInfo.lat, lng: zipInfo.lng };
  }

  // Step 1: Filter sections
  const matched = allCourses.filter((s) => {
    // Query matching
    if (prefix && s.course_prefix !== prefix) return false;
    if (number && s.course_number !== number) return false;
    if (keyword && !s.course_title.toLowerCase().includes(keyword)) return false;

    // Filters
    if (filters.mode && s.mode !== filters.mode) return false;
    if (filters.day && !sectionMatchesDay(s.days, filters.day)) return false;
    if (filters.timeOfDay && !matchesTimeOfDay(s.start_time, filters.timeOfDay))
      return false;

    return true;
  });

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
        auditAllowed: inst?.audit_policy.allowed ?? null,
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

  return { courses: paginated, totalCourses, totalSections, totalColleges };
}

import type { CourseSection, Institution } from "./types";
import { getZipCoordinates, calculateDistance } from "./geo";
import { loadAllCourses } from "./courses";

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

/** Check if a course meets on ANY of the given filter days (OR logic) */
function sectionMatchesDays(days: string, filterDays: string[]): boolean {
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
}> {
  const allCourses = await loadAllCourses(term, state);
  const { prefix, number, keyword } = parseQuery(query);

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

  // Step 1: Filter sections
  const matched = allCourses.filter((s) => {
    // Query matching
    if (prefix && s.course_prefix !== prefix) return false;
    if (number && s.course_number !== number) return false;
    if (keyword && !s.course_title.toLowerCase().includes(keyword)) return false;

    // Filters
    if (filters.mode && s.mode !== filters.mode) return false;
    if (filters.days && filters.days.length > 0 && !sectionMatchesDays(s.days, filters.days)) return false;
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

  return { courses: paginated, totalCourses, totalSections, totalColleges };
}

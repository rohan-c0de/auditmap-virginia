import { NextRequest, NextResponse } from "next/server";
import { loadAllCourses, getAvailableTerms } from "@/lib/courses";
import { daysUntilStart } from "@/lib/course-status";
import { rateLimit, getClientKey } from "@/lib/rate-limit";
import { getZipCoordinates, calculateDistance } from "@/lib/geo";
import { loadInstitutions } from "@/lib/institutions";
import { isValidState } from "@/lib/states/registry";
import type { Institution, CourseSection } from "@/lib/types";

interface CollegeGroup {
  slug: string;
  name: string;
  auditAllowed: boolean | null;
  distance: number | null;
  sections: CourseSection[];
}

interface CourseGroup {
  prefix: string;
  number: string;
  title: string;
  credits: number;
  colleges: CollegeGroup[];
  totalSections: number;
}

interface DateGroup {
  date: string;
  label: string;
  daysAway: number;
  courses: CourseGroup[];
  totalSections: number;
}

type RouteContext = { params: Promise<{ state: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { state } = await context.params;

  if (!isValidState(state)) {
    return NextResponse.json({ error: "Unknown state" }, { status: 404 });
  }

  const { allowed } = rateLimit(getClientKey(request));
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again in a minute." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  const institutions = loadInstitutions(state);
  const { searchParams } = request.nextUrl;
  const daysWindow = Math.max(1, Math.min(parseInt(searchParams.get("window") || "14", 10) || 14, 60));
  const mode = searchParams.get("mode")?.trim() || undefined;
  const subject = searchParams.get("subject")?.trim().toUpperCase() || undefined;
  const zip = searchParams.get("zip")?.trim() || undefined;

  // Load courses from all available terms — late-start Spring sections and
  // early Summer sections can both fall within the upcoming window.
  const terms = await getAvailableTerms(state);
  const coursesPerTerm = await Promise.all(terms.map((t) => loadAllCourses(t, state)));
  const allCourses = coursesPerTerm.flat();

  // Build institution lookup
  const instMap = new Map<string, Institution>();
  for (const inst of institutions) {
    instMap.set(inst.college_slug, inst);
  }

  // Get user coordinates
  let userCoords: { lat: number; lng: number } | null = null;
  if (zip) {
    const zipInfo = getZipCoordinates(zip, state);
    if (zipInfo) userCoords = { lat: zipInfo.lat, lng: zipInfo.lng };
  }

  // Filter to upcoming courses within the window
  const upcoming = allCourses.filter((s) => {
    if (!s.start_date || !/^\d{4}-\d{2}-\d{2}$/.test(s.start_date)) return false;
    const days = daysUntilStart(s.start_date);
    if (days < 0 || days > daysWindow) return false;
    if (mode && s.mode !== mode) return false;
    if (subject && s.course_prefix !== subject) return false;
    return true;
  });

  // Group by date → course → college
  const dateMap = new Map<string, Map<string, Map<string, CourseSection[]>>>();

  for (const s of upcoming) {
    const date = s.start_date;
    if (!dateMap.has(date)) dateMap.set(date, new Map());
    const courseMap = dateMap.get(date)!;

    const courseKey = `${s.course_prefix}-${s.course_number}`;
    if (!courseMap.has(courseKey)) courseMap.set(courseKey, new Map());
    const collegeMap = courseMap.get(courseKey)!;

    if (!collegeMap.has(s.college_code)) collegeMap.set(s.college_code, []);
    collegeMap.get(s.college_code)!.push(s);
  }

  // Build response
  const dateGroups: DateGroup[] = [];

  for (const [date, courseMap] of dateMap) {
    const d = new Date(date + "T12:00:00Z");
    const label = d.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    const daysAway = daysUntilStart(date);

    const courses: CourseGroup[] = [];
    let dateTotalSections = 0;

    for (const [, collegeMap] of courseMap) {
      const colleges: CollegeGroup[] = [];
      let courseTotalSections = 0;
      let coursePrefix = "";
      let courseNumber = "";
      let courseTitle = "";
      let courseCredits = 0;

      for (const [slug, sections] of collegeMap) {
        const inst = instMap.get(slug);
        let distance: number | null = null;
        if (userCoords && inst && inst.campuses.length > 0) {
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
          auditAllowed: inst?.audit_policy.allowed ?? null,
          distance,
          sections,
        });

        courseTotalSections += sections.length;

        // Get course info from first section
        if (!coursePrefix && sections.length > 0) {
          coursePrefix = sections[0].course_prefix;
          courseNumber = sections[0].course_number;
          courseTitle = sections[0].course_title;
          courseCredits = sections[0].credits;
        }
      }

      // Sort colleges by distance if available, then by name
      colleges.sort((a, b) => {
        if (a.distance !== null && b.distance !== null) return a.distance - b.distance;
        if (a.distance !== null) return -1;
        if (b.distance !== null) return 1;
        return a.name.localeCompare(b.name);
      });

      courses.push({
        prefix: coursePrefix,
        number: courseNumber,
        title: courseTitle,
        credits: courseCredits,
        colleges,
        totalSections: courseTotalSections,
      });

      dateTotalSections += courseTotalSections;
    }

    // Sort courses by total sections (most available first)
    courses.sort((a, b) => b.totalSections - a.totalSections);

    dateGroups.push({
      date,
      label,
      daysAway,
      courses,
      totalSections: dateTotalSections,
    });
  }

  // Sort date groups chronologically
  dateGroups.sort((a, b) => a.date.localeCompare(b.date));

  const totalSections = upcoming.length;
  const totalCourses = new Set(upcoming.map((s) => `${s.course_prefix}-${s.course_number}`)).size;
  const totalColleges = new Set(upcoming.map((s) => s.college_code)).size;

  return NextResponse.json({
    dateGroups,
    meta: {
      totalSections,
      totalCourses,
      totalColleges,
      window: daysWindow,
    },
  });
}

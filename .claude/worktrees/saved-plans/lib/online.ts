/**
 * Data layer for the /[state]/online landing page (phase 4d). Focused
 * query that pulls only online + zoom sections for the current term —
 * smaller and faster than loadAllCourses, since most catalogs are 60–80%
 * in-person.
 */

import { supabase } from "@/lib/supabase";
import { loadInstitutions } from "@/lib/institutions";
import { getCurrentTerm } from "@/lib/terms";

// Threshold for the page to render at all. Same discipline as the
// programs page (≥3 colleges, ≥10 online sections each).
export const ONLINE_MIN_COLLEGES = 3;
export const ONLINE_MIN_SECTIONS_PER_COLLEGE = 10;

// Threshold for a row in the per-subject table to render. Keeps thin
// rows (1–2 sections) out.
export const ONLINE_MIN_SECTIONS_PER_SUBJECT = 5;

type OnlineRow = {
  college_code: string;
  course_prefix: string;
  course_number: string;
  course_title: string;
  mode: string;
};

export type OnlineCollegeRow = {
  collegeCode: string;
  collegeId: string;
  collegeName: string;
  sectionCount: number;
  uniqueCourses: number;
  topSubjects: string[];
};

export type OnlineSubjectRow = {
  prefix: string;
  sectionCount: number;
  collegeCount: number;
  uniqueCourses: number;
};

export type OnlineData = {
  totalSections: number;
  totalColleges: number;
  totalUniqueCourses: number;
  colleges: OnlineCollegeRow[];
  subjects: OnlineSubjectRow[];
  term: string;
};

async function loadOnlineSections(
  state: string,
  term: string
): Promise<OnlineRow[]> {
  const { count, error: countErr } = await supabase
    .from("courses")
    .select("id", { count: "exact", head: true })
    .eq("state", state)
    .eq("term", term)
    .in("mode", ["online", "zoom"]);
  if (countErr || !count) return [];

  const PAGE = 1000;
  const pages = Math.ceil(count / PAGE);
  const out: OnlineRow[] = [];
  for (let i = 0; i < pages; i++) {
    const { data, error } = await supabase
      .from("courses")
      .select("college_code, course_prefix, course_number, course_title, mode")
      .eq("state", state)
      .eq("term", term)
      .in("mode", ["online", "zoom"])
      .range(i * PAGE, i * PAGE + PAGE - 1);
    if (error) continue;
    out.push(...(data ?? []));
  }
  return out;
}

export async function loadOnlineData(state: string): Promise<OnlineData | null> {
  const term = await getCurrentTerm(state);
  const rows = await loadOnlineSections(state, term);
  if (rows.length === 0) return null;
  const institutions = loadInstitutions(state);

  const byCollege = new Map<string, OnlineRow[]>();
  for (const r of rows) {
    if (!byCollege.has(r.college_code)) byCollege.set(r.college_code, []);
    byCollege.get(r.college_code)!.push(r);
  }

  const colleges: OnlineCollegeRow[] = [];
  for (const [code, secs] of byCollege) {
    const inst = institutions.find(
      (i) => i.college_slug === code || i.id === code
    );
    if (!inst) continue;

    const uniq = new Set(
      secs.map((s) => `${s.course_prefix} ${s.course_number}`)
    );
    const subjectCounts = new Map<string, number>();
    for (const s of secs) {
      subjectCounts.set(
        s.course_prefix,
        (subjectCounts.get(s.course_prefix) ?? 0) + 1
      );
    }
    const topSubjects = [...subjectCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([p]) => p);

    colleges.push({
      collegeCode: code,
      collegeId: inst.id,
      collegeName: inst.name,
      sectionCount: secs.length,
      uniqueCourses: uniq.size,
      topSubjects,
    });
  }
  colleges.sort(
    (a, b) =>
      b.sectionCount - a.sectionCount ||
      a.collegeName.localeCompare(b.collegeName)
  );

  const subjectMap = new Map<
    string,
    { sections: number; colleges: Set<string>; courses: Set<string> }
  >();
  for (const r of rows) {
    const entry = subjectMap.get(r.course_prefix) ?? {
      sections: 0,
      colleges: new Set<string>(),
      courses: new Set<string>(),
    };
    entry.sections += 1;
    entry.colleges.add(r.college_code);
    entry.courses.add(`${r.course_prefix} ${r.course_number}`);
    subjectMap.set(r.course_prefix, entry);
  }
  const subjects: OnlineSubjectRow[] = [...subjectMap.entries()]
    .filter(([, v]) => v.sections >= ONLINE_MIN_SECTIONS_PER_SUBJECT)
    .map(([prefix, v]) => ({
      prefix,
      sectionCount: v.sections,
      collegeCount: v.colleges.size,
      uniqueCourses: v.courses.size,
    }))
    .sort((a, b) => b.sectionCount - a.sectionCount);

  const totalUniqueCourses = new Set(
    rows.map((r) => `${r.course_prefix} ${r.course_number}`)
  ).size;

  return {
    totalSections: rows.length,
    totalColleges: colleges.length,
    totalUniqueCourses,
    colleges,
    subjects,
    term,
  };
}

export function onlineQualifies(data: OnlineData | null): boolean {
  if (!data) return false;
  const eligible = data.colleges.filter(
    (c) => c.sectionCount >= ONLINE_MIN_SECTIONS_PER_COLLEGE
  );
  return eligible.length >= ONLINE_MIN_COLLEGES;
}

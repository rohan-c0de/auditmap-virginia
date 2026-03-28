"use client";

import { useState, useMemo } from "react";
import type { CourseSection, CourseMode } from "@/lib/types";

interface CourseTableProps {
  courses: CourseSection[];
  vccsSlug: string;
  onAuditClick?: (course: CourseSection) => void;
  pinnedCRNs?: Set<string>;
  onTogglePin?: (crn: string) => void;
}

/** Build a courses.vccs.edu URL for a specific course section */
function buildCourseUrl(vccsSlug: string, course: CourseSection): string {
  // courses.vccs.edu uses: /colleges/{slug}/courses/{PREFIX}{NUMBER}-{TitleNoSpaces}
  // e.g. /colleges/nova/courses/ENG111-CollegeCompositionI
  const titleSlug = course.course_title.replace(/[^a-zA-Z0-9]/g, "");
  return `https://courses.vccs.edu/colleges/${vccsSlug}/courses/${course.course_prefix}${course.course_number}-${titleSlug}`;
}

const MODE_STYLES: Record<CourseMode, { bg: string; text: string; label: string }> = {
  "in-person": { bg: "bg-emerald-50", text: "text-emerald-700", label: "In-Person" },
  online: { bg: "bg-blue-50", text: "text-blue-700", label: "Online" },
  hybrid: { bg: "bg-purple-50", text: "text-purple-700", label: "Hybrid" },
  zoom: { bg: "bg-orange-50", text: "text-orange-700", label: "Zoom" },
};

function getUniqueSubjects(courses: CourseSection[]): string[] {
  const subjects = new Set(courses.map((c) => c.course_prefix));
  return Array.from(subjects).sort();
}

function getUniqueModes(courses: CourseSection[]): CourseMode[] {
  const modes = new Set(courses.map((c) => c.mode));
  return Array.from(modes).sort() as CourseMode[];
}

function isValidTime(t: string): boolean {
  return !!t && t !== "TBA" && t !== "0:00 AM" && t !== "0:00 PM";
}

function formatSchedule(course: CourseSection): string {
  const hasTime = isValidTime(course.start_time) && isValidTime(course.end_time);
  if (!course.days && !hasTime) {
    return "Asynchronous / Online";
  }
  const days = course.days || "";
  const time = hasTime ? `${course.start_time}\u2013${course.end_time}` : "";
  if (days && time) return `${days} ${time}`;
  if (days) return days;
  if (time) return time;
  return "Asynchronous / Online";
}

// Day filter options matching the actual data format (M, Tu, W, Th, F, Sa)
const DAY_OPTIONS = [
  { value: "M", label: "Monday" },
  { value: "Tu", label: "Tuesday" },
  { value: "W", label: "Wednesday" },
  { value: "Th", label: "Thursday" },
  { value: "F", label: "Friday" },
  { value: "Sa", label: "Saturday" },
] as const;

/** Check if a course meets on a given day, using word-boundary matching */
function courseMatchesDay(courseDays: string, filterDay: string): boolean {
  if (!courseDays) return false;
  // Split on spaces and match exactly to avoid "Th" matching "Tu Th" for "T"
  const parts = courseDays.split(" ");
  return parts.includes(filterDay);
}

export default function CourseTable({ courses, vccsSlug, onAuditClick, pinnedCRNs, onTogglePin }: CourseTableProps) {
  const [subjectFilter, setSubjectFilter] = useState("");
  const [dayFilter, setDayFilter] = useState("");
  const [modeFilter, setModeFilter] = useState("");

  const subjects = useMemo(() => getUniqueSubjects(courses), [courses]);
  const modes = useMemo(() => getUniqueModes(courses), [courses]);

  const filtered = useMemo(() => {
    return courses.filter((c) => {
      if (subjectFilter && c.course_prefix !== subjectFilter) return false;
      if (dayFilter && !courseMatchesDay(c.days, dayFilter)) return false;
      if (modeFilter && c.mode !== modeFilter) return false;
      return true;
    });
  }, [courses, subjectFilter, dayFilter, modeFilter]);

  const activeFilters = [subjectFilter, dayFilter, modeFilter].filter(Boolean).length;

  return (
    <div>
      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
        <div className="min-w-[140px]">
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Subject
          </label>
          <select
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-200"
          >
            <option value="">All Subjects</option>
            {subjects.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-[120px]">
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Day
          </label>
          <select
            value={dayFilter}
            onChange={(e) => setDayFilter(e.target.value)}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-200"
          >
            <option value="">Any Day</option>
            {DAY_OPTIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-[130px]">
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Mode
          </label>
          <select
            value={modeFilter}
            onChange={(e) => setModeFilter(e.target.value)}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-200"
          >
            <option value="">All Modes</option>
            {modes.map((m) => (
              <option key={m} value={m}>
                {MODE_STYLES[m].label}
              </option>
            ))}
          </select>
        </div>

        {activeFilters > 0 && (
          <button
            type="button"
            onClick={() => {
              setSubjectFilter("");
              setDayFilter("");
              setModeFilter("");
            }}
            className="rounded-md px-3 py-2 text-sm font-medium text-teal-600 hover:bg-teal-50"
          >
            Clear filters
          </button>
        )}

        <span className="ml-auto text-sm text-gray-500">
          {filtered.length} {filtered.length === 1 ? "section" : "sections"}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center">
          <p className="text-gray-500">No courses match your filters.</p>
          <button
            type="button"
            onClick={() => {
              setSubjectFilter("");
              setDayFilter("");
              setModeFilter("");
            }}
            className="mt-2 text-sm font-medium text-teal-600 hover:underline"
          >
            Reset all filters
          </button>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-lg border border-gray-200 md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-medium">CRN</th>
                  <th className="px-4 py-3 font-medium">Course</th>
                  <th className="px-4 py-3 font-medium">Title</th>
                  <th className="px-4 py-3 font-medium">Schedule</th>
                  <th className="px-4 py-3 font-medium">Campus</th>
                  <th className="px-4 py-3 font-medium">Mode</th>
                  <th className="px-4 py-3 font-medium w-32" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((course) => {
                  const style = MODE_STYLES[course.mode];
                  return (
                    <tr
                      key={course.crn}
                      className="transition hover:bg-gray-50"
                    >
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-600">
                        {course.crn}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-900">
                        {course.course_prefix} {course.course_number}
                      </td>
                      <td className="px-4 py-3 text-gray-700 max-w-[300px]">
                        <div>{course.course_title}</div>
                        {course.prerequisite_text && (
                          <div className="mt-1">
                            <span
                              className="inline-flex items-center gap-0.5 rounded bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
                            >
                              <svg className="h-2.5 w-2.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                              </svg>
                              Requires: {course.prerequisite_text}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                        {formatSchedule(course)}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {course.campus || "---"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${style.bg} ${style.text}`}
                        >
                          {style.label}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right space-x-2">
                        {onTogglePin && (
                          <button
                            type="button"
                            onClick={() => onTogglePin(course.crn)}
                            className={`inline-flex items-center justify-center w-7 h-7 rounded-md border transition ${
                              pinnedCRNs?.has(course.crn)
                                ? "bg-teal-100 border-teal-300 text-teal-700"
                                : "bg-white border-gray-300 text-gray-400 hover:text-teal-600 hover:border-teal-300"
                            }`}
                            title={pinnedCRNs?.has(course.crn) ? "Remove from schedule" : "Add to schedule"}
                          >
                            <svg className="h-3.5 w-3.5" fill={pinnedCRNs?.has(course.crn) ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                            </svg>
                          </button>
                        )}
                        {onAuditClick && (
                          <button
                            type="button"
                            onClick={() => onAuditClick(course)}
                            className="text-xs font-medium text-teal-600 hover:text-teal-800 hover:underline"
                          >
                            How to Audit
                          </button>
                        )}
                        <a
                          href={buildCourseUrl(vccsSlug, course)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-medium text-gray-500 hover:text-gray-700 hover:underline"
                        >
                          View on VCCS &rarr;
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="flex flex-col gap-3 md:hidden">
            {filtered.map((course) => {
              const style = MODE_STYLES[course.mode];
              return (
                <div
                  key={course.crn}
                  className="rounded-lg border border-gray-200 bg-white p-4"
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-gray-900">
                        {course.course_prefix} {course.course_number}
                      </p>
                      <p className="text-sm text-gray-600">
                        {course.course_title}
                      </p>
                      {course.prerequisite_text && (
                        <p className="mt-1 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 inline-block">
                          Requires: {course.prerequisite_text}
                        </p>
                      )}
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${style.bg} ${style.text}`}
                    >
                      {style.label}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-y-1 text-xs text-gray-500">
                    <span>CRN: <span className="font-mono text-gray-700">{course.crn}</span></span>
                    <span>Campus: <span className="text-gray-700">{course.campus || "---"}</span></span>
                    <span className="col-span-2">
                      Schedule: <span className="text-gray-700">{formatSchedule(course)}</span>
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-center gap-4 border-t border-gray-100 pt-3">
                    {onTogglePin && (
                      <button
                        type="button"
                        onClick={() => onTogglePin(course.crn)}
                        className={`text-xs font-medium ${pinnedCRNs?.has(course.crn) ? "text-teal-700" : "text-gray-400 hover:text-teal-600"}`}
                      >
                        {pinnedCRNs?.has(course.crn) ? "Pinned" : "Pin to schedule"}
                      </button>
                    )}
                    {onAuditClick && (
                      <button
                        type="button"
                        onClick={() => onAuditClick(course)}
                        className="text-xs font-medium text-teal-600 hover:text-teal-800 hover:underline"
                      >
                        How to Audit
                      </button>
                    )}
                    <a
                      href={buildCourseUrl(vccsSlug, course)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-gray-500 hover:text-gray-700 hover:underline"
                    >
                      View on VCCS &rarr;
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

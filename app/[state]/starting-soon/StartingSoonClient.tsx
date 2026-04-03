"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import type { CourseMode } from "@/lib/types";
import { expandDays } from "@/lib/time-utils";

// ---------------------------------------------------------------------------
// Types matching the API response
// ---------------------------------------------------------------------------

interface SectionResult {
  college_code: string;
  crn: string;
  course_prefix: string;
  course_number: string;
  course_title: string;
  credits: number;
  days: string;
  start_time: string;
  end_time: string;
  start_date: string;
  campus: string;
  mode: CourseMode;
  instructor: string | null;
}

interface CollegeGroup {
  slug: string;
  name: string;
  auditAllowed: boolean | null;
  distance: number | null;
  sections: SectionResult[];
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

interface ApiResponse {
  dateGroups: DateGroup[];
  meta: {
    totalSections: number;
    totalCourses: number;
    totalColleges: number;
    window: number;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODE_STYLES: Record<
  CourseMode,
  { bg: string; text: string; label: string }
> = {
  "in-person": {
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    label: "In-Person",
  },
  online: { bg: "bg-blue-50", text: "text-blue-700", label: "Online" },
  hybrid: { bg: "bg-purple-50", text: "text-purple-700", label: "Hybrid" },
  zoom: { bg: "bg-orange-50", text: "text-orange-700", label: "Zoom" },
};

const WINDOW_OPTIONS = [
  { value: 7, label: "Next 7 days" },
  { value: 14, label: "Next 2 weeks" },
  { value: 28, label: "Next month" },
  { value: 60, label: "Next 2 months" },
];

function isValidTime(t: string): boolean {
  return !!t && t !== "TBA" && t !== "0:00 AM" && t !== "0:00 PM";
}

function formatSchedule(s: SectionResult): string {
  const hasTime = isValidTime(s.start_time) && isValidTime(s.end_time);
  if (!s.days && !hasTime) return "Asynchronous / Online";
  const days = s.days ? expandDays(s.days) : "";
  const time = hasTime
    ? `${s.start_time}\u2013${s.end_time}`
    : "";
  if (days && time) return `${days} ${time}`;
  if (days) return days;
  if (time) return time;
  return "Asynchronous / Online";
}

function daysAwayLabel(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function StartingSoonClient({ state, defaultZip = "22030" }: { state: string; defaultZip?: string }) {
  const [window, setWindow] = useState(60);
  const [subject, setSubject] = useState("");
  const [mode, setMode] = useState("");
  const [zip, setZip] = useState("");
  const [zipInput, setZipInput] = useState("");
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedColleges, setExpandedColleges] = useState<Set<string>>(
    new Set()
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ window: String(window) });
      if (subject) params.set("subject", subject);
      if (mode) params.set("mode", mode);
      if (zip) params.set("zip", zip);

      const res = await fetch(`/api/${state}/courses/starting-soon?${params}`);
      if (!res.ok) throw new Error("Failed to load courses");
      const json: ApiResponse = await res.json();
      setData(json);
      setExpandedColleges(new Set());
    } catch {
      setError("Failed to load courses. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [window, subject, mode, zip]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Collect unique subjects from results for filter dropdown
  const allSubjects = data
    ? Array.from(
        new Set(
          data.dateGroups.flatMap((dg) => dg.courses.map((c) => c.prefix))
        )
      ).sort()
    : [];

  function toggleCollege(key: string) {
    setExpandedColleges((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div>
      {/* Filter bar */}
      <div className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
        <div className="min-w-[150px]">
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Time Window
          </label>
          <select
            value={window}
            onChange={(e) => setWindow(Number(e.target.value))}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-200"
          >
            {WINDOW_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-[130px]">
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Subject
          </label>
          <select
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-200"
          >
            <option value="">All Subjects</option>
            {allSubjects.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-[130px]">
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Mode
          </label>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-200"
          >
            <option value="">All Modes</option>
            <option value="in-person">In-Person</option>
            <option value="online">Online</option>
            <option value="hybrid">Hybrid</option>
            <option value="zoom">Zoom</option>
          </select>
        </div>

        <div className="min-w-[120px]">
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Near Zip Code
          </label>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setZip(zipInput);
            }}
            className="flex gap-1"
          >
            <input
              type="text"
              value={zipInput}
              onChange={(e) => setZipInput(e.target.value)}
              placeholder={`e.g. ${defaultZip}`}
              maxLength={5}
              className="w-24 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-200"
            />
            <button
              type="submit"
              className="rounded-md bg-teal-600 px-2 py-2 text-xs font-medium text-white hover:bg-teal-700"
            >
              Go
            </button>
          </form>
        </div>

        {data && !loading && (
          <span className="ml-auto text-sm text-gray-500">
            {data.meta.totalSections} sections across{" "}
            {data.meta.totalColleges} colleges
          </span>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-teal-500" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && data && data.dateGroups.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center">
          <p className="text-gray-500 mb-2">
            No courses starting in the next {window} days.
          </p>
          <p className="text-sm text-gray-400">
            Try expanding the time window or clearing filters.
          </p>
        </div>
      )}

      {/* Results grouped by date */}
      {!loading &&
        !error &&
        data &&
        data.dateGroups.map((dateGroup) => (
          <div key={dateGroup.date} className="mb-8">
            {/* Date header */}
            <div className="flex items-center gap-3 mb-4">
              <div className="h-px flex-1 bg-gray-200" />
              <h2 className="text-sm font-semibold text-gray-700 whitespace-nowrap">
                {dateGroup.label}{" "}
                <span className="font-normal text-gray-400">
                  ({daysAwayLabel(dateGroup.daysAway)})
                </span>
              </h2>
              <div className="h-px flex-1 bg-gray-200" />
            </div>

            {/* Course cards */}
            <div className="space-y-3">
              {dateGroup.courses.map((course) => (
                <div
                  key={`${course.prefix}-${course.number}`}
                  className="rounded-lg border border-gray-200 bg-white overflow-hidden"
                >
                  {/* Course header */}
                  <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <span className="font-semibold text-gray-900">
                          {course.prefix} {course.number}
                        </span>
                        <span className="text-gray-500 mx-2">&middot;</span>
                        <span className="text-gray-700">
                          {course.title}
                        </span>
                        <span className="text-gray-500 mx-2">&middot;</span>
                        <span className="text-gray-500 text-sm">
                          {course.credits} cr
                        </span>
                      </div>
                      <span className="text-xs text-gray-400 whitespace-nowrap">
                        {course.totalSections}{" "}
                        {course.totalSections === 1 ? "section" : "sections"} at{" "}
                        {course.colleges.length}{" "}
                        {course.colleges.length === 1 ? "college" : "colleges"}
                      </span>
                    </div>
                  </div>

                  {/* College rows */}
                  <div className="divide-y divide-gray-100">
                    {course.colleges.map((college) => {
                      const colKey = `${dateGroup.date}-${course.prefix}${course.number}-${college.slug}`;
                      const isExpanded = expandedColleges.has(colKey);

                      return (
                        <div key={college.slug}>
                          {/* College row */}
                          <button
                            type="button"
                            onClick={() => toggleCollege(colKey)}
                            className="w-full px-4 py-2.5 flex items-center justify-between gap-2 text-left hover:bg-gray-50 transition"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <svg
                                className={`h-3 w-3 text-gray-400 shrink-0 transition-transform ${
                                  isExpanded ? "rotate-90" : ""
                                }`}
                                fill="currentColor"
                                viewBox="0 0 20 20"
                              >
                                <path
                                  fillRule="evenodd"
                                  d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                                  clipRule="evenodd"
                                />
                              </svg>
                              <Link
                                href={`/${state}/college/${college.slug}`}
                                onClick={(e) => e.stopPropagation()}
                                className="font-medium text-sm text-gray-900 hover:text-teal-700 truncate"
                              >
                                {college.name}
                              </Link>
                              {college.distance !== null && (
                                <span className="text-xs text-gray-400 shrink-0">
                                  {college.distance} mi
                                </span>
                              )}
                              <span className="text-xs text-gray-400">
                                &mdash; {college.sections.length}{" "}
                                {college.sections.length === 1
                                  ? "section"
                                  : "sections"}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {college.auditAllowed === true && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                                  <span className="h-1 w-1 rounded-full bg-emerald-500" />
                                  Audit OK
                                </span>
                              )}
                              {college.auditAllowed === null && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
                                  Unverified
                                </span>
                              )}
                            </div>
                          </button>

                          {/* Expanded sections */}
                          {isExpanded && (
                            <div className="px-4 pb-3 pl-9">
                              <div className="rounded border border-gray-100 overflow-hidden">
                                <table className="w-full text-xs">
                                  <thead className="bg-gray-50 text-gray-500">
                                    <tr>
                                      <th className="px-3 py-1.5 text-left font-medium">
                                        CRN
                                      </th>
                                      <th className="px-3 py-1.5 text-left font-medium">
                                        Schedule
                                      </th>
                                      <th className="px-3 py-1.5 text-left font-medium">
                                        Campus
                                      </th>
                                      <th className="px-3 py-1.5 text-left font-medium">
                                        Mode
                                      </th>
                                      <th className="px-3 py-1.5 text-left font-medium">
                                        Instructor
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-50">
                                    {college.sections.map((s) => {
                                      const mStyle = MODE_STYLES[s.mode];
                                      return (
                                        <tr key={`${s.crn}-${s.course_prefix}${s.course_number}-${s.start_time}`}>
                                          <td className="px-3 py-1.5 font-mono text-gray-600">
                                            {s.crn}
                                          </td>
                                          <td className="px-3 py-1.5 text-gray-700">
                                            {formatSchedule(s)}
                                          </td>
                                          <td className="px-3 py-1.5 text-gray-600">
                                            {s.campus || "---"}
                                          </td>
                                          <td className="px-3 py-1.5">
                                            <span
                                              className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${mStyle.bg} ${mStyle.text}`}
                                            >
                                              {mStyle.label}
                                            </span>
                                          </td>
                                          <td className="px-3 py-1.5 text-gray-600">
                                            {s.instructor || "---"}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}

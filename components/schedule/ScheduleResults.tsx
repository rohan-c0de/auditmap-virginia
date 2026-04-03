"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { GeneratedSchedule, ScheduleResponse, ScheduleSection } from "@/lib/types";
import WeeklyCalendar from "./WeeklyCalendar";
import ScoreBar from "./ScoreBar";
import { isValidTime, expandDays } from "@/lib/time-utils";

interface Props {
  response: ScheduleResponse;
  state: string;
}

const MODE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  "in-person": { bg: "bg-emerald-50", text: "text-emerald-700", label: "In-Person" },
  online: { bg: "bg-blue-50", text: "text-blue-700", label: "Online" },
  hybrid: { bg: "bg-purple-50", text: "text-purple-700", label: "Hybrid" },
  zoom: { bg: "bg-orange-50", text: "text-orange-700", label: "Zoom" },
};

function formatSchedule(days: string, startTime: string, endTime: string): string {
  const hasTime = isValidTime(startTime) && isValidTime(endTime);
  if (!days && !hasTime) return "Async / Online";
  const d = days ? expandDays(days) : "";
  const time = hasTime ? `${startTime}\u2013${endTime}` : "";
  if (d && time) return `${d} ${time}`;
  return d || time || "Async / Online";
}

function scoreColor(score: number): string {
  if (score >= 80) return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (score >= 60) return "bg-amber-100 text-amber-800 border-amber-200";
  return "bg-red-100 text-red-800 border-red-200";
}

// ---------------------------------------------------------------------------
// Schedule grouping — collapse visually identical schedules that only
// differ by which college offers the course(s).
// ---------------------------------------------------------------------------

interface CollegeOption {
  collegeName: string;
  college_code: string;
  distance: number | null;
}

interface ScheduleGroup {
  representative: GeneratedSchedule;
  collegeOptions: Map<string, CollegeOption[]>;
  count: number;
}

function patternKey(schedule: GeneratedSchedule): string {
  return schedule.sections
    .map(
      (s) =>
        `${s.course_prefix}-${s.course_number}:${s.mode}:${s.days || "ASYNC"}:${s.start_time}:${s.end_time}`
    )
    .sort()
    .join("|");
}

function groupSchedules(schedules: GeneratedSchedule[]): ScheduleGroup[] {
  const map = new Map<string, GeneratedSchedule[]>();

  for (const s of schedules) {
    const key = patternKey(s);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(s);
  }

  const groups: ScheduleGroup[] = [];

  for (const variants of map.values()) {
    variants.sort((a, b) => b.score - a.score);
    const representative = variants[0];

    const collegeOptions = new Map<string, CollegeOption[]>();
    for (const variant of variants) {
      for (const sec of variant.sections) {
        const courseLabel = `${sec.course_prefix} ${sec.course_number}`;
        if (!collegeOptions.has(courseLabel)) collegeOptions.set(courseLabel, []);
        const list = collegeOptions.get(courseLabel)!;
        if (!list.some((c) => c.college_code === sec.college_code)) {
          list.push({
            collegeName: sec.collegeName,
            college_code: sec.college_code,
            distance: sec.distance,
          });
        }
      }
    }

    groups.push({ representative, collegeOptions, count: variants.length });
  }

  groups.sort((a, b) => b.representative.score - a.representative.score);
  return groups;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ScheduleResults({ response, state }: Props) {
  const { schedules, meta } = response;
  const groups = useMemo(() => groupSchedules(schedules), [schedules]);

  const [expandedId, setExpandedId] = useState<string | null>(
    groups.length > 0 ? groups[0].representative.id : null
  );
  const [displayLimit, setDisplayLimit] = useState(10);

  const displayed = groups.slice(0, displayLimit);
  const wasGrouped = groups.length < schedules.length;

  if (meta.message && schedules.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center">
        <svg className="mx-auto h-8 w-8 text-gray-300 mb-3" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
        </svg>
        <p className="text-gray-500 font-medium">{meta.message}</p>
        <p className="mt-1 text-sm text-gray-400">
          Try adjusting your constraints and search again.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Summary bar */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <p className="text-sm text-gray-700">
          Found{" "}
          <span className="font-semibold text-gray-900">{schedules.length}</span>{" "}
          conflict-free {schedules.length === 1 ? "schedule" : "schedules"}
          {wasGrouped && (
            <span className="text-gray-500">
              {" "}grouped into{" "}
              <span className="font-semibold text-gray-900">{groups.length}</span>{" "}
              unique {groups.length === 1 ? "pattern" : "patterns"}
            </span>
          )}
          {" "}from{" "}
          <span className="font-semibold text-gray-900">{meta.candidateSections}</span>{" "}
          sections of{" "}
          <span className="font-semibold text-gray-900">{meta.candidateCourses}</span>{" "}
          courses
        </p>
        <span className="text-xs text-gray-400">
          ({meta.timeTakenMs}ms)
        </span>
      </div>

      {meta.message && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          {meta.message}
        </div>
      )}

      {/* Schedule cards */}
      <div className="space-y-4">
        {displayed.map((group, idx) => (
          <ScheduleCard
            key={group.representative.id}
            group={group}
            rank={idx + 1}
            isExpanded={expandedId === group.representative.id}
            onToggle={() =>
              setExpandedId(
                expandedId === group.representative.id
                  ? null
                  : group.representative.id
              )
            }
            state={state}
          />
        ))}
      </div>

      {/* Load more */}
      {displayLimit < groups.length && (
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => setDisplayLimit((prev) => prev + 10)}
            className="rounded-lg border border-gray-300 bg-white px-6 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
          >
            Show more ({groups.length - displayLimit} remaining)
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Individual schedule card
// ---------------------------------------------------------------------------

function ScheduleCard({
  group,
  rank,
  isExpanded,
  onToggle,
  state,
}: {
  group: ScheduleGroup;
  rank: number;
  isExpanded: boolean;
  onToggle: () => void;
  state: string;
}) {
  const { representative, collegeOptions, count } = group;
  const { sections, score, scoreBreakdown } = representative;

  // Total unique colleges across all courses in this group
  const allCollegeCodes = new Set<string>();
  for (const opts of collegeOptions.values()) {
    for (const o of opts) allCollegeCodes.add(o.college_code);
  }
  const totalColleges = allCollegeCodes.size;

  // For single-variant groups, show colleges the old way
  const colleges = new Map<string, ScheduleSection[]>();
  for (const s of sections) {
    if (!colleges.has(s.college_code)) colleges.set(s.college_code, []);
    colleges.get(s.college_code)!.push(s);
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      {/* Header (always visible) */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-5 py-4 flex items-start gap-4 text-left hover:bg-gray-50/50 transition"
      >
        {/* Rank */}
        <div className="shrink-0 flex items-center justify-center h-8 w-8 rounded-full bg-gray-100 text-sm font-bold text-gray-500">
          {rank}
        </div>

        {/* Course pills */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap gap-2 mb-2">
            {sections.map((s) => {
              const modeStyle = MODE_STYLES[s.mode] || MODE_STYLES["in-person"];
              return (
                <div
                  key={`${s.crn}-${s.course_prefix}${s.course_number}`}
                  className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs"
                >
                  <span className="font-semibold text-gray-900">
                    {s.course_prefix} {s.course_number}
                  </span>
                  <span className="text-gray-500 ml-1.5">
                    {formatSchedule(s.days, s.start_time, s.end_time)}
                  </span>
                  <span className={`ml-1.5 inline-block rounded-full px-1.5 py-0 text-[10px] font-medium ${modeStyle.bg} ${modeStyle.text}`}>
                    {modeStyle.label}
                  </span>
                  {s.distance !== null && (
                    <span className="ml-1 text-gray-400">{s.distance} mi</span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
            {count > 1 ? (
              <span className="text-teal-600 font-medium">
                Available at {totalColleges} {totalColleges === 1 ? "college" : "colleges"}
              </span>
            ) : (
              Array.from(colleges.entries()).map(([slug, secs]) => (
                <span key={slug}>
                  {secs[0].collegeName}
                  {secs.length > 1 && ` (${secs.length})`}
                </span>
              ))
            )}
          </div>
        </div>

        {/* Score badge */}
        <div className="shrink-0 flex flex-col items-center gap-1">
          <span
            className={`inline-flex items-center rounded-lg border px-2.5 py-1 text-sm font-bold ${scoreColor(score)}`}
          >
            {score}
          </span>
          <span className="text-[10px] text-gray-400">/ 100</span>
        </div>

        {/* Chevron */}
        <svg
          className={`shrink-0 h-5 w-5 text-gray-400 transition-transform mt-1.5 ${isExpanded ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-gray-100 px-5 py-4 space-y-4">
          {/* Score breakdown */}
          <ScoreBar breakdown={scoreBreakdown} total={score} />

          {/* Weekly calendar */}
          <WeeklyCalendar sections={sections} />

          {/* Section details with college alternatives */}
          <div className="rounded-lg border border-gray-100 overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Course</th>
                  <th className="px-3 py-2 font-medium">Schedule</th>
                  <th className="px-3 py-2 font-medium">
                    {count > 1 ? "Available Colleges" : "College"}
                  </th>
                  <th className="px-3 py-2 font-medium">Mode</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {sections.map((s) => {
                  const modeStyle = MODE_STYLES[s.mode] || MODE_STYLES["in-person"];
                  const courseLabel = `${s.course_prefix} ${s.course_number}`;
                  const options = collegeOptions.get(courseLabel) || [];

                  return (
                    <tr key={`${s.crn}-${s.course_prefix}${s.course_number}`} className="hover:bg-gray-50 align-top">
                      <td className="px-3 py-2">
                        <span className="font-semibold text-gray-900">
                          {s.course_prefix} {s.course_number}
                        </span>
                        <span className="block text-[10px] text-gray-500 truncate max-w-[200px]">
                          {s.course_title}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-700">
                        {formatSchedule(s.days, s.start_time, s.end_time)}
                      </td>
                      <td className="px-3 py-2 text-gray-600">
                        {options.length <= 1 ? (
                          <>
                            <Link
                              href={`/${state}/college/${s.college_code}`}
                              className="text-teal-600 hover:underline"
                            >
                              {s.collegeName}
                            </Link>
                            {s.distance !== null && (
                              <span className="block text-[10px] text-gray-400">
                                {s.distance} mi away
                              </span>
                            )}
                          </>
                        ) : (
                          <CollegeOptionsList options={options} state={state} />
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${modeStyle.bg} ${modeStyle.text}`}
                        >
                          {modeStyle.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Prerequisite warnings */}
          {sections.some((s) => s.prerequisite_text) && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-xs font-medium text-amber-800 mb-1">Prerequisite Notice</p>
              {sections
                .filter((s) => s.prerequisite_text)
                .map((s) => (
                  <p key={`${s.crn}-${s.course_prefix}${s.course_number}-prereq`} className="text-xs text-amber-700">
                    <span className="font-medium">
                      {s.course_prefix} {s.course_number}
                    </span>
                    {" "}requires: {s.prerequisite_text}
                  </p>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// College options list (shown when multiple colleges offer the same course)
// ---------------------------------------------------------------------------

const INITIAL_SHOW = 4;

function CollegeOptionsList({ options, state }: { options: CollegeOption[]; state: string }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? options : options.slice(0, INITIAL_SHOW);
  const remaining = options.length - INITIAL_SHOW;

  return (
    <div className="space-y-0.5">
      {visible.map((o) => (
        <div key={o.college_code} className="leading-tight">
          <Link
            href={`/${state}/college/${o.college_code}`}
            className="text-teal-600 hover:underline"
          >
            {o.collegeName}
          </Link>
          {o.distance !== null && (
            <span className="text-[10px] text-gray-400 ml-1">
              {o.distance} mi
            </span>
          )}
        </div>
      ))}
      {remaining > 0 && !showAll && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setShowAll(true);
          }}
          className="text-[10px] text-teal-600 hover:underline font-medium"
        >
          +{remaining} more {remaining === 1 ? "college" : "colleges"}
        </button>
      )}
    </div>
  );
}

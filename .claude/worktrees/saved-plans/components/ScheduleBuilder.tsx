"use client";

import { useState } from "react";
import type { CourseSection } from "@/lib/types";
import { expandDays } from "@/lib/time-utils";

interface Props {
  courses: CourseSection[];
  pinnedCRNs: Set<string>;
  onTogglePin: (crn: string) => void;
}

// Time grid: 8 AM to 9 PM in 30-min slots
const START_HOUR = 8;
const END_HOUR = 21;
const SLOT_COUNT = (END_HOUR - START_HOUR) * 2; // 26 slots

const DAY_COLS = [
  { key: "M", label: "Mon" },
  { key: "Tu", label: "Tue" },
  { key: "W", label: "Wed" },
  { key: "Th", label: "Thu" },
  { key: "F", label: "Fri" },
  { key: "Sa", label: "Sat" },
];

const COLORS = [
  { bg: "bg-teal-100", border: "border-teal-300", text: "text-teal-900" },
  { bg: "bg-blue-100", border: "border-blue-300", text: "text-blue-900" },
  { bg: "bg-amber-100", border: "border-amber-300", text: "text-amber-900" },
  { bg: "bg-purple-100", border: "border-purple-300", text: "text-purple-900" },
  { bg: "bg-rose-100", border: "border-rose-300", text: "text-rose-900" },
  { bg: "bg-emerald-100", border: "border-emerald-300", text: "text-emerald-900" },
  { bg: "bg-orange-100", border: "border-orange-300", text: "text-orange-900" },
  { bg: "bg-indigo-100", border: "border-indigo-300", text: "text-indigo-900" },
];

function parseTime(timeStr: string): number | null {
  if (!timeStr || timeStr === "TBA") return null;
  // Parse "12:30 PM" or "9:30 AM" format
  const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3].toUpperCase();
  if (period === "PM" && hours !== 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;
  return hours + minutes / 60;
}

function timeToSlot(time: number): number {
  return Math.round((time - START_HOUR) * 2);
}

function formatHour(hour: number): string {
  if (hour === 0 || hour === 12) return "12";
  return String(hour > 12 ? hour - 12 : hour);
}

export default function ScheduleBuilder({ courses, pinnedCRNs, onTogglePin }: Props) {
  const [isOpen, setIsOpen] = useState(false);

  const pinnedCourses = courses.filter((c) => pinnedCRNs.has(c.crn));

  // Build color map for pinned courses
  const colorMap = new Map<string, (typeof COLORS)[number]>();
  pinnedCourses.forEach((c, i) => {
    colorMap.set(c.crn, COLORS[i % COLORS.length]);
  });

  // Check for time conflicts
  const conflicts = new Set<string>();
  for (let i = 0; i < pinnedCourses.length; i++) {
    for (let j = i + 1; j < pinnedCourses.length; j++) {
      const a = pinnedCourses[i];
      const b = pinnedCourses[j];
      const aStart = parseTime(a.start_time);
      const aEnd = parseTime(a.end_time);
      const bStart = parseTime(b.start_time);
      const bEnd = parseTime(b.end_time);
      if (aStart === null || aEnd === null || bStart === null || bEnd === null)
        continue;

      // Check if they share any days
      const aDays = expandDays(a.days).split(" ");
      const bDays = expandDays(b.days).split(" ");
      const sharedDays = aDays.some((d) => bDays.includes(d));
      if (!sharedDays) continue;

      // Check time overlap
      if (aStart < bEnd && bStart < aEnd) {
        conflicts.add(a.crn);
        conflicts.add(b.crn);
      }
    }
  }

  // Calculate total credits
  const totalCredits = pinnedCourses.reduce((sum, c) => sum + c.credits, 0);

  return (
    <div className="mt-8">
      {/* Toggle button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-900/30 px-4 py-3 text-left transition hover:bg-teal-100 dark:hover:bg-teal-900/50"
      >
        <div>
          <h3 className="font-semibold text-teal-900 dark:text-teal-200">Schedule Builder</h3>
          <p className="text-sm text-teal-700 dark:text-teal-400">
            Pin courses to visualize your weekly timetable
            {pinnedCRNs.size > 0 && (
              <span className="ml-2 font-medium">
                · {pinnedCRNs.size} pinned · {totalCredits} credits
              </span>
            )}
          </p>
        </div>
        <svg
          className={`h-5 w-5 text-teal-600 dark:text-teal-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {isOpen && (
        <div className="mt-4 space-y-4">
          {/* Conflict warning */}
          {conflicts.size > 0 && (
            <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 px-4 py-3">
              <p className="text-sm font-medium text-red-800 dark:text-red-300">
                Time conflict detected between {conflicts.size} courses. Check
                the schedule below.
              </p>
            </div>
          )}

          {pinnedCourses.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 dark:border-slate-600 py-8 text-center">
              <p className="text-gray-500 dark:text-slate-400 text-sm">
                No courses pinned yet. Click the pin icon on any course in the
                table above to add it here.
              </p>
            </div>
          ) : (
            <>
              {/* Pinned courses list */}
              <div className="flex flex-wrap gap-2">
                {pinnedCourses.map((course) => {
                  const color = colorMap.get(course.crn)!;
                  const hasConflict = conflicts.has(course.crn);
                  return (
                    <div
                      key={`${course.crn}-${course.course_prefix}${course.course_number}`}
                      className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${color.bg} ${color.border} ${color.text} ${hasConflict ? "ring-2 ring-red-400" : ""}`}
                    >
                      <span>
                        {course.course_prefix} {course.course_number}
                      </span>
                      <span className="text-[10px] opacity-60">
                        {course.days ? expandDays(course.days) : "Online"}{" "}
                        {course.start_time && course.start_time !== "TBA"
                          ? course.start_time
                          : ""}
                      </span>
                      {hasConflict && (
                        <span className="text-red-600" title="Time conflict">
                          !
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => onTogglePin(course.crn)}
                        className="ml-0.5 opacity-50 hover:opacity-100"
                        title="Remove"
                      >
                        &times;
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Weekly grid */}
              <div className="overflow-x-auto">
                <div
                  className="min-w-[600px] grid border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden"
                  style={{
                    gridTemplateColumns: "60px repeat(6, 1fr)",
                    gridTemplateRows: `32px repeat(${SLOT_COUNT}, 20px)`,
                  }}
                >
                  {/* Header row */}
                  <div className="bg-gray-50 dark:bg-slate-800 border-b border-r border-gray-200 dark:border-slate-700" />
                  {DAY_COLS.map((day) => (
                    <div
                      key={day.key}
                      className="bg-gray-50 dark:bg-slate-800 border-b border-r border-gray-200 dark:border-slate-700 flex items-center justify-center text-xs font-medium text-gray-600 dark:text-slate-400"
                    >
                      {day.label}
                    </div>
                  ))}

                  {/* Time labels */}
                  {Array.from({ length: SLOT_COUNT }).map((_, i) => {
                    const hour = START_HOUR + Math.floor(i / 2);
                    const isHour = i % 2 === 0;
                    return (
                      <div
                        key={`time-${i}`}
                        className={`border-r border-gray-200 dark:border-slate-700 flex items-start justify-end pr-1.5 text-[10px] text-gray-400 dark:text-slate-500 ${isHour ? "border-t border-gray-100 dark:border-slate-700" : ""}`}
                        style={{ gridColumn: 1, gridRow: i + 2 }}
                      >
                        {isHour && (
                          <span>
                            {formatHour(hour)}
                            {hour < 12 ? "a" : "p"}
                          </span>
                        )}
                      </div>
                    );
                  })}

                  {/* Grid cells */}
                  {DAY_COLS.map((day, colIdx) =>
                    Array.from({ length: SLOT_COUNT }).map((_, rowIdx) => {
                      const isHour = rowIdx % 2 === 0;
                      return (
                        <div
                          key={`${day.key}-${rowIdx}`}
                          className={`border-r border-gray-100 dark:border-slate-700 ${isHour ? "border-t border-gray-100 dark:border-slate-700" : ""}`}
                          style={{
                            gridColumn: colIdx + 2,
                            gridRow: rowIdx + 2,
                          }}
                        />
                      );
                    })
                  )}

                  {/* Course blocks */}
                  {pinnedCourses.map((course) => {
                    const startTime = parseTime(course.start_time);
                    const endTime = parseTime(course.end_time);
                    if (startTime === null || endTime === null) return null;

                    const startSlot = timeToSlot(startTime);
                    const endSlot = timeToSlot(endTime);
                    const span = Math.max(endSlot - startSlot, 1);

                    const days = expandDays(course.days).split(" ");
                    const color = colorMap.get(course.crn)!;
                    const hasConflict = conflicts.has(course.crn);

                    return days.map((dayStr) => {
                      const colIdx = DAY_COLS.findIndex(
                        (d) => d.key === dayStr
                      );
                      if (colIdx === -1) return null;

                      return (
                        <div
                          key={`${course.crn}-${dayStr}`}
                          className={`rounded-sm border mx-0.5 px-1 py-0.5 overflow-hidden ${color.bg} ${color.border} ${color.text} ${hasConflict ? "ring-1 ring-red-400" : ""}`}
                          style={{
                            gridColumn: colIdx + 2,
                            gridRow: `${startSlot + 2} / ${startSlot + 2 + span}`,
                            zIndex: 10,
                          }}
                          title={`${course.course_prefix} ${course.course_number} — ${course.course_title}\n${course.start_time}–${course.end_time}\n${course.campus}`}
                        >
                          <p className="text-[10px] font-semibold leading-tight truncate">
                            {course.course_prefix} {course.course_number}
                          </p>
                          {span > 2 && (
                            <p className="text-[9px] leading-tight opacity-70 truncate">
                              {course.campus}
                            </p>
                          )}
                        </div>
                      );
                    });
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      )}

    </div>
  );
}

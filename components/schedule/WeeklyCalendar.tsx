"use client";

import type { ScheduleSection } from "@/lib/types";
import {
  START_HOUR,
  END_HOUR,
  SLOT_COUNT,
  DAY_COLS,
  parseTime,
  timeToSlot,
  formatHour,
  expandDays,
  COURSE_COLORS,
} from "@/lib/time-utils";

interface Props {
  sections: ScheduleSection[];
}

export default function WeeklyCalendar({ sections }: Props) {
  // Build color map by course key
  const courseKeys: string[] = [];
  const colorMap = new Map<string, (typeof COURSE_COLORS)[number]>();
  for (const s of sections) {
    const key = `${s.course_prefix} ${s.course_number}`;
    if (!colorMap.has(key)) {
      colorMap.set(key, COURSE_COLORS[courseKeys.length % COURSE_COLORS.length]);
      courseKeys.push(key);
    }
  }

  // Filter to only sections with valid times
  const scheduled = sections.filter((s) => {
    const start = parseTime(s.start_time);
    const end = parseTime(s.end_time);
    return start !== null && end !== null;
  });

  const asyncSections = sections.filter((s) => {
    const start = parseTime(s.start_time);
    return start === null;
  });

  return (
    <div>
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
          {scheduled.map((section) => {
            const startTime = parseTime(section.start_time);
            const endTime = parseTime(section.end_time);
            if (startTime === null || endTime === null) return null;

            const startSlot = timeToSlot(startTime);
            const endSlot = timeToSlot(endTime);
            const span = Math.max(endSlot - startSlot, 1);

            const days = section.days ? expandDays(section.days).split(" ") : [];
            const key = `${section.course_prefix} ${section.course_number}`;
            const color = colorMap.get(key)!;

            return days.map((dayStr) => {
              const colIdx = DAY_COLS.findIndex((d) => d.key === dayStr);
              if (colIdx === -1) return null;

              return (
                <div
                  key={`${section.crn}-${dayStr}`}
                  className={`rounded-sm border mx-0.5 px-1 py-0.5 overflow-hidden ${color.bg} ${color.border} ${color.text}`}
                  style={{
                    gridColumn: colIdx + 2,
                    gridRow: `${startSlot + 2} / ${startSlot + 2 + span}`,
                    zIndex: 10,
                  }}
                  title={`${key} — ${section.course_title}\n${section.start_time}–${section.end_time}\n${section.collegeName}`}
                >
                  <p className="text-[10px] font-semibold leading-tight truncate">
                    {key}
                  </p>
                  {span > 2 && (
                    <p className="text-[9px] leading-tight opacity-70 truncate">
                      {section.collegeName}
                    </p>
                  )}
                </div>
              );
            });
          })}
        </div>
      </div>

      {/* Async sections note */}
      {asyncSections.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {asyncSections.map((s) => {
            const key = `${s.course_prefix} ${s.course_number}`;
            const color = colorMap.get(key)!;
            return (
              <span
                key={`${s.crn}-${s.course_prefix}${s.course_number}`}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${color.bg} ${color.border} ${color.text}`}
              >
                {key} — Online/Async
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

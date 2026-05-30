"use client";

import { useState } from "react";
import type { TransferMapping } from "@/lib/types";
import type { CCCourse, UniversityScore } from "./types";
import { getCellInfo } from "./types";

interface Props {
  sortedCourseRows: CCCourse[];
  universityScores: UniversityScore[];
  transferLookup: Map<string, TransferMapping>;
  courseAvailability: Record<string, { colleges: string[]; totalSections: number }>;
  state: string;
}

export default function CompareMobileCards({
  sortedCourseRows,
  universityScores,
  transferLookup,
  courseAvailability,
  state,
}: Props) {
  const [expandedUni, setExpandedUni] = useState<string | null>(
    universityScores[0]?.slug || null
  );

  return (
    <div className="md:hidden space-y-3">
      {universityScores.map((uni, rank) => {
        const isExpanded = expandedUni === uni.slug;
        const isTop = rank === 0 && uni.isBestFit;

        // Group courses by outcome for this university
        const direct: CCCourse[] = [];
        const elective: CCCourse[] = [];
        const noCredit: CCCourse[] = [];
        const unknown: CCCourse[] = [];
        for (const c of sortedCourseRows) {
          const cell = getCellInfo(c, uni.slug, transferLookup);
          if (cell.status === "direct") direct.push(c);
          else if (cell.status === "elective") elective.push(c);
          else if (cell.status === "no-credit") noCredit.push(c);
          else unknown.push(c);
        }

        return (
          <div
            key={uni.slug}
            className={`rounded-lg border transition-all ${
              isTop
                ? "border-teal-300 dark:border-teal-700 bg-teal-50/50 dark:bg-teal-900/20"
                : "border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900"
            }`}
          >
            {/* Card header */}
            <button
              onClick={() => setExpandedUni(isExpanded ? null : uni.slug)}
              className="w-full p-4 text-left"
            >
              <div className="flex items-start justify-between mb-2">
                <h4 className="text-sm font-semibold text-gray-900 dark:text-slate-100 leading-tight pr-2">
                  {isTop && (
                    <span className="text-teal-600 dark:text-teal-400 mr-1">★</span>
                  )}
                  {uni.name}
                </h4>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`text-lg font-bold tabular-nums ${
                      uni.pct >= 80
                        ? "text-teal-600 dark:text-teal-400"
                        : uni.pct >= 50
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-rose-600 dark:text-rose-400"
                    }`}
                  >
                    {uni.pct}%
                  </span>
                  <svg
                    className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                  </svg>
                </div>
              </div>

              {isTop && (
                <p className="text-[10px] font-medium text-teal-600 dark:text-teal-400 mb-1.5">
                  Best fit for your courses
                </p>
              )}

              {/* Score bar */}
              <div className="h-1.5 rounded-full bg-gray-100 dark:bg-slate-800 overflow-hidden flex mb-2">
                {uni.direct > 0 && (
                  <div className="bg-teal-500 h-full" style={{ width: `${(uni.direct / uni.total) * 100}%` }} />
                )}
                {uni.elective > 0 && (
                  <div className="bg-amber-400 h-full" style={{ width: `${(uni.elective / uni.total) * 100}%` }} />
                )}
                {uni.noCredit > 0 && (
                  <div className="bg-rose-400 h-full" style={{ width: `${(uni.noCredit / uni.total) * 100}%` }} />
                )}
              </div>

              <div className="flex flex-wrap gap-x-3 text-xs">
                <span className="text-teal-600 dark:text-teal-400">{uni.direct} direct</span>
                <span className="text-amber-600 dark:text-amber-400">{uni.elective} elective</span>
                {uni.noCredit > 0 && (
                  <span className="text-rose-500 dark:text-rose-400">{uni.noCredit} no credit</span>
                )}
              </div>
            </button>

            {/* Expanded course list */}
            {isExpanded && (
              <div className="border-t border-gray-200 dark:border-slate-700 px-4 pb-4 pt-3 space-y-3">
                {direct.length > 0 && (
                  <CourseGroup
                    title="Direct matches"
                    tone="teal"
                    courses={direct}
                    uniSlug={uni.slug}
                    transferLookup={transferLookup}
                    courseAvailability={courseAvailability}
                    state={state}
                  />
                )}
                {elective.length > 0 && (
                  <CourseGroup
                    title="Elective credit"
                    tone="amber"
                    courses={elective}
                    uniSlug={uni.slug}
                    transferLookup={transferLookup}
                    courseAvailability={courseAvailability}
                    state={state}
                  />
                )}
                {noCredit.length > 0 && (
                  <CourseGroup
                    title="No credit"
                    tone="rose"
                    courses={noCredit}
                    uniSlug={uni.slug}
                    transferLookup={transferLookup}
                    courseAvailability={courseAvailability}
                    state={state}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CourseGroup({
  title,
  tone,
  courses,
  uniSlug,
  transferLookup,
  courseAvailability,
  state,
}: {
  title: string;
  tone: "teal" | "amber" | "rose";
  courses: CCCourse[];
  uniSlug: string;
  transferLookup: Map<string, TransferMapping>;
  courseAvailability: Record<string, { colleges: string[]; totalSections: number }>;
  state: string;
}) {
  const toneColors = {
    teal: "text-teal-700 dark:text-teal-400",
    amber: "text-amber-700 dark:text-amber-400",
    rose: "text-rose-600 dark:text-rose-400",
  };

  return (
    <div>
      <h5 className={`text-[10px] font-semibold uppercase tracking-wider mb-1.5 ${toneColors[tone]}`}>
        {title} ({courses.length})
      </h5>
      <div className="space-y-1">
        {courses.map((c) => {
          const cell = getCellInfo(c, uniSlug, transferLookup);
          const avail = courseAvailability[`${c.prefix}-${c.number}`];
          return (
            <div key={c.course} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-medium text-gray-900 dark:text-slate-100">{c.course}</span>
                {cell.course && (
                  <>
                    <span className="text-gray-400 dark:text-slate-500">&rarr;</span>
                    <span className={toneColors[tone]}>{cell.course}</span>
                  </>
                )}
              </div>
              {avail && (
                <a
                  href={`/${state}/courses?q=${c.prefix}+${c.number}`}
                  className="text-[9px] text-emerald-600 dark:text-emerald-400 shrink-0 ml-2"
                >
                  ● Available
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

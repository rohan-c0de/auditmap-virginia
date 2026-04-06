"use client";

import { useState } from "react";
import type { TransferMapping } from "@/lib/types";
import type { CCCourse, UniversityScore, CellStatus } from "./types";
import { CELL_COLORS, getCellInfo } from "./types";

interface Props {
  sortedCourseRows: CCCourse[];
  universityScores: UniversityScore[];
  transferLookup: Map<string, TransferMapping>;
  courseAvailability: Record<string, { colleges: string[]; totalSections: number }>;
  problemCourses: Set<string>;
  columnSortSlug: string | null;
  onColumnSort: (slug: string | null) => void;
  state: string;
}

export default function CompareTable({
  sortedCourseRows,
  universityScores,
  transferLookup,
  courseAvailability,
  problemCourses,
  columnSortSlug,
  onColumnSort,
  state,
}: Props) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  function toggleExpand(course: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(course)) next.delete(course);
      else next.add(course);
      return next;
    });
  }

  return (
    <div className="hidden md:block overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-gray-50 dark:bg-slate-800">
            <th className="sticky left-0 z-10 bg-gray-50 dark:bg-slate-800 px-3 py-2.5 text-left font-semibold text-gray-700 dark:text-slate-300 min-w-[160px] border-r border-gray-200 dark:border-slate-700">
              Course
            </th>
            {universityScores.map((uni) => (
              <th
                key={uni.slug}
                onClick={() =>
                  onColumnSort(columnSortSlug === uni.slug ? null : uni.slug)
                }
                className="px-3 py-2.5 text-center font-semibold text-gray-700 dark:text-slate-300 min-w-[130px] cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors select-none"
              >
                <div className="truncate max-w-[130px] flex items-center justify-center gap-1">
                  {uni.name}
                  {columnSortSlug === uni.slug && (
                    <svg className="w-3 h-3 text-teal-600 dark:text-teal-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                    </svg>
                  )}
                </div>
                <div className="font-normal text-[10px] text-gray-400 dark:text-slate-500 mt-0.5">
                  {uni.pct}% transfer
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
          {sortedCourseRows.map((course) => {
            const avail = courseAvailability[`${course.prefix}-${course.number}`];
            const isProblem = problemCourses.has(course.course);
            const isExpanded = expandedRows.has(course.course);

            return (
              <tr
                key={course.course}
                onClick={() => toggleExpand(course.course)}
                className={`cursor-pointer transition-colors ${
                  isProblem
                    ? "bg-rose-50/30 dark:bg-rose-900/10 hover:bg-rose-50/50 dark:hover:bg-rose-900/20"
                    : "hover:bg-gray-50/50 dark:hover:bg-slate-800/30"
                }`}
              >
                <td className="sticky left-0 z-10 bg-white dark:bg-slate-900 px-3 py-2.5 border-r border-gray-200 dark:border-slate-700">
                  <div className="flex items-center gap-1.5">
                    <svg
                      className={`w-3 h-3 text-gray-400 dark:text-slate-500 shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" />
                    </svg>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-gray-900 dark:text-slate-100">
                          {course.course}
                        </span>
                        {isProblem && (
                          <span className="text-[9px] text-rose-500 dark:text-rose-400 font-medium">
                            No transfers
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-gray-400 dark:text-slate-500 truncate max-w-[150px]">
                        {course.title}
                      </div>
                      {avail && (
                        <a
                          href={`/${state}/courses?q=${course.prefix}+${course.number}`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center mt-0.5 text-[9px] text-emerald-600 dark:text-emerald-400 hover:underline"
                        >
                          ● {avail.totalSections} sections
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Expanded detail row */}
                  {isExpanded && (
                    <div className="mt-2 ml-4.5 space-y-1 border-t border-gray-100 dark:border-slate-800 pt-2">
                      {universityScores.map((uni) => {
                        const cell = getCellInfo(course, uni.slug, transferLookup);
                        if (cell.status === "unknown") return null;
                        return (
                          <div key={uni.slug} className="text-[10px] text-gray-500 dark:text-slate-400">
                            <span className="font-medium text-gray-700 dark:text-slate-300">
                              {uni.name}:
                            </span>{" "}
                            {cell.status === "no-credit" ? (
                              <span className="text-rose-500">Does not transfer</span>
                            ) : (
                              <>
                                {cell.course}
                                {cell.title && ` — ${cell.title}`}
                                {cell.credits && ` (${cell.credits} cr)`}
                              </>
                            )}
                            {cell.notes && (
                              <span className="text-amber-500 ml-1">{cell.notes}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </td>
                {universityScores.map((uni) => {
                  const cell = getCellInfo(course, uni.slug, transferLookup);
                  return (
                    <td
                      key={uni.slug}
                      className={`px-3 py-2.5 text-center ${CELL_COLORS[cell.status]}`}
                    >
                      <div className="font-semibold text-sm">{cell.label}</div>
                      {cell.course && (
                        <div className="text-[10px] mt-0.5 opacity-80 truncate max-w-[120px] mx-auto">
                          {cell.course}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>

        {/* Summary footer */}
        <tfoot>
          <tr className="bg-gray-50 dark:bg-slate-800 font-semibold">
            <td className="sticky left-0 z-10 bg-gray-50 dark:bg-slate-800 px-3 py-2.5 text-gray-700 dark:text-slate-300 border-r border-gray-200 dark:border-slate-700">
              Total
            </td>
            {universityScores.map((uni) => (
              <td key={uni.slug} className="px-3 py-2.5 text-center">
                <span
                  className={
                    uni.pct >= 80
                      ? "text-teal-700 dark:text-teal-400"
                      : uni.pct >= 50
                        ? "text-amber-700 dark:text-amber-400"
                        : "text-rose-700 dark:text-rose-400"
                  }
                >
                  {uni.transferable}/{uni.total}
                </span>
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

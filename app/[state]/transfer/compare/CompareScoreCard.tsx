"use client";

import type { UniversityScore } from "./types";

interface Props {
  uni: UniversityScore;
  rank: number;
}

export default function CompareScoreCard({ uni, rank }: Props) {
  const isTop = rank === 0 && uni.isBestFit;

  return (
    <div
      className={`rounded-lg border p-4 transition-all duration-300 ease-in-out ${
        isTop
          ? "border-teal-300 dark:border-teal-700 bg-teal-50/50 dark:bg-teal-900/20 ring-1 ring-teal-200 dark:ring-teal-800 shadow-sm"
          : "border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900"
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <h4 className="text-sm font-semibold text-gray-900 dark:text-slate-100 leading-tight pr-2">
          {isTop && (
            <span className="text-teal-600 dark:text-teal-400 mr-1">★</span>
          )}
          {uni.name}
        </h4>
        <span
          className={`text-lg font-bold tabular-nums shrink-0 ${
            uni.pct >= 80
              ? "text-teal-600 dark:text-teal-400"
              : uni.pct >= 50
                ? "text-amber-600 dark:text-amber-400"
                : "text-rose-600 dark:text-rose-400"
          }`}
        >
          {uni.pct}%
        </span>
      </div>

      {/* Best fit label */}
      {isTop && (
        <p className="text-[10px] font-medium text-teal-600 dark:text-teal-400 mb-1.5">
          Best fit for your courses
        </p>
      )}

      {/* Score breakdown bar */}
      <div className="h-1.5 rounded-full bg-gray-100 dark:bg-slate-800 overflow-hidden flex mb-2">
        {uni.direct > 0 && (
          <div
            className="bg-teal-500 h-full"
            style={{ width: `${(uni.direct / uni.total) * 100}%` }}
            title={`${uni.direct} direct`}
          />
        )}
        {uni.elective > 0 && (
          <div
            className="bg-amber-400 h-full"
            style={{ width: `${(uni.elective / uni.total) * 100}%` }}
            title={`${uni.elective} elective`}
          />
        )}
        {uni.noCredit > 0 && (
          <div
            className="bg-rose-400 h-full"
            style={{ width: `${(uni.noCredit / uni.total) * 100}%` }}
            title={`${uni.noCredit} no credit`}
          />
        )}
        {uni.availableBonus > 0 && (
          <div
            className="bg-emerald-400 h-full"
            style={{ width: `${(uni.availableBonus / uni.total) * 100}%` }}
            title={`${uni.availableBonus} available bonus`}
          />
        )}
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
        <span className="text-teal-600 dark:text-teal-400">
          {uni.direct} direct
        </span>
        <span className="text-amber-600 dark:text-amber-400">
          {uni.elective} elective
        </span>
        {uni.noCredit > 0 && (
          <span className="text-rose-500 dark:text-rose-400">
            {uni.noCredit} no credit
          </span>
        )}
        {uni.unknown > 0 && (
          <span className="text-gray-400 dark:text-slate-500">
            {uni.unknown} no data
          </span>
        )}
      </div>

      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-[10px] text-gray-400 dark:text-slate-500">
          {uni.transferable}/{uni.total} courses transfer
        </span>
        <span className="text-[10px] text-gray-400 dark:text-slate-500">
          Score: {uni.weightedScore}/{uni.maxWeightedScore}
        </span>
      </div>
    </div>
  );
}

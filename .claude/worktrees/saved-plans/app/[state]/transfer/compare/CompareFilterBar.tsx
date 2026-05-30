"use client";

import type { SortMode, OutcomeFilter, CompareFilters } from "./types";

interface Props {
  filters: CompareFilters;
  onFiltersChange: (f: CompareFilters) => void;
  activeFilterCount: number;
  availabilitySummary: { available: number; total: number };
  hasAvailabilityData: boolean;
  onExportCSV: () => void;
}

export default function CompareFilterBar({
  filters,
  onFiltersChange,
  activeFilterCount,
  availabilitySummary,
  hasAvailabilityData,
  onExportCSV,
}: Props) {
  function update(partial: Partial<CompareFilters>) {
    onFiltersChange({ ...filters, ...partial });
  }

  function clearAll() {
    onFiltersChange({
      sortMode: "weighted",
      outcomeFilter: "all",
      availableOnly: false,
    });
  }

  return (
    <div className="mb-4 rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 p-4">
      <div className="flex flex-wrap items-end gap-3">
        {/* Sort */}
        <div className="min-w-[150px]">
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">
            Sort universities
          </label>
          <select
            value={filters.sortMode}
            onChange={(e) => update({ sortMode: e.target.value as SortMode })}
            className="w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm dark:text-slate-100 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-200"
          >
            <option value="weighted">Best Fit (weighted)</option>
            <option value="acceptance">Acceptance Rate</option>
            <option value="direct">Direct Matches</option>
            <option value="alphabetical">A &ndash; Z</option>
          </select>
        </div>

        {/* Outcome filter */}
        <div className="min-w-[150px]">
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">
            Show courses
          </label>
          <select
            value={filters.outcomeFilter}
            onChange={(e) =>
              update({ outcomeFilter: e.target.value as OutcomeFilter })
            }
            className="w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm dark:text-slate-100 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-200"
          >
            <option value="all">All outcomes</option>
            <option value="direct-only">Direct matches only</option>
            <option value="transferable">Transferable only</option>
            <option value="hide-no-credit">Hide no-credit</option>
          </select>
        </div>

        {/* Available toggle */}
        {hasAvailabilityData && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.availableOnly}
              onChange={(e) => update({ availableOnly: e.target.checked })}
              className="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
            />
            <span className="text-sm text-gray-700 dark:text-slate-300">
              Available this term
            </span>
          </label>
        )}

        {/* Spacer + actions */}
        <div className="flex items-center gap-2 ml-auto">
          {activeFilterCount > 0 && (
            <button
              onClick={clearAll}
              className="text-xs text-teal-600 hover:text-teal-800 dark:text-teal-400 dark:hover:text-teal-300"
            >
              Clear filters
              <span className="ml-1 inline-flex items-center justify-center rounded-full bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-400 text-[10px] font-medium w-4 h-4">
                {activeFilterCount}
              </span>
            </button>
          )}
          <button
            onClick={onExportCSV}
            className="rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
            title="Export comparison as CSV"
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Availability summary */}
      {hasAvailabilityData && availabilitySummary.total > 0 && (
        <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">
          {availabilitySummary.available} of {availabilitySummary.total} selected
          courses available this term
        </p>
      )}
    </div>
  );
}

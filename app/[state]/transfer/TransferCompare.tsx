"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import type { TransferMapping } from "@/lib/types";
import type { CCCourse, CompareFilters, UniversityScore, CellStatus } from "./compare/types";
import { getCellInfo } from "./compare/types";
import CompareFilterBar from "./compare/CompareFilterBar";
import CompareScoreCard from "./compare/CompareScoreCard";
import CompareTable from "./compare/CompareTable";
import CompareMobileCards from "./compare/CompareMobileCards";
import CompareEmptyState from "./compare/CompareEmptyState";

interface Props {
  universities: { slug: string; name: string }[];
  mappings: TransferMapping[];
  courseAvailability: Record<
    string,
    { colleges: string[]; totalSections: number }
  >;
  state: string;
  popularCourses: string[];
}

const DEFAULT_FILTERS: CompareFilters = {
  sortMode: "weighted",
  outcomeFilter: "all",
  availableOnly: false,
};

export default function TransferCompare({
  universities,
  mappings,
  courseAvailability,
  state,
  popularCourses,
}: Props) {
  const searchParams = useSearchParams();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCourses, setSelectedCourses] = useState<Set<string>>(
    new Set()
  );
  const [filters, setFilters] = useState<CompareFilters>(DEFAULT_FILTERS);
  const [columnSortSlug, setColumnSortSlug] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Course data memos
  // ---------------------------------------------------------------------------

  const allCourses = useMemo(() => {
    const seen = new Map<string, CCCourse>();
    for (const m of mappings) {
      const key = `${m.cc_prefix} ${m.cc_number}`;
      if (!seen.has(key)) {
        seen.set(key, {
          prefix: m.cc_prefix,
          number: m.cc_number,
          course: key,
          title: m.cc_title,
        });
      }
    }
    return Array.from(seen.values()).sort((a, b) =>
      a.course.localeCompare(b.course)
    );
  }, [mappings]);

  const coursesByPrefix = useMemo(() => {
    const map = new Map<string, CCCourse[]>();
    for (const c of allCourses) {
      if (!map.has(c.prefix)) map.set(c.prefix, []);
      map.get(c.prefix)!.push(c);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [allCourses]);

  const prefixes = useMemo(() => coursesByPrefix.map(([p]) => p), [coursesByPrefix]);

  const filteredCourses = useMemo(() => {
    if (!searchQuery) return coursesByPrefix;
    const q = searchQuery.toLowerCase();
    return coursesByPrefix
      .map(
        ([prefix, courses]) =>
          [
            prefix,
            courses.filter(
              (c) =>
                c.course.toLowerCase().includes(q) ||
                c.title.toLowerCase().includes(q)
            ),
          ] as [string, CCCourse[]]
      )
      .filter(([, courses]) => courses.length > 0);
  }, [coursesByPrefix, searchQuery]);

  const transferLookup = useMemo(() => {
    const map = new Map<string, TransferMapping>();
    for (const m of mappings) {
      const key = `${m.cc_prefix} ${m.cc_number}|${m.university}`;
      map.set(key, m);
    }
    return map;
  }, [mappings]);

  const selectedCoursesList = useMemo(() => {
    return allCourses.filter((c) => selectedCourses.has(c.course));
  }, [allCourses, selectedCourses]);

  const hasAvailabilityData = useMemo(
    () => Object.keys(courseAvailability).length > 0,
    [courseAvailability]
  );

  // ---------------------------------------------------------------------------
  // URL sync — read on mount, write on change
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const coursesParam = searchParams.get("courses");
    if (coursesParam) {
      const codes = coursesParam.split(",").map((c) => c.replace(/\+/g, " ").trim());
      const valid = codes.filter((c) => allCourses.some((ac) => ac.course === c));
      if (valid.length > 0) {
        setSelectedCourses(new Set(valid));
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedCourses.size === 0) return;
    const timer = setTimeout(() => {
      const encoded = Array.from(selectedCourses)
        .map((c) => c.replace(/ /g, "+"))
        .join(",");
      const url = new URL(window.location.href);
      url.searchParams.set("courses", encoded);
      window.history.replaceState(null, "", url.toString());
    }, 300);
    return () => clearTimeout(timer);
  }, [selectedCourses]);

  // ---------------------------------------------------------------------------
  // Weighted scoring
  // ---------------------------------------------------------------------------

  const universityScores = useMemo((): UniversityScore[] => {
    if (selectedCoursesList.length === 0) return [];

    const scores = universities.map((uni) => {
      let direct = 0,
        elective = 0,
        noCredit = 0,
        unknown = 0,
        availableBonus = 0;

      for (const c of selectedCoursesList) {
        const m = transferLookup.get(`${c.course}|${uni.slug}`);
        const isAvailable = !!courseAvailability[`${c.prefix}-${c.number}`];

        if (!m) {
          unknown++;
        } else if (m.no_credit) {
          noCredit++;
        } else if (m.is_elective) {
          elective++;
          if (isAvailable) availableBonus++;
        } else {
          direct++;
          if (isAvailable) availableBonus++;
        }
      }

      const transferable = direct + elective;
      const total = selectedCoursesList.length;
      const pct = total > 0 ? Math.round((transferable / total) * 100) : 0;
      const weightedScore = direct * 3 + elective * 1 + availableBonus * 1;
      const maxWeightedScore = total * 4;

      return {
        ...uni,
        direct,
        elective,
        noCredit,
        unknown,
        availableBonus,
        transferable,
        total,
        pct,
        weightedScore,
        maxWeightedScore,
        isBestFit: false,
      };
    });

    // Sort
    scores.sort((a, b) => {
      switch (filters.sortMode) {
        case "weighted":
          return b.weightedScore - a.weightedScore || b.direct - a.direct;
        case "acceptance":
          return b.transferable - a.transferable || b.direct - a.direct;
        case "direct":
          return b.direct - a.direct || b.transferable - a.transferable;
        case "alphabetical":
          return a.name.localeCompare(b.name);
      }
    });

    // Mark best fit (only if strictly better)
    if (scores.length > 1 && scores[0].weightedScore > scores[1].weightedScore) {
      scores[0].isBestFit = true;
    }

    return scores;
  }, [universities, selectedCoursesList, transferLookup, courseAvailability, filters.sortMode]);

  // ---------------------------------------------------------------------------
  // Filtered + sorted rows
  // ---------------------------------------------------------------------------

  const problemCourses = useMemo(() => {
    const problems = new Set<string>();
    for (const c of selectedCoursesList) {
      const hasAnyTransfer = universities.some((uni) => {
        const cell = getCellInfo(c, uni.slug, transferLookup);
        return cell.status === "direct" || cell.status === "elective";
      });
      if (!hasAnyTransfer) problems.add(c.course);
    }
    return problems;
  }, [selectedCoursesList, universities, transferLookup]);

  const sortedCourseRows = useMemo(() => {
    let rows = [...selectedCoursesList];

    // Outcome filter
    if (filters.outcomeFilter !== "all") {
      rows = rows.filter((c) => {
        const statuses = universityScores.map(
          (uni) => getCellInfo(c, uni.slug, transferLookup).status
        );
        switch (filters.outcomeFilter) {
          case "direct-only":
            return statuses.some((s) => s === "direct");
          case "transferable":
            return statuses.some((s) => s === "direct" || s === "elective");
          case "hide-no-credit":
            return !statuses.every((s) => s === "no-credit" || s === "unknown");
        }
        return true;
      });
    }

    // Available-only
    if (filters.availableOnly) {
      rows = rows.filter((c) => !!courseAvailability[`${c.prefix}-${c.number}`]);
    }

    // Column sort
    if (columnSortSlug) {
      const statusOrder: Record<CellStatus, number> = {
        direct: 0,
        elective: 1,
        "no-credit": 2,
        unknown: 3,
      };
      rows.sort((a, b) => {
        const sa = getCellInfo(a, columnSortSlug, transferLookup).status;
        const sb = getCellInfo(b, columnSortSlug, transferLookup).status;
        return statusOrder[sa] - statusOrder[sb];
      });
    } else {
      // Default: problem courses last
      rows.sort((a, b) => {
        const aProb = problemCourses.has(a.course) ? 1 : 0;
        const bProb = problemCourses.has(b.course) ? 1 : 0;
        if (aProb !== bProb) return aProb - bProb;
        return a.course.localeCompare(b.course);
      });
    }

    return rows;
  }, [
    selectedCoursesList,
    filters.outcomeFilter,
    filters.availableOnly,
    columnSortSlug,
    universityScores,
    transferLookup,
    courseAvailability,
    problemCourses,
  ]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.sortMode !== "weighted") count++;
    if (filters.outcomeFilter !== "all") count++;
    if (filters.availableOnly) count++;
    return count;
  }, [filters]);

  const availabilitySummary = useMemo(() => {
    let available = 0;
    for (const c of selectedCoursesList) {
      if (courseAvailability[`${c.prefix}-${c.number}`]) available++;
    }
    return { available, total: selectedCoursesList.length };
  }, [selectedCoursesList, courseAvailability]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  function toggleCourse(course: string) {
    setSelectedCourses((prev) => {
      const next = new Set(prev);
      if (next.has(course)) next.delete(course);
      else next.add(course);
      return next;
    });
  }

  function togglePrefix(prefix: string, courses: CCCourse[]) {
    setSelectedCourses((prev) => {
      const next = new Set(prev);
      const allSelected = courses.every((c) => next.has(c.course));
      for (const c of courses) {
        if (allSelected) next.delete(c.course);
        else next.add(c.course);
      }
      return next;
    });
  }

  function clearAllCourses() {
    setSelectedCourses(new Set());
    const url = new URL(window.location.href);
    url.searchParams.delete("courses");
    window.history.replaceState(null, "", url.toString());
  }

  const selectCourses = useCallback(
    (courses: string[]) => {
      setSelectedCourses(new Set(courses));
    },
    []
  );

  function downloadCSV() {
    const headers = [
      "Course",
      "Title",
      "Available",
      ...universityScores.map((u) => u.name),
    ];
    const rows = sortedCourseRows.map((c) => {
      const avail = courseAvailability[`${c.prefix}-${c.number}`];
      const cells = universityScores.map((uni) => {
        const info = getCellInfo(c, uni.slug, transferLookup);
        if (info.status === "direct") return `Direct: ${info.course}`;
        if (info.status === "elective") return `Elective: ${info.course}`;
        if (info.status === "no-credit") return "No Credit";
        return "No Data";
      });
      return [
        c.course,
        c.title,
        avail ? `${avail.totalSections} sections` : "Not offered",
        ...cells,
      ];
    });

    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${cell}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transfer-comparison-${state}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div>
      {/* ── Course Selector ── */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300">
            Select your courses
          </h3>
          {selectedCourses.size > 0 && (
            <button
              onClick={clearAllCourses}
              className="text-xs text-teal-600 hover:text-teal-800 dark:text-teal-400 dark:hover:text-teal-300"
            >
              Clear all ({selectedCourses.size})
            </button>
          )}
        </div>

        <input
          type="text"
          placeholder="Search courses (e.g. ENG 111 or Biology)..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-2.5 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-200 mb-3"
        />

        {/* Selected chips */}
        {selectedCourses.size > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {selectedCoursesList.map((c) => (
              <button
                key={c.course}
                onClick={() => toggleCourse(c.course)}
                className="inline-flex items-center gap-1 rounded-full bg-teal-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-teal-700 transition-colors"
              >
                {c.course}
                <span className="text-teal-200">&times;</span>
              </button>
            ))}
          </div>
        )}

        {/* Course grid */}
        <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 space-y-3">
          {filteredCourses.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-slate-500 text-center py-4">
              No courses match &ldquo;{searchQuery}&rdquo;
            </p>
          ) : (
            filteredCourses.map(([prefix, courses]) => {
              const allSelected = courses.every((c) =>
                selectedCourses.has(c.course)
              );
              const someSelected = courses.some((c) =>
                selectedCourses.has(c.course)
              );

              return (
                <div key={prefix}>
                  <button
                    onClick={() => togglePrefix(prefix, courses)}
                    className="flex items-center gap-2 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-1.5 hover:text-teal-600 dark:hover:text-teal-400 transition-colors"
                  >
                    <span
                      className={`w-3.5 h-3.5 rounded border flex items-center justify-center text-[8px] transition-colors ${
                        allSelected
                          ? "bg-teal-600 border-teal-600 text-white"
                          : someSelected
                            ? "bg-teal-100 dark:bg-teal-900/40 border-teal-400 dark:border-teal-600"
                            : "border-gray-300 dark:border-slate-600"
                      }`}
                    >
                      {allSelected && "\u2713"}
                      {someSelected && !allSelected && "\u2013"}
                    </span>
                    {prefix} ({courses.length})
                  </button>
                  <div className="flex flex-wrap gap-1.5 ml-5">
                    {courses.map((c) => (
                      <button
                        key={c.course}
                        onClick={() => toggleCourse(c.course)}
                        className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                          selectedCourses.has(c.course)
                            ? "bg-teal-600 text-white"
                            : "bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-700"
                        }`}
                        title={c.title}
                      >
                        {c.course}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Results ── */}
      {selectedCourses.size === 0 ? (
        <CompareEmptyState
          popularCourses={popularCourses}
          allCourses={allCourses}
          onSelectCourses={selectCourses}
          prefixes={prefixes}
        />
      ) : (
        <>
          {/* ── Filter bar ── */}
          <CompareFilterBar
            filters={filters}
            onFiltersChange={setFilters}
            activeFilterCount={activeFilterCount}
            availabilitySummary={availabilitySummary}
            hasAvailabilityData={hasAvailabilityData}
            onExportCSV={downloadCSV}
          />

          {/* ── Summary cards — ranked ── */}
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-3">
              Best transfer destinations for your {selectedCourses.size}{" "}
              {selectedCourses.size === 1 ? "course" : "courses"}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {universityScores.map((uni, rank) => (
                <CompareScoreCard key={uni.slug} uni={uni} rank={rank} />
              ))}
            </div>
          </div>

          {/* ── Comparison table heading ── */}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300">
                Course-by-course comparison
              </h3>
              {sortedCourseRows.length !== selectedCoursesList.length && (
                <span className="text-xs text-gray-400 dark:text-slate-500">
                  {sortedCourseRows.length} of {selectedCoursesList.length} courses shown
                </span>
              )}
            </div>

            {/* Desktop table */}
            <CompareTable
              sortedCourseRows={sortedCourseRows}
              universityScores={universityScores}
              transferLookup={transferLookup}
              courseAvailability={courseAvailability}
              problemCourses={problemCourses}
              columnSortSlug={columnSortSlug}
              onColumnSort={setColumnSortSlug}
              state={state}
            />

            {/* Mobile cards */}
            <CompareMobileCards
              sortedCourseRows={sortedCourseRows}
              universityScores={universityScores}
              transferLookup={transferLookup}
              courseAvailability={courseAvailability}
              state={state}
            />
          </div>

          {/* ── Legend ── */}
          <div className="flex flex-wrap items-center gap-4 text-[10px] text-gray-500 dark:text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-teal-100 dark:bg-teal-900/30 inline-block" />
              ✓ Direct match
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-amber-100 dark:bg-amber-900/30 inline-block" />
              ~ Elective credit
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-rose-100 dark:bg-rose-900/30 inline-block" />
              ✗ No credit
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-gray-100 dark:bg-slate-800 inline-block" />
              — No data
            </span>
            {problemCourses.size > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-rose-50 dark:bg-rose-900/10 ring-1 ring-rose-200 dark:ring-rose-800 inline-block" />
                Problem course (no transfers)
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

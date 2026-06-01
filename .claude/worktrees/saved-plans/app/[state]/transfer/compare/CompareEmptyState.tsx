"use client";

import type { CCCourse } from "./types";

interface Props {
  popularCourses: string[];
  allCourses: CCCourse[];
  onSelectCourses: (courses: string[]) => void;
  prefixes: string[];
}

export default function CompareEmptyState({
  popularCourses,
  allCourses,
  onSelectCourses,
  prefixes,
}: Props) {
  // Filter popular courses to only those that exist in allCourses
  const validPopular = popularCourses.filter((c) =>
    allCourses.some((ac) => ac.course === c)
  );

  // Get a few top prefixes for quick-select buttons
  const topPrefixes = prefixes.slice(0, 5);

  function selectPrefix(prefix: string) {
    const courses = allCourses
      .filter((c) => c.prefix === prefix)
      .map((c) => c.course);
    onSelectCourses(courses);
  }

  return (
    <div className="rounded-lg border border-dashed border-gray-300 dark:border-slate-600 py-12 text-center">
      <div className="text-3xl mb-3">📊</div>
      <p className="text-gray-500 dark:text-slate-400 text-sm font-medium">
        Select courses above to compare transfer credit across universities
      </p>
      <p className="text-gray-400 dark:text-slate-500 text-xs mt-2 mb-4">
        Click a subject heading to select all courses in that subject, or use a
        preset below
      </p>

      <div className="flex flex-wrap justify-center gap-2">
        {validPopular.length > 0 && (
          <button
            onClick={() => onSelectCourses(validPopular)}
            className="rounded-full bg-teal-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-teal-700 transition-colors"
          >
            Popular gen-eds ({validPopular.length})
          </button>
        )}
        {topPrefixes.map((prefix) => (
          <button
            key={prefix}
            onClick={() => selectPrefix(prefix)}
            className="rounded-full bg-gray-100 dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors"
          >
            All {prefix}
          </button>
        ))}
      </div>
    </div>
  );
}

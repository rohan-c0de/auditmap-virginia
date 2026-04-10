"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PrereqEntry {
  code: string;
  text: string;
  prereqs: string[];
}

interface PlanCourse {
  code: string;
  text: string;
  semester: number; // 1-indexed — which semester to take it in
  isTarget: boolean; // was this explicitly selected by the user?
}

interface SemesterPlannerProps {
  state: string;
}

// ---------------------------------------------------------------------------
// AND/OR prereq text parser
// ---------------------------------------------------------------------------

/**
 * Parse a prereq text string into AND-of-OR groups.
 *
 * Example: "ACC 101 and (BUS 107 or CIS 107 or OAT 152)"
 *  → [["ACC 101"], ["BUS 107", "CIS 107", "OAT 152"]]
 *
 * Meaning: you must take ACC 101 AND (one of BUS 107 / CIS 107 / OAT 152).
 *
 * Strategy: split the text on top-level "and" (outside parentheses), then
 * map each known course code to the chunk it appears in. Courses in the
 * same chunk form an OR group.
 */
function parsePrereqGroups(text: string, courses: string[]): string[][] {
  if (courses.length === 0) return [];
  if (courses.length === 1) return [courses];

  // Split text on top-level " and " (not inside parentheses)
  const chunks: string[] = [];
  let depth = 0;
  let current = "";
  const tokens = text.split(/(\s+)/);

  for (const token of tokens) {
    for (const ch of token) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
    }
    if (token.toLowerCase() === "and" && depth === 0 && current.trim()) {
      chunks.push(current.trim());
      current = "";
    } else {
      current += token;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  // Map each course to its chunk → courses in the same chunk are OR alternatives
  const groups: string[][] = [];
  const assigned = new Set<string>();

  for (const chunk of chunks) {
    const group: string[] = [];
    for (const course of courses) {
      if (assigned.has(course)) continue;
      if (chunk.toUpperCase().includes(course)) {
        group.push(course);
        assigned.add(course);
      }
    }
    if (group.length > 0) groups.push(group);
  }

  // Any unassigned courses become their own AND group (required)
  for (const course of courses) {
    if (!assigned.has(course)) {
      groups.push([course]);
    }
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Algorithm: topological sort → semester assignment (AND/OR aware)
// ---------------------------------------------------------------------------

/**
 * Given a set of target courses and a prereq lookup table, compute the
 * minimum-semester plan. Uses a reverse topological sort:
 *
 * 1. Parse each course's prereqs into AND-of-OR groups
 * 2. For each OR group, pick the option with the fewest direct prereqs
 * 3. BFS from targets using only resolved (picked) prereqs
 * 4. Compute "level" of each course (max distance from any leaf)
 * 5. Group by level → each level is one semester
 */
function buildPlan(
  targets: string[],
  lookup: Map<string, PrereqEntry>,
): PlanCourse[] {
  // Cache resolved prereqs: for each course, the actual prereqs to take
  // (after OR resolution)
  const resolvedPrereqs = new Map<string, string[]>();

  function getResolvedPrereqs(course: string): string[] {
    if (resolvedPrereqs.has(course)) return resolvedPrereqs.get(course)!;
    const entry = lookup.get(course);
    if (!entry || entry.prereqs.length === 0) {
      resolvedPrereqs.set(course, []);
      return [];
    }

    const groups = parsePrereqGroups(entry.text, entry.prereqs);
    const picked: string[] = [];

    for (const group of groups) {
      if (group.length === 1) {
        picked.push(group[0]);
      } else {
        // Pick the OR option with the fewest direct prereqs (cheapest path)
        const best = group.reduce((a, b) => {
          const aCount = lookup.get(a)?.prereqs.length || 0;
          const bCount = lookup.get(b)?.prereqs.length || 0;
          return aCount <= bCount ? a : b;
        });
        picked.push(best);
      }
    }

    resolvedPrereqs.set(course, picked);
    return picked;
  }

  // BFS collecting only the courses we actually need
  const visited = new Set<string>();
  const queue = [...targets];
  while (queue.length > 0) {
    const course = queue.shift()!;
    if (visited.has(course)) continue;
    visited.add(course);
    for (const prereq of getResolvedPrereqs(course)) {
      if (!visited.has(prereq)) queue.push(prereq);
    }
  }

  // Compute the level of each course (max distance from leaves)
  const levels = new Map<string, number>();

  function computeLevel(course: string, path: Set<string>): number {
    if (levels.has(course)) return levels.get(course)!;
    if (path.has(course)) return 0; // cycle guard
    path.add(course);

    const prereqs = getResolvedPrereqs(course);
    if (prereqs.length === 0) {
      levels.set(course, 0);
      path.delete(course);
      return 0;
    }

    let maxChildLevel = 0;
    for (const prereq of prereqs) {
      if (visited.has(prereq)) {
        maxChildLevel = Math.max(maxChildLevel, computeLevel(prereq, path) + 1);
      }
    }

    levels.set(course, maxChildLevel);
    path.delete(course);
    return maxChildLevel;
  }

  for (const course of visited) {
    computeLevel(course, new Set());
  }

  // Build plan courses
  const targetSet = new Set(targets);
  const plan: PlanCourse[] = [];

  for (const course of visited) {
    const entry = lookup.get(course);
    plan.push({
      code: course,
      text: entry?.text || "",
      semester: (levels.get(course) || 0) + 1,
      isTarget: targetSet.has(course),
    });
  }

  // Sort by semester, then by course code
  plan.sort((a, b) => a.semester - b.semester || a.code.localeCompare(b.code));

  return plan;
}

// ---------------------------------------------------------------------------
// Course search autocomplete
// ---------------------------------------------------------------------------

function CourseSearch({
  allCourses,
  selectedCourses,
  onAdd,
}: {
  allCourses: PrereqEntry[];
  selectedCourses: Set<string>;
  onAdd: (code: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    if (query.length < 2) return [];
    const q = query.toUpperCase();
    return allCourses
      .filter(
        (c) =>
          !selectedCourses.has(c.code) &&
          (c.code.includes(q) ||
            c.text.toUpperCase().includes(q)),
      )
      .slice(0, 8);
  }, [query, allCourses, selectedCourses]);

  return (
    <div className="relative">
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
          />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 200)}
          placeholder="Search courses (e.g., MATH 1130, English)..."
          className="w-full rounded-xl border border-slate-200 dark:border-slate-700
            bg-white dark:bg-slate-800 pl-10 pr-4 py-2.5
            text-sm text-slate-900 dark:text-slate-100
            placeholder:text-slate-400 dark:placeholder:text-slate-500
            focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-400
            transition-shadow"
        />
      </div>

      {focused && results.length > 0 && (
        <div className="absolute z-50 top-full mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-xl overflow-hidden">
          {results.map((course) => (
            <button
              key={course.code}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onAdd(course.code);
                setQuery("");
                inputRef.current?.focus();
              }}
              className="w-full text-left px-4 py-2.5 hover:bg-teal-50 dark:hover:bg-teal-900/30
                transition-colors border-b border-slate-100 dark:border-slate-700/50 last:border-0"
            >
              <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                {course.code}
              </span>
              <span className="ml-2 text-xs text-slate-500 dark:text-slate-400 line-clamp-1">
                {course.text.length > 60
                  ? course.text.slice(0, 60) + "..."
                  : course.text || "No prerequisites"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Semester card
// ---------------------------------------------------------------------------

function SemesterCard({
  semester,
  courses,
  onRemove,
}: {
  semester: number;
  courses: PlanCourse[];
  onRemove: (code: string) => void;
}) {
  const targets = courses.filter((c) => c.isTarget);
  const prereqs = courses.filter((c) => !c.isTarget);

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 overflow-hidden shadow-sm">
      {/* Header */}
      <div className="px-4 py-2.5 bg-gradient-to-r from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-750 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">
            Semester {semester}
          </h3>
          <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">
            {courses.length} {courses.length === 1 ? "course" : "courses"}
          </span>
        </div>
      </div>

      {/* Course list */}
      <div className="p-3 space-y-1.5">
        {targets.map((course) => (
          <div
            key={course.code}
            className="flex items-center justify-between rounded-lg bg-teal-50 dark:bg-teal-900/30 border border-teal-200 dark:border-teal-800 px-3 py-2 group"
          >
            <div className="min-w-0">
              <span className="font-bold text-sm text-teal-900 dark:text-teal-200">
                {course.code}
              </span>
              <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-teal-200/60 dark:bg-teal-800/60 text-teal-700 dark:text-teal-300 font-semibold">
                TARGET
              </span>
              {course.text && (
                <p className="text-[11px] text-teal-600 dark:text-teal-400 mt-0.5 truncate">
                  {course.text.length > 70
                    ? course.text.slice(0, 70) + "..."
                    : course.text}
                </p>
              )}
            </div>
            <button
              onClick={() => onRemove(course.code)}
              className="opacity-0 group-hover:opacity-100 text-teal-400 hover:text-red-500 transition-all ml-2"
              title="Remove from plan"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}

        {prereqs.map((course) => (
          <div
            key={course.code}
            className="flex items-center justify-between rounded-lg bg-slate-50 dark:bg-slate-700/40 border border-slate-200 dark:border-slate-600/50 px-3 py-2"
          >
            <div className="min-w-0">
              <span className="font-semibold text-sm text-slate-700 dark:text-slate-300">
                {course.code}
              </span>
              <span className="ml-1.5 text-[10px] text-slate-400 dark:text-slate-500">
                prerequisite
              </span>
              {course.text && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                  {course.text.length > 70
                    ? course.text.slice(0, 70) + "..."
                    : course.text}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline connector
// ---------------------------------------------------------------------------

function TimelineArrow() {
  return (
    <div className="flex items-center justify-center py-1">
      <div className="flex flex-col items-center">
        <div className="w-px h-4 bg-slate-300 dark:bg-slate-600" />
        <svg width="10" height="6" viewBox="0 0 10 6" className="text-slate-300 dark:text-slate-600">
          <polygon points="0,0 10,0 5,6" fill="currentColor" />
        </svg>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function SemesterPlanner({ state }: SemesterPlannerProps) {
  const [allCourses, setAllCourses] = useState<PrereqEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [targets, setTargets] = useState<string[]>([]);

  // Fetch all courses on mount
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/${state}/prereqs/courses`);
        if (!res.ok) throw new Error("Failed to load courses");
        const data = await res.json();
        setAllCourses(data.courses);
      } catch {
        setError("Prerequisite data not available for this state");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [state]);

  // Build lookup map
  const lookup = useMemo(() => {
    const map = new Map<string, PrereqEntry>();
    for (const c of allCourses) map.set(c.code, c);
    return map;
  }, [allCourses]);

  // Compute the plan whenever targets change
  const plan = useMemo(() => {
    if (targets.length === 0) return [];
    return buildPlan(targets, lookup);
  }, [targets, lookup]);

  // Group plan by semester
  const semesters = useMemo(() => {
    const groups = new Map<number, PlanCourse[]>();
    for (const c of plan) {
      const arr = groups.get(c.semester) || [];
      arr.push(c);
      groups.set(c.semester, arr);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a - b);
  }, [plan]);

  const totalCourses = plan.length;
  const totalSemesters = semesters.length;

  const addTarget = useCallback(
    (code: string) => setTargets((prev) => [...prev, code]),
    [],
  );

  const removeTarget = useCallback(
    (code: string) => setTargets((prev) => prev.filter((c) => c !== code)),
    [],
  );

  const selectedSet = useMemo(() => new Set(targets), [targets]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
          <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
            <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75" />
          </svg>
          Loading prerequisite data...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 p-6 text-center">
        <p className="text-sm text-amber-700 dark:text-amber-300">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Search bar */}
      <div>
        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">
          Add courses you want to take
        </label>
        <CourseSearch
          allCourses={allCourses}
          selectedCourses={selectedSet}
          onAdd={addTarget}
        />
      </div>

      {/* Selected targets */}
      {targets.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {targets.map((code) => (
            <span
              key={code}
              className="inline-flex items-center gap-1.5 rounded-full bg-teal-100 dark:bg-teal-900/40 border border-teal-300 dark:border-teal-700 px-3 py-1 text-xs font-semibold text-teal-800 dark:text-teal-200"
            >
              {code}
              <button
                onClick={() => removeTarget(code)}
                className="text-teal-500 hover:text-red-500 transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Plan summary */}
      {plan.length > 0 && (
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-teal-100 dark:bg-teal-900/40 flex items-center justify-center">
              <span className="text-sm font-bold text-teal-700 dark:text-teal-300">{totalSemesters}</span>
            </div>
            <span className="text-slate-600 dark:text-slate-400">
              {totalSemesters === 1 ? "semester" : "semesters"}
            </span>
          </div>
          <div className="w-px h-5 bg-slate-200 dark:bg-slate-700" />
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
              <span className="text-sm font-bold text-slate-700 dark:text-slate-300">{totalCourses}</span>
            </div>
            <span className="text-slate-600 dark:text-slate-400">
              total {totalCourses === 1 ? "course" : "courses"}
            </span>
          </div>
          <div className="w-px h-5 bg-slate-200 dark:bg-slate-700" />
          <span className="text-xs text-slate-400 dark:text-slate-500">
            {targets.length} target{targets.length !== 1 ? "s" : ""} +{" "}
            {totalCourses - targets.length} prerequisite{totalCourses - targets.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      {/* Semester timeline */}
      {semesters.length > 0 ? (
        <div className="space-y-0">
          {semesters.map(([semester, courses], idx) => (
            <div key={semester}>
              {idx > 0 && <TimelineArrow />}
              <SemesterCard
                semester={semester}
                courses={courses}
                onRemove={removeTarget}
              />
            </div>
          ))}
        </div>
      ) : targets.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 py-16 text-center">
          <svg className="w-12 h-12 mx-auto text-slate-300 dark:text-slate-600 mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">
            Search for courses above to start building your plan
          </p>
          <p className="text-slate-400 dark:text-slate-500 text-xs mt-1">
            Prerequisites are automatically detected and sequenced into semesters
          </p>
        </div>
      ) : null}
    </div>
  );
}

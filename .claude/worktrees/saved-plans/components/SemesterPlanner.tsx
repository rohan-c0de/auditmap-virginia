"use client";

import { Fragment, useState, useCallback, useMemo, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/hooks/useAuth";
import { track } from "@/lib/analytics";

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

/** Per-course seat summary returned by /api/{state}/sections-for-courses */
interface SeatSummary {
  course_code: string;
  section_count: number;
  total_seats_open: number | null;
  total_seats_total: number | null;
  scraped_at: string | null;
  is_stale: boolean;
}

interface SemesterPlannerProps {
  state: string;
  /** Pre-populate the planner with these target courses. Used by /plan/[id]
   *  to hydrate a saved plan; also lets a user "Duplicate to edit" a saved
   *  plan by sending them to /[state]/plan with the same targets seeded. */
  initialTargets?: string[];
  /** Pre-fill the name field for the save dialog. Used by /plan/[id]
   *  "Duplicate" flow to seed the new plan with the source plan's name. */
  initialName?: string;
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
// Horizontal flowchart components
// ---------------------------------------------------------------------------

/** Animated flowing connector arrow between semester columns */
function SemesterConnector() {
  return (
    <div className="flex items-center shrink-0 mx-1.5 self-center">
      {/* Track line */}
      <div className="w-8 h-[2px] rounded-full bg-gradient-to-r from-slate-200 via-slate-300 to-slate-200 dark:from-slate-700 dark:via-slate-600 dark:to-slate-700 overflow-hidden relative">
        {/* Animated flow pulse */}
        <div
          className="absolute inset-y-0 w-3 bg-gradient-to-r from-transparent via-teal-400/60 to-transparent dark:via-teal-500/40 animate-[flow_2s_ease-in-out_infinite]"
        />
      </div>
      {/* Arrow head */}
      <svg width="6" height="10" viewBox="0 0 6 10" className="shrink-0 -ml-0.5">
        <polygon
          points="0,1 5,5 0,9"
          className="fill-slate-300 dark:fill-slate-500"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

/** CSS keyframes for flow animation */
function FlowStyles() {
  return (
    <style>{`
      @keyframes flow {
        0%   { transform: translateX(-12px); opacity: 0; }
        50%  { opacity: 1; }
        100% { transform: translateX(32px); opacity: 0; }
      }
    `}</style>
  );
}

/** A small pill that displays current seat availability for a course in the
 *  plan. Same emerald/amber/red color scheme as components/schedule/
 *  ScheduleResults.tsx's section badge, plus a 'not offered this term'
 *  state and a 'stale' visual cue when scraped_at is >3 days old. */
function SeatBadge({ seats }: { seats: SeatSummary }) {
  if (seats.section_count === 0) {
    return (
      <span
        className="text-[9px] px-1.5 py-0.5 rounded-full border border-slate-200 dark:border-slate-600 text-slate-400 dark:text-slate-500"
        title="Not offered this term"
      >
        —
      </span>
    );
  }
  const open = seats.total_seats_open ?? 0;
  const color =
    open === 0
      ? "border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400"
      : open <= 10
        ? "border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400"
        : "border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400";
  // Stale: dim the color with reduced opacity. Keeps the at-a-glance
  // signal but flags reduced confidence per the 3-day staleness convention.
  const staleClass = seats.is_stale ? "opacity-60" : "";
  const tooltip = (() => {
    const parts = [
      `${open} seat${open === 1 ? "" : "s"} open`,
      seats.total_seats_total != null ? `${seats.total_seats_total} total` : null,
      `${seats.section_count} section${seats.section_count === 1 ? "" : "s"}`,
      seats.scraped_at
        ? `as of ${new Date(seats.scraped_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
        : null,
      seats.is_stale ? "(data may be outdated)" : null,
    ];
    return parts.filter(Boolean).join(" · ");
  })();
  return (
    <span
      className={`text-[9px] px-1.5 py-0.5 rounded-full border font-medium ${color} ${staleClass}`}
      title={tooltip}
    >
      {open === 0 ? "Full" : open}
    </span>
  );
}

/** A single course node in the flowchart */
function CourseNode({
  course,
  onRemove,
  seats,
}: {
  course: PlanCourse;
  onRemove?: (code: string) => void;
  seats?: SeatSummary;
}) {
  const [hover, setHover] = useState(false);

  const style = course.isTarget
    ? `bg-gradient-to-br from-teal-50 to-emerald-50 dark:from-teal-900/60 dark:to-emerald-900/40
       border-teal-300 dark:border-teal-500/70 text-teal-900 dark:text-teal-100
       shadow-teal-200/50 dark:shadow-teal-900/30 shadow-md`
    : `bg-white/90 dark:bg-slate-700/60 border-slate-200 dark:border-slate-600/80
       text-slate-700 dark:text-slate-200 shadow-sm backdrop-blur-sm`;

  return (
    <div
      className="relative group"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div
        className={`
          relative flex items-center gap-1.5
          rounded-xl border px-3 py-1.5
          text-[11px] font-bold tracking-wide whitespace-nowrap shrink-0
          transition-all duration-200
          hover:scale-[1.04] hover:-translate-y-px
          cursor-default
          ${style}
        `}
      >
        {course.code}
        {seats && <SeatBadge seats={seats} />}
        {course.isTarget && (
          <span className="text-[8px] font-black px-1 py-0.5 rounded bg-teal-200/60 dark:bg-teal-700/60 text-teal-600 dark:text-teal-300 uppercase">
            target
          </span>
        )}
        {course.isTarget && onRemove && (
          <button
            onClick={() => onRemove(course.code)}
            className="opacity-0 group-hover:opacity-100 text-teal-400 hover:text-red-500 transition-all ml-0.5"
            title="Remove"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Tooltip */}
      {hover && course.text && (
        <div
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2.5
            px-3 py-2 rounded-xl
            bg-slate-900/95 dark:bg-slate-700/95
            backdrop-blur-md
            text-white text-[10px] leading-relaxed
            max-w-[240px] whitespace-normal
            shadow-2xl shadow-black/20
            z-50 pointer-events-none"
        >
          <span className="font-bold text-white/90">{course.code}</span>
          <br />
          <span className="text-slate-300">{course.text}</span>
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-[6px] border-transparent border-t-slate-900/95 dark:border-t-slate-700/95" />
        </div>
      )}
    </div>
  );
}

/** A semester column in the flowchart */
function SemesterColumn({
  semester,
  courses,
  isLast,
  onRemove,
  seatsByCode,
}: {
  semester: number;
  courses: PlanCourse[];
  isLast: boolean;
  onRemove: (code: string) => void;
  seatsByCode: Map<string, SeatSummary>;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 shrink-0">
      {/* Semester label */}
      <div className={`
        text-[9px] font-black uppercase tracking-[0.15em] px-2 py-0.5 rounded-full
        ${isLast
          ? "bg-teal-100 dark:bg-teal-900/40 text-teal-600 dark:text-teal-400"
          : "bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-500"
        }
      `}>
        Sem {semester}
      </div>

      {/* Course nodes stacked vertically */}
      <div className="flex flex-col gap-1.5">
        {courses.map((course) => (
          <CourseNode
            key={course.code}
            course={course}
            onRemove={course.isTarget ? onRemove : undefined}
            seats={seatsByCode.get(course.code)}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function SemesterPlanner({
  state,
  initialTargets,
  initialName,
}: SemesterPlannerProps) {
  const [allCourses, setAllCourses] = useState<PrereqEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [targets, setTargets] = useState<string[]>(initialTargets ?? []);

  // Save-plan state — mirrors ScheduleResults exactly: idle → saving → saved,
  // reverts after 3s. Auth gating via openLoginModal() if not signed in.
  const { user, openLoginModal } = useAuth();
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">(
    "idle",
  );

  // Seat-availability data for every course in the current plan. Fetched
  // from /api/{state}/sections-for-courses whenever the set of course codes
  // changes. A Map keyed by 'BIOL 1010' style so SemesterColumn can index it.
  const [seatsByCode, setSeatsByCode] = useState<Map<string, SeatSummary>>(
    () => new Map(),
  );
  const [anyStale, setAnyStale] = useState(false);

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

  // Stable key for the current plan's course codes — used to gate the
  // seat-fetch effect so it only re-runs when the set of courses actually
  // changes, not on every render. Sorted so order-independent.
  const planCodesKey = useMemo(() => {
    return plan.map((c) => c.code).sort().join("|");
  }, [plan]);

  // Fetch seat availability for every course in the plan. Debounced via the
  // key so rapid target add/remove doesn't fire a request per keystroke.
  useEffect(() => {
    const codes = planCodesKey.split("|").filter(Boolean);
    if (codes.length === 0) {
      setSeatsByCode(new Map());
      setAnyStale(false);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const param = codes.map((c) => c.replace(/ /g, "+")).join(",");
        const res = await fetch(
          `/api/${state}/sections-for-courses?codes=${encodeURIComponent(param)}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as { courses: SeatSummary[] };
        if (cancelled) return;
        const next = new Map<string, SeatSummary>();
        let stale = false;
        for (const s of data.courses ?? []) {
          next.set(s.course_code, s);
          if (s.is_stale) stale = true;
        }
        setSeatsByCode(next);
        setAnyStale(stale);
      } catch {
        // Non-fatal — the planner still works without seat data, badges
        // just don't render.
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [planCodesKey, state]);

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
        <div className="flex items-center gap-4 text-sm flex-wrap">
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

          {/* Save plan button — mirrors components/schedule/ScheduleResults.tsx
              pattern: openLoginModal() when not signed in; idle/saving/saved
              state; emerald confirmation, reverts after 3s. */}
          <div className="ml-auto">
            <button
              type="button"
              onClick={async () => {
                if (!user) { openLoginModal(); return; }
                setSaveStatus("saving");
                try {
                  const supabase = createClient();
                  // Default name = comma-joined target codes, or fall back to
                  // initialName when this is a "Duplicate to edit" flow.
                  const fallback = targets.length > 0
                    ? targets.join(", ")
                    : "My Plan";
                  const name = initialName?.trim() || fallback;
                  const { error } = await supabase.from("saved_plans").insert({
                    user_id: user.id,
                    state,
                    name,
                    target_courses: targets,
                    plan_data: { semesters },
                  });
                  if (error) throw error;
                  setSaveStatus("saved");
                  track("plan_save", {
                    state,
                    targets: targets.length,
                    courses: totalCourses,
                    semesters: totalSemesters,
                  });
                  setTimeout(() => setSaveStatus("idle"), 3000);
                } catch {
                  setSaveStatus("idle");
                }
              }}
              disabled={saveStatus === "saving" || saveStatus === "saved"}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                saveStatus === "saved"
                  ? "border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400"
                  : "border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700"
              }`}
            >
              {saveStatus === "saved" ? (
                <>
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  Saved
                </>
              ) : saveStatus === "saving" ? (
                "Saving..."
              ) : (
                <>
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
                  </svg>
                  {user ? "Save plan" : "Sign in to save"}
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Semester flowchart */}
      {semesters.length > 0 ? (
        <>
          {/* Stale-data banner — matches the 3-day staleness convention used by
              app/[state]/college/[id]/CollegeTermSection.tsx. Reduces user
              confidence in seat counts when the underlying scrape is old. */}
          {anyStale && (
            <div className="rounded-lg border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-900/20 px-4 py-2 text-xs text-amber-800 dark:text-amber-300">
              Seat counts shown may be outdated (last updated more than 3 days
              ago for one or more courses).
            </div>
          )}
          <FlowStyles />
          <div className="overflow-x-auto pb-3 -mx-1 px-1">
            <div className="flex items-start">
              {semesters.map(([semester, courses], idx) => (
                <Fragment key={semester}>
                  {idx > 0 && <SemesterConnector />}
                  <SemesterColumn
                    semester={semester}
                    courses={courses}
                    isLast={idx === semesters.length - 1}
                    onRemove={removeTarget}
                    seatsByCode={seatsByCode}
                  />
                </Fragment>
              ))}
            </div>
          </div>
        </>
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

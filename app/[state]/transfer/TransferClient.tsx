"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { TransferMapping } from "@/lib/types";
import TransferCompare from "./TransferCompare";

interface Props {
  universities: { slug: string; name: string }[];
  mappings: TransferMapping[];
  courseAvailability: Record<
    string,
    { colleges: string[]; totalSections: number }
  >;
  defaultUniversity: string;
  state: string;
  popularCourses: string[];
}

type ViewMode = "browse" | "compare";
type GroupMode = "outcome" | "subject";

export default function TransferClient({
  universities,
  mappings,
  courseAvailability,
  defaultUniversity,
  state,
  popularCourses,
}: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>("browse");
  const [selectedUniversity, setSelectedUniversity] = useState(defaultUniversity);
  const [subjectFilter, setSubjectFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<
    "" | "direct" | "elective" | "no-credit"
  >("");
  const [availableOnly, setAvailableOnly] = useState(false);
  const [groupMode, setGroupMode] = useState<GroupMode>("outcome");

  // Filter mappings by selected university first
  const universityMappings = useMemo(() => {
    return mappings.filter((m) => m.university === selectedUniversity);
  }, [mappings, selectedUniversity]);

  // Get unique subjects from university-filtered mappings
  const subjects = useMemo(() => {
    const s = new Set(universityMappings.map((m) => m.cc_prefix));
    return Array.from(s).sort();
  }, [universityMappings]);

  // Apply additional filters
  const filtered = useMemo(() => {
    return universityMappings.filter((m) => {
      if (subjectFilter && m.cc_prefix !== subjectFilter) return false;
      if (typeFilter === "direct" && (m.no_credit || m.is_elective))
        return false;
      if (typeFilter === "elective" && (!m.is_elective || m.no_credit))
        return false;
      if (typeFilter === "no-credit" && !m.no_credit) return false;
      if (availableOnly) {
        const key = `${m.cc_prefix}-${m.cc_number}`;
        if (!courseAvailability[key]) return false;
      }
      return true;
    });
  }, [universityMappings, subjectFilter, typeFilter, availableOnly, courseAvailability]);

  // Group by subject prefix
  const groupedBySubject = useMemo(() => {
    const map = new Map<string, TransferMapping[]>();
    for (const m of filtered) {
      if (!map.has(m.cc_prefix)) map.set(m.cc_prefix, []);
      map.get(m.cc_prefix)!.push(m);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  // Group by transfer outcome
  const groupedByOutcome = useMemo(() => {
    const direct: TransferMapping[] = [];
    const elective: TransferMapping[] = [];
    const noCredit: TransferMapping[] = [];
    for (const m of filtered) {
      if (m.no_credit) noCredit.push(m);
      else if (m.is_elective) elective.push(m);
      else direct.push(m);
    }
    return [
      {
        key: "direct",
        title: "Direct match",
        subtitle: "Transfers as a named equivalent course at the destination university.",
        tone: "teal" as const,
        courses: direct,
      },
      {
        key: "elective",
        title: "Elective credit only",
        subtitle: "Credit transfers as general elective, not as a specific named course.",
        tone: "amber" as const,
        courses: elective,
      },
      {
        key: "no-credit",
        title: "No credit",
        subtitle: "Does not transfer for credit. Shown for transparency.",
        tone: "rose" as const,
        courses: noCredit,
      },
    ].filter((g) => g.courses.length > 0);
  }, [filtered]);

  // Stats (based on selected university's mappings)
  const stats = useMemo(() => {
    const direct = universityMappings.filter((m) => !m.no_credit && !m.is_elective).length;
    const elective = universityMappings.filter((m) => m.is_elective && !m.no_credit).length;
    const noCredit = universityMappings.filter((m) => m.no_credit).length;
    const available = universityMappings.filter((m) => {
      const key = `${m.cc_prefix}-${m.cc_number}`;
      return courseAvailability[key] && !m.no_credit;
    }).length;
    return { direct, elective, noCredit, total: universityMappings.length, available };
  }, [universityMappings, courseAvailability]);

  const uniName =
    universities.find((u) => u.slug === selectedUniversity)?.name ||
    selectedUniversity;

  // Shared row renderer used by both group modes
  function renderCourseRow(m: TransferMapping, i: number, showOutcomeBadge: boolean) {
    const key = `${m.cc_prefix}-${m.cc_number}`;
    const availability = courseAvailability[key];

    return (
      <div
        key={i}
        className={`px-4 py-3 ${m.no_credit ? "bg-gray-50 dark:bg-slate-800 opacity-60" : ""}`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
          {/* Left: CC course → University course */}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-gray-900 dark:text-slate-100">
                {m.cc_course}
              </span>
              {!m.no_credit && (
                <>
                  <span className="text-gray-400 dark:text-slate-500">&rarr;</span>
                  <span
                    className={`font-medium ${
                      m.is_elective
                        ? "text-amber-700 dark:text-amber-400"
                        : "text-teal-700 dark:text-teal-400"
                    }`}
                  >
                    {m.univ_course}
                  </span>
                </>
              )}
              {m.no_credit && (
                <span className="text-xs text-rose-600 dark:text-rose-400 font-medium">
                  No {uniName} credit
                </span>
              )}
            </div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
              {m.cc_title}
              {!m.no_credit && m.univ_title && (
                <span className="text-gray-400 dark:text-slate-500">
                  {" "}
                  &rarr; {m.univ_title}
                </span>
              )}
            </div>
            {m.notes && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">
                {m.notes}
              </p>
            )}
          </div>

          {/* Right: credits + badge + availability */}
          <div className="flex items-center gap-3 shrink-0">
            {!m.no_credit && (
              <span className="text-xs text-gray-400 dark:text-slate-500">
                {m.cc_credits} cr &rarr; {m.univ_credits} cr
              </span>
            )}
            {showOutcomeBadge && m.is_elective && !m.no_credit && (
              <span className="inline-flex items-center rounded-full bg-amber-50 dark:bg-amber-900/30 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400 ring-1 ring-inset ring-amber-200 dark:ring-amber-800">
                Elective credit only
              </span>
            )}
            {showOutcomeBadge && !m.is_elective && !m.no_credit && (
              <span className="inline-flex items-center rounded-full bg-teal-50 dark:bg-teal-900/30 px-2 py-0.5 text-[10px] font-medium text-teal-700 dark:text-teal-400 ring-1 ring-inset ring-teal-200 dark:ring-teal-800">
                Direct match
              </span>
            )}
            {showOutcomeBadge && m.no_credit && (
              <span className="inline-flex items-center rounded-full bg-rose-50 dark:bg-rose-900/30 px-2 py-0.5 text-[10px] font-medium text-rose-700 dark:text-rose-400 ring-1 ring-inset ring-rose-200 dark:ring-rose-800">
                No credit
              </span>
            )}
            {/* Availability badge */}
            {!m.no_credit && (
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${
                  availability
                    ? "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 ring-emerald-200 dark:ring-emerald-800"
                    : "bg-gray-50 dark:bg-slate-800 text-gray-500 dark:text-slate-400 ring-gray-200 dark:ring-slate-700"
                }`}
              >
                {availability ? "Available now" : "Not offered"}
              </span>
            )}
            {/* Detail link */}
            {availability && !m.no_credit && (
              <Link
                href={`/${state}/courses?q=${m.cc_prefix}+${m.cc_number}`}
                className="text-[10px] text-teal-600 hover:text-teal-800 hover:underline whitespace-nowrap"
              >
                {availability.totalSections} sections at{" "}
                {availability.colleges.length}{" "}
                {availability.colleges.length === 1
                  ? "college"
                  : "colleges"}{" "}
                &rarr;
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* ── View mode toggle ── */}
      <div className="mb-6 flex items-center gap-1 rounded-lg bg-gray-100 dark:bg-slate-800 p-1 w-fit">
        <button
          onClick={() => setViewMode("browse")}
          className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            viewMode === "browse"
              ? "bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 shadow-sm"
              : "text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300"
          }`}
        >
          Browse by university
        </button>
        <button
          onClick={() => setViewMode("compare")}
          className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            viewMode === "compare"
              ? "bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 shadow-sm"
              : "text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300"
          }`}
        >
          Compare universities
        </button>
      </div>

      {/* ── Compare view ── */}
      {viewMode === "compare" ? (
        <TransferCompare
          universities={universities}
          mappings={mappings}
          courseAvailability={courseAvailability}
          state={state}
          popularCourses={popularCourses}
        />
      ) : (
      <>
      {/* University selector */}
      <div className="mb-6">
        <label className="text-sm font-medium text-gray-700 dark:text-slate-300 mr-2">
          I want to transfer to:
        </label>
        <select
          value={selectedUniversity}
          onChange={(e) => {
            setSelectedUniversity(e.target.value);
            setSubjectFilter("");
            setTypeFilter("");
          }}
          className="rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-2 text-sm font-medium text-gray-900 dark:text-slate-100 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-200"
        >
          {universities.map((u) => (
            <option key={u.slug} value={u.slug}>
              {u.name}
            </option>
          ))}
        </select>
      </div>

      {/* Stats banner */}
      <div className="mb-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-900/30 p-4 text-center">
          <p className="text-2xl font-bold text-teal-700 dark:text-teal-400">{stats.direct}</p>
          <p className="text-xs text-teal-600 dark:text-teal-500">Direct Matches</p>
        </div>
        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 p-4 text-center">
          <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">{stats.elective}</p>
          <p className="text-xs text-amber-600 dark:text-amber-500">Elective Only</p>
        </div>
        <div className="rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/30 p-4 text-center">
          <p className="text-2xl font-bold text-rose-700 dark:text-rose-400">{stats.noCredit}</p>
          <p className="text-xs text-rose-600 dark:text-rose-500">No Credit</p>
        </div>
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/30 p-4 text-center">
          <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">
            {stats.available}
          </p>
          <p className="text-xs text-emerald-600 dark:text-emerald-500">Available Now</p>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 p-4">
        <div className="min-w-[140px]">
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">
            Subject
          </label>
          <select
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
            className="w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm dark:text-slate-100 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-200"
          >
            <option value="">All Subjects ({subjects.length})</option>
            {subjects.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-[160px]">
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">
            Transfer Type
          </label>
          <select
            value={typeFilter}
            onChange={(e) =>
              setTypeFilter(
                e.target.value as "" | "direct" | "elective" | "no-credit"
              )
            }
            className="w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm dark:text-slate-100 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-200"
          >
            <option value="">All Types</option>
            <option value="direct">Direct Matches Only</option>
            <option value="elective">Elective Credit Only</option>
            <option value="no-credit">No Credit</option>
          </select>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={availableOnly}
            onChange={(e) => setAvailableOnly(e.target.checked)}
            className="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
          />
          <span className="text-sm text-gray-700 dark:text-slate-300">
            Available this term only
          </span>
        </label>

        {/* Group by toggle */}
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs font-medium text-gray-500 dark:text-slate-400">Group by:</span>
          <button
            onClick={() => setGroupMode("outcome")}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
              groupMode === "outcome"
                ? "bg-gray-900 dark:bg-slate-100 text-white dark:text-slate-900"
                : "bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-400 ring-1 ring-inset ring-gray-300 dark:ring-slate-600 hover:bg-gray-100 dark:hover:bg-slate-700"
            }`}
          >
            Transfer outcome
          </button>
          <button
            onClick={() => setGroupMode("subject")}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
              groupMode === "subject"
                ? "bg-gray-900 dark:bg-slate-100 text-white dark:text-slate-900"
                : "bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-400 ring-1 ring-inset ring-gray-300 dark:ring-slate-600 hover:bg-gray-100 dark:hover:bg-slate-700"
            }`}
          >
            Subject
          </button>
        </div>
      </div>

      {/* Glossary — 3 cards */}
      <div className="mb-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-lg border border-teal-200 dark:border-teal-800 bg-white dark:bg-slate-800 p-3">
          <p className="text-xs font-semibold text-teal-700 dark:text-teal-400">Direct match</p>
          <p className="mt-1 text-xs leading-relaxed text-gray-600 dark:text-slate-400">
            Transfers as a named equivalent course at the destination university.
          </p>
        </div>
        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-white dark:bg-slate-800 p-3">
          <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">Elective credit only</p>
          <p className="mt-1 text-xs leading-relaxed text-gray-600 dark:text-slate-400">
            Credit transfers as general elective, not a specific course. Confirm with your advisor.
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
          <p className="text-xs font-semibold text-gray-700 dark:text-slate-300">Important</p>
          <p className="mt-1 text-xs leading-relaxed text-gray-600 dark:text-slate-400">
            Always confirm final transfer decisions with your destination school before enrolling.
          </p>
        </div>
      </div>

      {/* Results */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 dark:border-slate-600 py-12 text-center">
          <p className="text-gray-500 dark:text-slate-400">No courses match your filters.</p>
        </div>
      ) : groupMode === "outcome" ? (
        /* ── Grouped by transfer outcome ── */
        <div className="space-y-6">
          {groupedByOutcome.map((group) => {
            const toneColors = {
              teal: "text-teal-700 dark:text-teal-400 border-teal-200",
              amber: "text-amber-700 dark:text-amber-400 border-amber-200",
              rose: "text-rose-700 dark:text-rose-400 border-rose-200",
            };
            const headerColor = toneColors[group.tone];

            return (
              <div key={group.key}>
                {/* Outcome group header */}
                <div className="mb-2 flex items-end justify-between gap-4 border-b border-gray-200 dark:border-slate-700 pb-2">
                  <div>
                    <h3 className={`text-sm font-semibold ${headerColor.split(" ")[0]}`}>
                      {group.title}
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{group.subtitle}</p>
                  </div>
                  <span className="text-xs text-gray-400 dark:text-slate-500 whitespace-nowrap">
                    {group.courses.length} {group.courses.length === 1 ? "course" : "courses"}
                  </span>
                </div>

                {/* Course rows — no per-row outcome badge needed since group header provides context */}
                <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 divide-y divide-gray-100 dark:divide-slate-800 overflow-hidden">
                  {group.courses.map((m, i) => renderCourseRow(m, i, false))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ── Grouped by subject ── */
        <div className="space-y-6">
          {groupedBySubject.map(([prefix, courses]) => (
            <div key={prefix}>
              {/* Subject header */}
              <h3 className="text-sm font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                <span>{prefix}</span>
                <span className="h-px flex-1 bg-gray-200 dark:bg-slate-700" />
                <span className="font-normal text-gray-400 dark:text-slate-500">
                  {courses.length} courses
                </span>
              </h3>

              {/* Course rows — show per-row outcome badge since group doesn't indicate type */}
              <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden">
                {courses.map((m, i) => renderCourseRow(m, i, true))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Result count */}
      <p className="mt-4 text-xs text-gray-400 dark:text-slate-500 text-center">
        {filtered.length} courses shown
      </p>
      </>
      )}
    </div>
  );
}

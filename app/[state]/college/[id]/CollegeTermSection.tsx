"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import CollegeDetailClient from "./CollegeDetailClient";
import { termLabel } from "@/lib/term-label";
import { isInProgress } from "@/lib/course-status";
import { subjectName } from "@/lib/subjects";
import type { CourseSection, Institution } from "@/lib/types";

type TransferLookup = Record<
  string,
  { university: string; type: "direct" | "elective" | "no-credit"; course: string }[]
>;

interface TopInstructor {
  slug: string;
  displayName: string;
  sectionCount: number;
}

interface Props {
  /** Trimmed course sections grouped by term code. */
  coursesByTerm: Record<string, CourseSection[]>;
  /** All terms that have at least one section for this college, sorted ascending. */
  termsWithData: string[];
  /** Term rendered on the server and used when URL has no `?term=`. */
  defaultTerm: string;
  /** Staleness flag per term (set when most recent scrape > 3 days old). */
  staleByTerm: Record<string, boolean>;
  /** Top instructors computed per term. */
  topInstructorsByTerm: Record<string, TopInstructor[]>;
  /** Per-term course-discovery URL template (uses __PREFIX__/__NUMBER__). */
  courseListingUrlByTerm: Record<string, string>;
  /** Transfer lookup filtered to the union of courses across all shipped terms. */
  transferLookup?: TransferLookup;
  institution: Institution;
  collegeSlug: string;
  state: string;
  id: string;
  systemName: string;
  /** External URL linking to the state system's per-college course site. */
  systemCollegeCoursesUrl: string;
}

export default function CollegeTermSection({
  coursesByTerm: initialCoursesByTerm,
  termsWithData,
  defaultTerm,
  staleByTerm,
  topInstructorsByTerm,
  courseListingUrlByTerm,
  transferLookup,
  institution,
  collegeSlug,
  state,
  id,
  systemName,
  systemCollegeCoursesUrl,
}: Props) {
  // Server (and initial client hydration) always renders the default term so
  // the page stays fully prerendered and edge-cacheable. We subscribe to
  // popstate + run once on mount to pick up `?term=` deep links and browser
  // back/forward navigation, updating state outside the hydration path.
  const [currentTerm, setCurrentTerm] = useState(defaultTerm);

  // Client-side cache: starts with the server-provided default term data;
  // other terms are fetched on demand from /api/{state}/college/{id}/courses.
  const [coursesByTerm, setCoursesByTerm] = useState(initialCoursesByTerm);
  const [loadingTerm, setLoadingTerm] = useState(false);
  const pendingFetches = useRef(new Set<string>());

  useEffect(() => {
    if (coursesByTerm[currentTerm] || pendingFetches.current.has(currentTerm)) return;
    pendingFetches.current.add(currentTerm);
    Promise.resolve().then(() => setLoadingTerm(true));
    fetch(`/api/${state}/college/${id}/courses?term=${encodeURIComponent(currentTerm)}`)
      .then((r) => r.json())
      .then((data: { courses: CourseSection[] }) => {
        setCoursesByTerm((prev) => ({ ...prev, [currentTerm]: data.courses }));
      })
      .finally(() => setLoadingTerm(false));
  }, [currentTerm, state, id, coursesByTerm]);

  useEffect(() => {
    function readTermFromUrl() {
      const params = new URLSearchParams(window.location.search);
      const t = params.get("term");
      setCurrentTerm(t && termsWithData.includes(t) ? t : defaultTerm);
    }
    window.addEventListener("popstate", readTermFromUrl);
    readTermFromUrl();
    return () => window.removeEventListener("popstate", readTermFromUrl);
  }, [defaultTerm, termsWithData]);

  function handleTermChange(newTerm: string) {
    setCurrentTerm(newTerm);
    // Update the URL for shareability without triggering a Next.js RSC
    // refetch. Using router.push/replace would navigate and force an RSC
    // request; since the server no longer reads ?term=, that round-trip would
    // be wasted. history.replaceState keeps the URL correct and the page
    // responsive without any network request.
    const url = new URL(window.location.href);
    if (newTerm === defaultTerm) {
      url.searchParams.delete("term");
    } else {
      url.searchParams.set("term", newTerm);
    }
    window.history.replaceState(null, "", url.toString());
  }

  const courses = coursesByTerm[currentTerm] ?? [];
  const stale = staleByTerm[currentTerm] ?? false;
  const topInstructors = topInstructorsByTerm[currentTerm] ?? [];
  const courseListingUrl = courseListingUrlByTerm[currentTerm];

  const subjects = Array.from(
    new Set(courses.map((c) => c.course_prefix))
  ).sort();

  const upcoming = courses.filter((c) => !isInProgress(c.start_date)).length;
  const started = courses.length - upcoming;

  // Quick-filter chip state — drives defaultStatusFilter / defaultModeFilter on
  // CollegeDetailClient. Keying CollegeDetailClient on this resets CourseTable
  // filter state each time the chip changes.
  const [quickFilter, setQuickFilter] = useState<"" | "open" | "online">("");

  const quickStatusFilter = quickFilter === "open" ? "upcoming" : "";
  const quickModeFilter = quickFilter === "online" ? "online" : "";

  return (
    <>
      {/* Staleness warning */}
      {stale && courses.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4 mb-4">
          <p className="text-amber-800 dark:text-amber-300 text-sm">
            <strong>Note:</strong> Course data may be outdated (last updated
            more than 3 days ago). Check{" "}
            <a
              href={systemCollegeCoursesUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              {institution.name} course site
            </a>{" "}
            for the latest listings.
          </p>
        </div>
      )}

      {/* TERM BRIDGE BAR — term tabs + section counts + quick-filter chips */}
      <section className="border-y border-gray-200 dark:border-slate-700 bg-gradient-to-b from-teal-50/50 dark:from-teal-900/10 to-transparent -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-4 mb-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          {/* Left: term picker + counts */}
          <div className="flex flex-wrap items-end gap-4">
            {/* Term tabs */}
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-slate-500 mb-1.5">Term</p>
              <div className="flex items-center gap-1">
                {termsWithData.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => handleTermChange(t)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      t === currentTerm
                        ? "bg-gray-900 dark:bg-slate-100 text-white dark:text-slate-900"
                        : "text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700"
                    }`}
                  >
                    {termLabel(t)}
                  </button>
                ))}
              </div>
            </div>

            {/* Section counts */}
            {courses.length > 0 && (
              <div className="hidden sm:flex items-baseline gap-2 pb-0.5">
                <span className="w-px h-8 bg-gray-200 dark:bg-slate-700 self-center" />
                <span className="text-3xl font-semibold tracking-tight text-gray-900 dark:text-slate-100">{courses.length}</span>
                <span className="text-sm text-gray-500 dark:text-slate-400">sections</span>
                {upcoming > 0 && (
                  <>
                    <span className="text-gray-300 dark:text-slate-600">·</span>
                    <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">{upcoming} open</span>
                    <span className="text-gray-300 dark:text-slate-600">·</span>
                    <span className="text-sm text-gray-500 dark:text-slate-400">{started} in progress</span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Right: quick-filter chips */}
          {courses.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {(["", "open", "online"] as const).map((f) => {
                const label = f === "" ? "All" : f === "open" ? "Open only" : "Online";
                const active = quickFilter === f;
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setQuickFilter(f)}
                    className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${
                      active
                        ? "border-teal-600 bg-teal-600 text-white"
                        : "border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-300 hover:border-teal-400 dark:hover:border-teal-600"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
              <a
                href={systemCollegeCoursesUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 ml-1"
              >
                View at {institution.name} ↗
              </a>
            </div>
          )}
        </div>

        {/* Loading indicator while fetching a non-default term */}
        {loadingTerm && (
          <div className="mt-3 flex items-center gap-2 text-sm text-gray-500 dark:text-slate-400">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-teal-600" />
            Loading courses…
          </div>
        )}
      </section>

      {/* Course Listings */}
      <section>
        {courses.length === 0 ? (
          <div className="bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg p-8 text-center">
            <p className="text-gray-600 dark:text-slate-400 mb-2">
              No course data available for this term.
            </p>
            <a
              href={systemCollegeCoursesUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-teal-600 hover:underline text-sm"
            >
              {`Check the ${institution.name} course site directly →`}
            </a>
          </div>
        ) : (
          <CollegeDetailClient
            // keyed on term+quickFilter so filter/sort state resets on both changes
            key={`${currentTerm}-${quickFilter}`}
            courses={courses}
            institution={institution}
            collegeSlug={collegeSlug}
            transferLookup={transferLookup}
            systemName={systemName}
            courseListingUrl={courseListingUrl}
            state={state}
            defaultStatusFilter={quickStatusFilter}
            defaultModeFilter={quickModeFilter}
          />
        )}
      </section>

      {/* Browse by Subject */}
      {courses.length > 0 && subjects.length >= 2 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-3">
            Browse by Subject
          </h2>
          <div className="flex flex-wrap gap-2">
            {subjects.map((prefix) => {
              const count = courses.filter(
                (c) => c.course_prefix === prefix
              ).length;
              return (
                <Link
                  key={prefix}
                  href={`/${state}/college/${id}/courses/${prefix.toLowerCase()}`}
                  className="inline-flex items-center gap-1.5 rounded-md bg-gray-100 dark:bg-slate-700 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-slate-300 hover:bg-teal-100 dark:hover:bg-teal-900/40 hover:text-teal-700 dark:hover:text-teal-400 transition-colors"
                >
                  {subjectName(prefix)}
                  <span className="text-gray-400 dark:text-slate-500">
                    ({count})
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Browse Instructors */}
      {topInstructors.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-3">
            Browse Instructors
          </h2>
          <div className="flex flex-wrap gap-2">
            {topInstructors.map((inst) => (
              <Link
                key={inst.slug}
                href={`/${state}/college/${id}/instructor/${inst.slug}`}
                className="rounded-full border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-slate-300 hover:border-teal-300 dark:hover:border-teal-700 hover:text-teal-700 dark:hover:text-teal-400 transition"
              >
                {inst.displayName}
                <span className="text-gray-400 dark:text-slate-500 ml-1">
                  ({inst.sectionCount})
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

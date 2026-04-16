"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import CollegeDetailClient from "./CollegeDetailClient";
import TermSelector from "./TermSelector";
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
  coursesByTerm,
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

  return (
    <>
      {/* Staleness warning */}
      {stale && courses.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4 mb-6">
          <p className="text-amber-800 dark:text-amber-300 text-sm">
            <strong>Note:</strong> Course data may be outdated (last updated
            more than 3 days ago). Check{" "}
            <a
              href={systemCollegeCoursesUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              {systemName} course site
            </a>{" "}
            for the latest listings.
          </p>
        </div>
      )}

      {/* Course Listings */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100">
              {termLabel(currentTerm)} Courses{" "}
              <span className="text-gray-500 dark:text-slate-400 font-normal text-base">
                ({courses.length} sections)
              </span>
            </h2>
            {termsWithData.length > 1 && (
              <TermSelector
                terms={termsWithData.map((t) => ({
                  code: t,
                  label: termLabel(t),
                }))}
                currentTerm={currentTerm}
                onTermChange={handleTermChange}
              />
            )}
          </div>
          <a
            href={systemCollegeCoursesUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-teal-600 hover:text-teal-700"
          >
            {`View on ${systemName} →`}
          </a>
        </div>

        {/* Registration status summary */}
        {courses.length > 0 &&
          (upcoming > 0 ? (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/30 px-4 py-2.5 text-sm">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
              <span className="text-emerald-800 dark:text-emerald-400">
                <strong>{upcoming}</strong>{" "}
                {upcoming === 1 ? "section" : "sections"} still open for
                registration
              </span>
              <span className="text-emerald-600">·</span>
              <span className="text-emerald-600">
                {started} already in progress
              </span>
            </div>
          ) : (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 px-4 py-2.5 text-sm">
              <span className="inline-block h-2 w-2 rounded-full bg-gray-300 dark:bg-slate-600" />
              <span className="text-gray-600 dark:text-slate-400">
                All {started} sections have already started
              </span>
            </div>
          ))}

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
              {`Check ${systemName} course site directly →`}
            </a>
          </div>
        ) : (
          <CollegeDetailClient
            // keyed on term so filter/sort state in the inner tree resets when
            // the user switches terms (pinned CRNs from another term wouldn't
            // match the new course list)
            key={currentTerm}
            courses={courses}
            institution={institution}
            collegeSlug={collegeSlug}
            transferLookup={transferLookup}
            systemName={systemName}
            courseListingUrl={courseListingUrl}
            state={state}
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

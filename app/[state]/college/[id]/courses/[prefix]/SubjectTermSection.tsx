"use client";

import { useEffect, useState } from "react";
import CollegeDetailClient from "../../CollegeDetailClient";
import TermSelector from "../../TermSelector";
import { termLabel } from "@/lib/term-label";
import type { CourseSection, Institution } from "@/lib/types";

type TransferLookup = Record<
  string,
  { university: string; type: "direct" | "elective" | "no-credit"; course: string }[]
>;

interface Props {
  /** Trimmed course sections for this prefix, grouped by term. */
  coursesByTerm: Record<string, CourseSection[]>;
  /** Terms that have at least one section of this prefix for this college. */
  termsWithData: string[];
  defaultTerm: string;
  /** Per-term course-discovery URL template (uses __PREFIX__/__NUMBER__). */
  courseListingUrlByTerm: Record<string, string>;
  /** Transfer lookup filtered to the union of courses across all shipped terms. */
  transferLookup?: TransferLookup;
  institution: Institution;
  systemName: string;
  state: string;
}

export default function SubjectTermSection({
  coursesByTerm,
  termsWithData,
  defaultTerm,
  courseListingUrlByTerm,
  transferLookup,
  institution,
  systemName,
  state,
}: Props) {
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
    const url = new URL(window.location.href);
    if (newTerm === defaultTerm) {
      url.searchParams.delete("term");
    } else {
      url.searchParams.set("term", newTerm);
    }
    window.history.replaceState(null, "", url.toString());
  }

  const courses = coursesByTerm[currentTerm] ?? [];
  const courseListingUrl = courseListingUrlByTerm[currentTerm];

  // Mode counts recomputed client-side — cheap relative to what we already ship
  const onlineCount = courses.filter((c) => c.mode === "online").length;
  const hybridCount = courses.filter((c) => c.mode === "hybrid").length;
  const inPersonCount = courses.filter((c) => c.mode === "in-person").length;
  const eveningCount = courses.filter((c) => {
    if (!c.start_time) return false;
    const hour = parseInt(c.start_time.split(":")[0]);
    const isPM = c.start_time.toLowerCase().includes("pm");
    return isPM && hour >= 5 && hour !== 12;
  }).length;

  const uniqueCourses = new Set(
    courses.map((c) => `${c.course_prefix} ${c.course_number}`)
  ).size;

  return (
    <>
      {/* Term-scoped section header */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <p className="text-gray-600 dark:text-slate-400 text-sm">
          {termLabel(currentTerm)} &middot; {courses.length} sections across{" "}
          {uniqueCourses} courses
        </p>
        {termsWithData.length > 1 && (
          <TermSelector
            terms={termsWithData.map((t) => ({ code: t, label: termLabel(t) }))}
            currentTerm={currentTerm}
            onTermChange={handleTermChange}
          />
        )}
      </div>

      {/* Stats bar */}
      <div className="flex flex-wrap gap-3 mb-6">
        {inPersonCount > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 dark:bg-teal-900/30 px-3 py-1 text-xs font-medium text-teal-700 dark:text-teal-400 ring-1 ring-inset ring-teal-200 dark:ring-teal-800">
            <span className="h-1.5 w-1.5 rounded-full bg-teal-500" />
            {inPersonCount} In-Person
          </span>
        )}
        {onlineCount > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 dark:bg-blue-900/30 px-3 py-1 text-xs font-medium text-blue-700 dark:text-blue-400 ring-1 ring-inset ring-blue-200 dark:ring-blue-800">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
            {onlineCount} Online
          </span>
        )}
        {hybridCount > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-50 dark:bg-purple-900/30 px-3 py-1 text-xs font-medium text-purple-700 dark:text-purple-400 ring-1 ring-inset ring-purple-200 dark:ring-purple-800">
            <span className="h-1.5 w-1.5 rounded-full bg-purple-500" />
            {hybridCount} Hybrid
          </span>
        )}
        {eveningCount > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 dark:bg-amber-900/30 px-3 py-1 text-xs font-medium text-amber-700 dark:text-amber-400 ring-1 ring-inset ring-amber-200 dark:ring-amber-800">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            {eveningCount} Evening
          </span>
        )}
      </div>

      {/* Course table */}
      <section>
        <CollegeDetailClient
          key={currentTerm}
          courses={courses}
          institution={institution}
          collegeSlug={institution.college_slug}
          transferLookup={transferLookup}
          systemName={systemName}
          courseListingUrl={courseListingUrl}
          state={state}
        />
      </section>
    </>
  );
}

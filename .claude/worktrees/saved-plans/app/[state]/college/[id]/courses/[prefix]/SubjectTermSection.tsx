"use client";

import { useEffect, useRef, useState } from "react";
import CollegeDetailClient from "../../CollegeDetailClient";
import TermSelector from "../../TermSelector";
import { termLabel } from "@/lib/term-label";
import type { CourseSection, Institution } from "@/lib/types";

type TransferLookup = Record<
  string,
  { university: string; type: "direct" | "elective" | "no-credit"; course: string }[]
>;

interface Props {
  /** The term the server prerendered. */
  defaultTerm: string;
  /** Trimmed courses for the default term. */
  defaultCourses: CourseSection[];
  /** Transfer lookup filtered to the default term's courses. */
  defaultTransferLookup?: TransferLookup;
  /** Terms that have at least one section of this prefix for this college. */
  termsWithData: string[];
  /** Per-term course-discovery URL template (uses __PREFIX__/__NUMBER__). */
  courseListingUrlByTerm: Record<string, string>;
  institution: Institution;
  systemName: string;
  state: string;
  /** College `id` from the route — used to build the lazy-load API URL. */
  collegeId: string;
  /** Upper-case subject prefix. */
  prefix: string;
}

interface TermData {
  courses: CourseSection[];
  transferLookup?: TransferLookup;
}

export default function SubjectTermSection({
  defaultTerm,
  defaultCourses,
  defaultTransferLookup,
  termsWithData,
  courseListingUrlByTerm,
  institution,
  systemName,
  state,
  collegeId,
  prefix,
}: Props) {
  const [currentTerm, setCurrentTerm] = useState(defaultTerm);
  // Per-term cache seeded with the server-rendered default term so that
  // toggling back to the default is instant and doesn't re-fetch.
  const [termData, setTermData] = useState<Record<string, TermData>>({
    [defaultTerm]: {
      courses: defaultCourses,
      transferLookup: defaultTransferLookup,
    },
  });
  const [isLoading, setIsLoading] = useState(false);
  // Dedupe concurrent fetches for the same term (e.g. rapid back/forward).
  const inflight = useRef<Map<string, Promise<TermData>>>(new Map());

  async function fetchTerm(term: string): Promise<TermData> {
    const existing = inflight.current.get(term);
    if (existing) return existing;

    const promise = (async () => {
      const res = await fetch(
        `/api/${state}/college/${collegeId}/courses/${prefix.toLowerCase()}?term=${encodeURIComponent(term)}`
      );
      if (!res.ok) {
        throw new Error(`Failed to load ${term}: HTTP ${res.status}`);
      }
      const json = (await res.json()) as TermData;
      return json;
    })();

    inflight.current.set(term, promise);
    try {
      return await promise;
    } finally {
      inflight.current.delete(term);
    }
  }

  async function loadTerm(term: string) {
    if (termData[term]) return; // already cached
    setIsLoading(true);
    try {
      const data = await fetchTerm(term);
      setTermData((prev) =>
        prev[term] ? prev : { ...prev, [term]: data }
      );
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    function readTermFromUrl() {
      const params = new URLSearchParams(window.location.search);
      const t = params.get("term");
      const next = t && termsWithData.includes(t) ? t : defaultTerm;
      setCurrentTerm(next);
      if (next !== defaultTerm) void loadTerm(next);
    }
    window.addEventListener("popstate", readTermFromUrl);
    readTermFromUrl();
    return () => window.removeEventListener("popstate", readTermFromUrl);
    // `loadTerm` is stable enough for this effect's intent — we only re-run
    // when the set of valid terms or the default term changes, not on every
    // render of the arrow function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    void loadTerm(newTerm);
  }

  const cached = termData[currentTerm];
  const courses = cached?.courses ?? [];
  const transferLookup = cached?.transferLookup;
  const courseListingUrl = courseListingUrlByTerm[currentTerm];
  const showingPlaceholder = !cached && isLoading;

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
          {termLabel(currentTerm)} &middot;{" "}
          {showingPlaceholder
            ? "Loading…"
            : `${courses.length} sections across ${uniqueCourses} courses`}
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
        {showingPlaceholder ? (
          <div className="bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg p-8 text-center text-gray-600 dark:text-slate-400 text-sm">
            Loading {termLabel(currentTerm)} sections…
          </div>
        ) : (
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
        )}
      </section>
    </>
  );
}

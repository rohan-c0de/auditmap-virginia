"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import type { CourseMode } from "@/lib/types";
import type { Answer } from "@/lib/search-intent/answer";
import { expandDays } from "@/lib/time-utils";
import { termCodeFromLabel } from "@/lib/term-label";
import dynamic from "next/dynamic";
import DayToggle from "@/components/DayToggle";
import PrereqChain from "@/components/PrereqChain";
import type { ClassificationSummary } from "@/components/AnswerCard";

const AnswerCard = dynamic(() => import("@/components/AnswerCard"), {
  ssr: false,
});
import { useAuth } from "@/lib/hooks/useAuth";
import { createClient } from "@/lib/supabase/client";
import { track } from "@/lib/analytics";
import AdUnit from "@/components/AdUnit";

// ---------------------------------------------------------------------------
// Types matching the API response
// ---------------------------------------------------------------------------

interface SectionResult {
  college_code: string;
  crn: string;
  course_prefix: string;
  course_number: string;
  course_title: string;
  credits: number;
  days: string;
  start_time: string;
  end_time: string;
  campus: string;
  mode: CourseMode;
}

interface CollegeGroup {
  slug: string;
  name: string;
  distance: number | null;
  auditAllowed: boolean | null;
  sections: SectionResult[];
}

interface CourseGroup {
  prefix: string;
  number: string;
  title: string;
  credits: number;
  colleges: CollegeGroup[];
  totalSections: number;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

interface SearchResponse {
  courses: CourseGroup[];
  totalCourses: number;
  totalSections: number;
  totalColleges: number;
}

interface IntentSummary {
  type: string;
  keyword?: string | null;
  course?: { prefix: string; number: string } | null;
  subjectPrefix?: string | null;
  university?: string | null;
  filters?: {
    course?: { prefix: string; number: string } | null;
    days?: string[] | null;
    mode?: string | null;
    timeOfDay?: string | null;
    term?: string | null;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODE_STYLES: Record<CourseMode, { bg: string; text: string; label: string }> = {
  "in-person": { bg: "bg-emerald-50 dark:bg-emerald-900/30", text: "text-emerald-700 dark:text-emerald-400", label: "In-Person" },
  online: { bg: "bg-blue-50 dark:bg-blue-900/30", text: "text-blue-700 dark:text-blue-400", label: "Online" },
  hybrid: { bg: "bg-purple-50 dark:bg-purple-900/30", text: "text-purple-700 dark:text-purple-400", label: "Hybrid" },
  zoom: { bg: "bg-orange-50 dark:bg-orange-900/30", text: "text-orange-700 dark:text-orange-400", label: "Zoom" },
};

// DAY_OPTIONS removed — replaced by DayToggle component

function isValidTime(t: string): boolean {
  return !!t && t !== "TBA" && t !== "0:00 AM" && t !== "0:00 PM";
}

function formatSchedule(s: SectionResult): string {
  const hasTime = isValidTime(s.start_time) && isValidTime(s.end_time);
  if (!s.days && !hasTime) {
    return "Asynchronous / Online";
  }
  const days = s.days ? expandDays(s.days) : "";
  const time = hasTime ? `${s.start_time}\u2013${s.end_time}` : "";
  if (days && time) return `${days} ${time}`;
  if (days) return days;
  if (time) return time;
  return "Asynchronous / Online";
}

// The LLM emits compact single-letter day codes per the classifier prompt
// ("T" for Tuesday, "R" for Thursday, "S"/"U" for weekend). The UI/API use
// 2-char codes ("Tu", "Th", "Sa", "Su"). Map between them when applying
// LLM-extracted day filters; otherwise a query like "tuesday classes"
// silently filters to nothing because "T" doesn't match any section's "Tu".
const LLM_TO_UI_DAY: Record<string, string> = {
  M: "M",
  T: "Tu",
  W: "W",
  R: "Th",
  F: "F",
  S: "Sa",
  U: "Su",
};

function mapLLMDays(llmDays: string[]): string[] {
  return llmDays
    .map((d) => LLM_TO_UI_DAY[d] ?? d)
    .filter((d, i, arr) => arr.indexOf(d) === i);
}

function buildCourseUrl(slug: string, s: SectionResult, courseUrlMap?: Record<string, string>): string {
  if (!courseUrlMap?.[slug]) return "";
  return courseUrlMap[slug]
    .replace("__PREFIX__", s.course_prefix)
    .replace("__NUMBER__", s.course_number);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface CourseSearchProps {
  state: string;
  systemName?: string;
  collegeCount?: number;
  courseUrlMap?: Record<string, string>;
  defaultZip?: string;
}

export default function CourseSearchClient({ state, systemName, collegeCount, courseUrlMap, defaultZip }: CourseSearchProps) {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q")?.replace(/\+/g, " ") || "";
  // Initialize filter state from URL so deep links like
  // /{state}/courses?q=accounting&days=Sa&transfersTo=umass-boston actually
  // apply the filters on first load. Previously only `q` was read and the
  // rest defaulted to empty, which silently dropped every other filter.
  const initialZip = searchParams.get("zip") || "";
  const initialMode = searchParams.get("mode") || "";
  const initialDays = (searchParams.get("days") || "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  const initialTimeOfDay = searchParams.get("timeOfDay") || "";
  const initialTransferTo = searchParams.get("transfersTo") || "";
  const { user, openLoginModal } = useAuth();

  const [query, setQuery] = useState(initialQuery);
  const [zip, setZip] = useState(initialZip);
  const [mode, setMode] = useState(initialMode);
  const [days, setDays] = useState<string[]>(initialDays);
  const [timeOfDay, setTimeOfDay] = useState(initialTimeOfDay);

  // Bookmark state
  const [bookmarkedCourses, setBookmarkedCourses] = useState<Set<string>>(new Set());
  const [bookmarkLoading, setBookmarkLoading] = useState<Set<string>>(new Set());

  // Load bookmarks when user is authenticated
  useEffect(() => {
    if (!user) { setBookmarkedCourses(new Set()); return; }
    const supabase = createClient();
    supabase
      .from("saved_courses")
      .select("course_prefix, course_number")
      .eq("user_id", user.id)
      .eq("state", state)
      .then(({ data }) => {
        if (data) {
          setBookmarkedCourses(new Set(data.map((d) => `${d.course_prefix}-${d.course_number}`)));
        }
      });
  }, [user, state]);

  const [bookmarkError, setBookmarkError] = useState<string | null>(null);

  const toggleBookmark = useCallback(async (course: CourseGroup) => {
    if (!user) { openLoginModal(); return; }
    const key = `${course.prefix}-${course.number}`;
    setBookmarkLoading((prev) => new Set(prev).add(key));
    setBookmarkError(null);
    try {
      const supabase = createClient();
      if (bookmarkedCourses.has(key)) {
        const { error } = await supabase
          .from("saved_courses")
          .delete()
          .eq("user_id", user.id)
          .eq("state", state)
          .eq("course_prefix", course.prefix)
          .eq("course_number", course.number);
        if (error) throw error;
        setBookmarkedCourses((prev) => { const next = new Set(prev); next.delete(key); return next; });
        track("course_bookmark_remove", { state, course: key });
      } else {
        const { error } = await supabase.from("saved_courses").insert({
          user_id: user.id,
          state,
          course_prefix: course.prefix,
          course_number: course.number,
          course_title: course.title,
        });
        if (error) throw error;
        setBookmarkedCourses((prev) => new Set(prev).add(key));
        track("course_bookmark_add", { state, course: key });
      }
    } catch {
      setBookmarkError(`Failed to ${bookmarkedCourses.has(key) ? "remove" : "save"} bookmark. Please try again.`);
      setTimeout(() => setBookmarkError(null), 4000);
    }
    setBookmarkLoading((prev) => { const next = new Set(prev); next.delete(key); return next; });
  }, [user, openLoginModal, bookmarkedCourses, state]);

  const [transferTo, setTransferTo] = useState(initialTransferTo);
  const [transferLookup, setTransferLookup] = useState<Record<string, { university: string; type: string }[]> | null>(null);
  const [universities, setUniversities] = useState<{ slug: string; name: string }[]>([]);

  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  // Natural-language answer card. Populated from /api/[state]/ask in
  // parallel with the course search; null until a query has resolved or
  // when the classifier returned a non-actionable intent.
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [secondaryAnswer, setSecondaryAnswer] = useState<Answer | null>(null);
  const [classification, setClassification] = useState<ClassificationSummary | null>(null);

  // Fetch transfer lookup data on mount (small, cached 24h)
  useEffect(() => {
    fetch(`/api/${state}/transfer/lookup`)
      .then((r) => r.json())
      .then((data) => {
        setTransferLookup(data.lookup);
        setUniversities(data.universities);
      })
      .catch(() => {}); // silently fail — filter just won't appear
  }, [state]);

  // Track which college groups are expanded (keyed by "courseKey-slug")
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Pagination
  const [displayLimit, setDisplayLimit] = useState(10);

  const doSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim() || searchQuery.trim().length < 2) {
      setError("Enter at least 2 characters to search.");
      return;
    }

    setLoading(true);
    setError("");
    setHasSearched(true);
    setDisplayLimit(10);
    // Reset previous answer card before either fetch resolves so a stale
    // card never lingers under a new query.
    setAnswer(null);
    setSecondaryAnswer(null);
    setClassification(null);

    const trimmed = searchQuery.trim();
    // The user query may be natural language ("Computer Science classes on
    // wednesday"). The keyword course-search can't parse that — it would
    // try to match the whole sentence against course titles and return 0
    // results. We await the LLM classifier first and use its extracted
    // entities (course code, keyword, days, mode, timeOfDay) to drive the
    // search. Falls back to the raw query when /ask fails or extracts
    // nothing useful. /ask is rate-limited and cached, so the latency hit
    // is small for repeat queries.
    let searchQ = trimmed;
    let llmDays: string[] | null = null;
    let llmMode: string | null = null;
    let llmTimeOfDay: string | null = null;
    let llmTransferTo: string | null = null;
    let llmTermCode: string | null = null;
    try {
      const askRes = await fetch(
        `/api/${state}/ask?q=${encodeURIComponent(trimmed)}`,
      );
      if (askRes.ok) {
        const askData: {
          answer?: Answer;
          secondaryAnswer?: Answer;
          classification?: ClassificationSummary & {
            intent?: IntentSummary;
            secondaryIntent?: IntentSummary | null;
          };
        } | null = await askRes.json();
        if (askData?.answer) setAnswer(askData.answer);
        if (askData?.secondaryAnswer) setSecondaryAnswer(askData.secondaryAnswer);
        if (askData?.classification) setClassification(askData.classification);

        const intent = askData?.classification?.intent;
        if (intent?.type === "course") {
          // Refine q: course code beats keyword beats raw query.
          if (intent.filters?.course) {
            searchQ = `${intent.filters.course.prefix} ${intent.filters.course.number}`;
          } else if (intent.keyword) {
            searchQ = intent.keyword;
          }
          // Capture filter extractions; we apply them below only if the user
          // hasn't already set the corresponding filter manually (UI wins).
          if (intent.filters?.days?.length) {
            llmDays = mapLLMDays(intent.filters.days);
          }
          if (intent.filters?.mode) llmMode = intent.filters.mode;
          if (intent.filters?.timeOfDay) llmTimeOfDay = intent.filters.timeOfDay;
          // LLM emits term as a label ("Fall 2026"); search API expects the
          // code ("2026FA"). Skip mapping if the label is malformed — backend
          // also validates against actual available terms before applying.
          if (intent.filters?.term) {
            llmTermCode = termCodeFromLabel(intent.filters.term);
          }
        } else if (intent?.type === "transfer") {
          // Transfer intent fires the AnswerCard above, but the course
          // search below still runs. Use the extracted course code and
          // destination to narrow it: a query like "does ENG 111 transfer
          // to GMU?" should show ENG 111 sections filtered to GMU-
          // transferable, alongside the transfer answer.
          if (intent.course) {
            searchQ = `${intent.course.prefix} ${intent.course.number}`;
          } else if (intent.subjectPrefix) {
            searchQ = intent.subjectPrefix;
          }
          if (intent.university) llmTransferTo = intent.university;
        }

        // Merge filters from the secondary intent so compound queries like
        // "online bio class that transfers to UMD" combine both: course
        // filters (mode, days) from one intent and transfer destination
        // from the other.
        const sec = askData?.classification?.secondaryIntent;
        if (sec) {
          if (sec.type === "course") {
            if (!searchQ || searchQ === trimmed) {
              if (sec.filters?.course) {
                searchQ = `${sec.filters.course.prefix} ${sec.filters.course.number}`;
              } else if (sec.keyword) {
                searchQ = sec.keyword;
              }
            }
            if (!llmDays && sec.filters?.days?.length) {
              llmDays = mapLLMDays(sec.filters.days);
            }
            if (!llmMode && sec.filters?.mode) llmMode = sec.filters.mode;
            if (!llmTimeOfDay && sec.filters?.timeOfDay) llmTimeOfDay = sec.filters.timeOfDay;
            if (!llmTermCode && sec.filters?.term) {
              llmTermCode = termCodeFromLabel(sec.filters.term);
            }
          } else if (sec.type === "transfer") {
            if (!searchQ || searchQ === trimmed) {
              if (sec.course) {
                searchQ = `${sec.course.prefix} ${sec.course.number}`;
              } else if (sec.subjectPrefix) {
                searchQ = sec.subjectPrefix;
              }
            }
            if (!llmTransferTo && sec.university) llmTransferTo = sec.university;
          }
        }
      }
    } catch {
      /* silent — no answer card, fall through to raw-query search below */
    }

    // Sync LLM-extracted filters into UI state when the user hasn't set
    // them, so the active filters are visible in the toggle/dropdowns and
    // the user can clear or adjust them. User-set filters take precedence.
    const effectiveDays = days.length > 0 ? days : (llmDays ?? []);
    const effectiveMode = mode || llmMode || "";
    const effectiveTimeOfDay = timeOfDay || llmTimeOfDay || "";
    const effectiveTransferTo = transferTo || llmTransferTo || "";
    if (llmDays && days.length === 0) setDays(effectiveDays);
    if (llmMode && !mode) setMode(effectiveMode);
    if (llmTimeOfDay && !timeOfDay) setTimeOfDay(effectiveTimeOfDay);
    if (llmTransferTo && !transferTo) setTransferTo(effectiveTransferTo);

    try {
      const params = new URLSearchParams({ q: searchQ, limit: "50" });
      if (zip) params.set("zip", zip);
      if (effectiveMode) params.set("mode", effectiveMode);
      if (effectiveDays.length > 0) params.set("days", effectiveDays.join(","));
      if (effectiveTimeOfDay) params.set("timeOfDay", effectiveTimeOfDay);
      // No UI for term yet (Path A): LLM-extracted only. Backend validates
      // the code against the state's actual terms and falls back to current
      // when invalid, so no user-set "term" state to merge with.
      if (llmTermCode) params.set("term", llmTermCode);

      const res = await fetch(`/api/${state}/courses/search?${params}`);
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Search failed.");
        setResults(null);
        setLoading(false);
        return;
      }

      const data: SearchResponse = await res.json();
      setResults(data);

      // Auto-expand first 3 college groups of first course
      const autoExpand = new Set<string>();
      if (data.courses.length > 0) {
        const first = data.courses[0];
        const key = `${first.prefix}-${first.number}`;
        first.colleges.slice(0, 3).forEach((c) => {
          autoExpand.add(`${key}::${c.slug}`);
        });
      }
      setExpanded(autoExpand);
    } catch {
      setError("Failed to search. Please try again.");
      setResults(null);
    }
    setLoading(false);
  }, [state, zip, mode, days, timeOfDay, transferTo]);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    track("course_search_submit", {
      state,
      query: query.trim().slice(0, 80),
      has_zip: !!zip,
      mode: mode || "any",
      days: days.length > 0 ? days.join("") : "any",
      time_of_day: timeOfDay || "any",
    });
    doSearch(query);
  }

  // Auto-search when loaded with ?q= parameter
  useEffect(() => {
    if (initialQuery) {
      doSearch(initialQuery);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleExpand(courseKey: string, slug: string) {
    const id = `${courseKey}::${slug}`;
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Mode summary for results header
  function getModeSummary(): Record<string, number> {
    if (!results) return {};
    const counts: Record<string, number> = {};
    for (const course of results.courses) {
      for (const college of course.colleges) {
        for (const s of college.sections) {
          counts[s.mode] = (counts[s.mode] || 0) + 1;
        }
      }
    }
    return counts;
  }

  // Apply client-side transfer filter
  const filteredCourses = useMemo(() => {
    if (!results) return [];
    if (!transferTo || !transferLookup) return results.courses;
    return results.courses.filter((course) => {
      const key = `${course.prefix}-${course.number}`;
      const entries = transferLookup[key];
      if (!entries) return false;
      return entries.some(
        (e) => e.university === transferTo && e.type !== "no-credit"
      );
    });
  }, [results, transferTo, transferLookup]);

  const displayedCourses = filteredCourses.slice(0, displayLimit);
  const hasMore = displayLimit < filteredCourses.length;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-slate-100">Find a Course</h1>
        <p className="text-gray-600 dark:text-slate-400 mt-1">
          Search across all {collegeCount} {systemName} colleges at once
        </p>
      </div>

      {/* Search form */}
      <form onSubmit={handleSearch} className="mb-8">
        <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm p-5 space-y-4">
          {/* Main search row */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">
                Subject, course number, or keyword
              </label>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder='e.g. "PSY 200", "ENG", "psychology"'
                className="w-full rounded-lg border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-4 py-2.5 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-200"
                maxLength={250}
              />
            </div>
            <div className="w-full sm:w-36">
              <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">
                Zip code <span className="text-gray-400 dark:text-slate-500">(optional)</span>
              </label>
              <input
                type="text"
                value={zip}
                onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))}
                placeholder={defaultZip || "zip code"}
                className={`w-full rounded-lg border px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-teal-200 dark:bg-slate-800 dark:text-slate-100 ${
                  zip.length > 0 && zip.length < 5
                    ? "border-red-300 dark:border-red-700 focus:border-red-500"
                    : "border-gray-300 dark:border-slate-600 focus:border-teal-500"
                }`}
                maxLength={5}
              />
              {zip.length > 0 && zip.length < 5 && (
                <p className="mt-1 text-[11px] text-red-500 dark:text-red-400">
                  Enter a full 5-digit zip code
                </p>
              )}
            </div>
          </div>

          {/* Filters row */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[120px]">
              <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">Mode</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                className="w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-200"
              >
                <option value="">All Modes</option>
                <option value="in-person">In-Person</option>
                <option value="online">Online</option>
                <option value="hybrid">Hybrid</option>
                <option value="zoom">Zoom</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">
                {days.length > 0 ? "Days" : "Day"}
              </label>
              <DayToggle selectedDays={days} onChange={setDays} />
            </div>

            <div className="min-w-[130px]">
              <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">Time</label>
              <select
                value={timeOfDay}
                onChange={(e) => setTimeOfDay(e.target.value)}
                className="w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-200"
              >
                <option value="">Any Time</option>
                <option value="morning">Morning (before 12 PM)</option>
                <option value="afternoon">Afternoon (12-5 PM)</option>
                <option value="evening">Evening (after 5 PM)</option>
              </select>
            </div>

            {universities.length > 0 && (
              <div className="min-w-[150px]">
                <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">
                  Transfers to
                </label>
                <select
                  value={transferTo}
                  onChange={(e) => setTransferTo(e.target.value)}
                  className="w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-200"
                >
                  <option value="">Any University</option>
                  {universities.map((u) => (
                    <option key={u.slug} value={u.slug}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="ml-auto rounded-lg bg-teal-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50 transition-colors"
            >
              {loading ? "Searching..." : "Search"}
            </button>
          </div>
        </div>
      </form>

      {/* Bookmark error */}
      {bookmarkError && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 p-3 mb-4">
          <p className="text-sm text-amber-800 dark:text-amber-300">{bookmarkError}</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 p-4 mb-6">
          <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Natural-language answer cards. The primary card carries the LLM's
          studentSummary + clarifying question + suggested follow-ups (which
          describe the WHOLE query). The secondary card, when present for
          multi-intent queries like "prereqs for ENG 111 and does it
          transfer to GMU?", renders just its typed answer body — passing
          classification={null} naturally suppresses the duplicate summary
          UI on the second card. */}
      {answer && (
        <AnswerCard
          answer={answer}
          state={state}
          classification={classification}
          onFollowupClick={(q) => {
            setQuery(q);
            doSearch(q);
          }}
        />
      )}
      {secondaryAnswer && (
        <AnswerCard
          answer={secondaryAnswer}
          state={state}
          classification={null}
          onFollowupClick={(q) => {
            setQuery(q);
            doSearch(q);
          }}
        />
      )}

      {/* Loading */}
      {loading && (
        <div className="py-12 text-center">
          <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" />
          <p className="mt-2 text-sm text-gray-500 dark:text-slate-400">Searching all colleges...</p>
        </div>
      )}

      {/* Results */}
      {!loading && results && (
        <div>
          {/* Results summary */}
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <p className="text-sm text-gray-700 dark:text-slate-300">
              {transferTo && filteredCourses.length !== results.courses.length ? (
                <>
                  <span className="font-semibold text-gray-900 dark:text-slate-100">{filteredCourses.length}</span>{" "}
                  of {results.totalCourses} {results.totalCourses === 1 ? "course" : "courses"}{" "}
                  transfer to{" "}
                  <span className="font-semibold text-teal-700 dark:text-teal-400">
                    {universities.find((u) => u.slug === transferTo)?.name}
                  </span>
                </>
              ) : (
                <>
                  <span className="font-semibold text-gray-900 dark:text-slate-100">{results.totalSections}</span>{" "}
                  {results.totalSections === 1 ? "section" : "sections"} of{" "}
                  <span className="font-semibold text-gray-900 dark:text-slate-100">{results.totalCourses}</span>{" "}
                  {results.totalCourses === 1 ? "course" : "courses"} at{" "}
                  <span className="font-semibold text-gray-900 dark:text-slate-100">{results.totalColleges}</span>{" "}
                  {results.totalColleges === 1 ? "college" : "colleges"}
                </>
              )}
            </p>
            <div className="flex gap-1.5">
              {Object.entries(getModeSummary()).map(([m, count]) => {
                const style = MODE_STYLES[m as CourseMode];
                if (!style) return null;
                return (
                  <span
                    key={m}
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${style.bg} ${style.text}`}
                  >
                    {style.label}: {count}
                  </span>
                );
              })}
            </div>
          </div>

          {/* No results. When a filter is active, point to it specifically
              so the student knows what to clear; otherwise suggest broader
              query changes. The studentSummary card above (if present)
              already restates what we understood, so we don't repeat it. */}
          {results.courses.length === 0 && (() => {
            const activeFilters: string[] = [];
            if (mode) activeFilters.push(mode === "in-person" ? "in-person" : mode);
            if (days.length > 0) activeFilters.push(`day (${days.join(", ")})`);
            if (timeOfDay) activeFilters.push(timeOfDay);
            if (transferTo) {
              const u = universities.find((x) => x.slug === transferTo);
              activeFilters.push(`transfers to ${u?.name ?? transferTo}`);
            }
            const hasFilters = activeFilters.length > 0;
            return (
              <div className="rounded-lg border border-dashed border-gray-300 dark:border-slate-600 py-12 text-center">
                <p className="text-gray-500 dark:text-slate-400">
                  No matching courses{hasFilters ? " with the current filters" : ""}.
                </p>
                <p className="mt-1 text-sm text-gray-400 dark:text-slate-500">
                  {hasFilters
                    ? `Try removing the ${activeFilters.join(", ")} filter${activeFilters.length === 1 ? "" : "s"}.`
                    : "Try a different keyword or course code."}
                </p>
              </div>
            );
          })()}

          {/* Course groups */}
          <div className="space-y-6">
            {displayedCourses.map((course) => {
              const courseKey = `${course.prefix}-${course.number}`;
              return (
                <div
                  key={courseKey}
                  className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden"
                >
                  {/* Course header */}
                  <div className="border-b border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 px-5 py-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="font-semibold text-gray-900 dark:text-slate-100">
                        {course.prefix} {course.number}{" "}
                        <span className="font-normal text-gray-600 dark:text-slate-400">
                          &mdash; {course.title}
                        </span>
                      </h2>
                      <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                        {course.credits} credits &middot;{" "}
                        {course.totalSections} {course.totalSections === 1 ? "section" : "sections"} at{" "}
                        {course.colleges.length} {course.colleges.length === 1 ? "college" : "colleges"}
                        {transferTo && transferLookup && (() => {
                          const key = `${course.prefix}-${course.number}`;
                          const entries = transferLookup[key];
                          if (!entries) return null;
                          const entry = entries.find((e) => e.university === transferTo);
                          if (!entry) return null;
                          if (entry.type === "direct") {
                            return (
                              <span className="ml-2 inline-flex items-center gap-1 text-teal-700 dark:text-teal-400">
                                &middot; Transfers to {universities.find((u) => u.slug === transferTo)?.name}
                              </span>
                            );
                          }
                          if (entry.type === "elective") {
                            return (
                              <span className="ml-2 inline-flex items-center gap-1 text-blue-600">
                                &middot; Elective credit at {universities.find((u) => u.slug === transferTo)?.name}
                              </span>
                            );
                          }
                          return null;
                        })()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {course.prerequisite_text && (
                        <PrereqChain
                          state={state}
                          course={`${course.prefix} ${course.number}`}
                          prereqText={course.prerequisite_text}
                        />
                      )}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggleBookmark(course); }}
                        disabled={bookmarkLoading.has(`${course.prefix}-${course.number}`)}
                        className={`p-1.5 rounded-lg transition ${
                          bookmarkedCourses.has(`${course.prefix}-${course.number}`)
                            ? "text-teal-600 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-900/30"
                            : "text-gray-400 dark:text-slate-500 hover:text-teal-600 dark:hover:text-teal-400 hover:bg-gray-100 dark:hover:bg-slate-700"
                        }`}
                        title={bookmarkedCourses.has(`${course.prefix}-${course.number}`) ? "Remove bookmark" : user ? "Bookmark course" : "Sign in to bookmark"}
                      >
                        <svg className="h-4 w-4" fill={bookmarkedCourses.has(`${course.prefix}-${course.number}`) ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* College groups */}
                  <div className="divide-y divide-gray-100 dark:divide-slate-700">
                    {course.colleges.map((college) => {
                      const expandId = `${courseKey}::${college.slug}`;
                      const isExpanded = expanded.has(expandId);

                      return (
                        <div key={college.slug}>
                          {/* College header (clickable) */}
                          <button
                            type="button"
                            onClick={() => toggleExpand(courseKey, college.slug)}
                            className="w-full px-5 py-3 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-slate-800 transition"
                          >
                            <div className="flex items-center gap-3">
                              <svg
                                className={`h-4 w-4 text-gray-400 dark:text-slate-500 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={2}
                                viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                              </svg>
                              <div>
                                <span className="font-medium text-gray-900 dark:text-slate-100 text-sm">
                                  {college.name}
                                </span>
                                {college.distance !== null && (
                                  <span className="ml-2 text-xs text-gray-500 dark:text-slate-400">
                                    {college.distance} mi
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {college.auditAllowed === true && (
                                <span className="rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700">
                                  Audit OK
                                </span>
                              )}
                              <span className="text-xs text-gray-500 dark:text-slate-400">
                                {college.sections.length}{" "}
                                {college.sections.length === 1 ? "section" : "sections"}
                              </span>
                            </div>
                          </button>

                          {/* Expanded sections */}
                          {isExpanded && (
                            <div className="px-5 pb-4">
                              <div className="rounded-lg border border-gray-100 dark:border-slate-700 overflow-hidden">
                                <table className="w-full text-left text-xs">
                                  <thead className="bg-gray-50 dark:bg-slate-800 text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400">
                                    <tr>
                                      <th className="px-3 py-2 font-medium">CRN</th>
                                      <th className="px-3 py-2 font-medium">Schedule</th>
                                      <th className="px-3 py-2 font-medium">Campus</th>
                                      <th className="px-3 py-2 font-medium">Mode</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-50 dark:divide-slate-700">
                                    {college.sections.map((s) => {
                                      const style = MODE_STYLES[s.mode];
                                      return (
                                        <tr key={`${s.crn}-${s.course_prefix}${s.course_number}-${s.start_time}`} className="hover:bg-gray-50 dark:hover:bg-slate-800">
                                          <td className="px-3 py-2 font-mono text-gray-600 dark:text-slate-400">
                                            {s.crn}
                                          </td>
                                          <td className="px-3 py-2 text-gray-700 dark:text-slate-300">
                                            {formatSchedule(s)}
                                          </td>
                                          <td className="px-3 py-2 text-gray-600 dark:text-slate-400">
                                            {s.campus || "---"}
                                          </td>
                                          <td className="px-3 py-2">
                                            <span
                                              className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${style.bg} ${style.text}`}
                                            >
                                              {style.label}
                                            </span>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                              {/* Actions */}
                              <div className="mt-2 flex gap-4">
                                <Link
                                  href={`/${state}/college/${college.slug}`}
                                  className="text-xs font-medium text-teal-600 hover:text-teal-800 hover:underline"
                                >
                                  How to Audit
                                </Link>
                                <a
                                  href={buildCourseUrl(college.slug, college.sections[0], courseUrlMap)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs font-medium text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300 hover:underline"
                                >
                                  {`View on ${systemName} →`}
                                </a>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Load more */}
          {hasMore && (
            <div className="mt-6 text-center">
              <button
                type="button"
                onClick={() => setDisplayLimit((prev) => prev + 10)}
                className="rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-6 py-2.5 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition"
              >
                Show more courses ({filteredCourses.length - displayLimit} remaining)
              </button>
            </div>
          )}

          {/* In-feed ad — only after meaningful results so AdSense approves */}
          {results.courses.length > 3 && (
            <div className="mt-8">
              <AdUnit slot="4182937461" format="auto" className="min-h-[100px]" />
            </div>
          )}
        </div>
      )}

      {/* Empty state before search */}
      {!loading && !hasSearched && (
        <div className="rounded-xl border border-dashed border-gray-200 dark:border-slate-600 py-16 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-teal-50 dark:bg-teal-900/30">
            <svg className="h-6 w-6 text-teal-600" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
          </div>
          <h3 className="font-medium text-gray-900 dark:text-slate-100">Search all {systemName} colleges at once</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400 max-w-md mx-auto">
            Enter a subject code (ENG), course number (ENG 111), or keyword
            (psychology) to find sections across all {collegeCount} community colleges.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {["PSY 200", "ENG 111", "computer science", "MTH", "biology"].map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => {
                  setQuery(example);
                  doSearch(example);
                }}
                className="rounded-full border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1 text-xs text-gray-600 dark:text-slate-400 hover:border-teal-300 hover:text-teal-700 transition"
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

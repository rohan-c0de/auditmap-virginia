"use client";

import { useState, useMemo, useCallback } from "react";
import type { CourseSection, CourseMode } from "@/lib/types";
import { getCourseStatus, formatStartInfo, isInProgress, type CourseStatus } from "@/lib/course-status";
import { expandDays } from "@/lib/time-utils";
import DayToggle from "@/components/DayToggle";
import PrereqChain from "@/components/PrereqChain";

type TransferLookup = Record<
  string,
  { university: string; type: "direct" | "elective" | "no-credit"; course: string }[]
>;

interface CourseTableProps {
  courses: CourseSection[];
  collegeSlug: string;
  courseListingUrl?: string;
  systemName?: string;
  onAuditClick?: (course: CourseSection) => void;
  pinnedCRNs?: Set<string>;
  onTogglePin?: (crn: string) => void;
  transferLookup?: TransferLookup;
  /** State slug for prereq chain API calls (e.g., "tn", "de") */
  state?: string;
}

/** Build external URL for a specific course section by replacing template sentinels */
function buildCourseUrl(
  collegeSlug: string,
  course: CourseSection,
  courseListingUrl?: string
): string {
  if (!courseListingUrl) return "";
  return courseListingUrl
    .replace("__PREFIX__", course.course_prefix)
    .replace("__NUMBER__", course.course_number)
    .replace("__CRN_B64__", btoa(course.crn));
}

const MODE_STYLES: Record<CourseMode, { bg: string; text: string; label: string }> = {
  "in-person": { bg: "bg-emerald-50", text: "text-emerald-700", label: "In-Person" },
  online: { bg: "bg-blue-50", text: "text-blue-700", label: "Online" },
  hybrid: { bg: "bg-purple-50", text: "text-purple-700", label: "Hybrid" },
  zoom: { bg: "bg-blue-50", text: "text-blue-700", label: "Online" },
};

const STATUS_STYLES: Record<CourseStatus, { dot: string; text: string }> = {
  "in-progress": { dot: "bg-gray-300 dark:bg-slate-600", text: "text-gray-400 dark:text-slate-500" },
  "starting-soon": { dot: "bg-emerald-400", text: "text-emerald-600" },
  "upcoming": { dot: "bg-teal-400", text: "text-teal-600" },
};

function getUniqueSubjects(courses: CourseSection[]): string[] {
  const subjects = new Set(courses.map((c) => c.course_prefix));
  return Array.from(subjects).sort();
}

function getUniqueModes(courses: CourseSection[]): CourseMode[] {
  const modes = new Set(courses.map((c) => c.mode));
  return Array.from(modes).sort() as CourseMode[];
}

function isValidTime(t: string): boolean {
  return !!t && t !== "TBA" && t !== "0:00 AM" && t !== "0:00 PM";
}

function formatSchedule(course: CourseSection): string {
  const hasTime = isValidTime(course.start_time) && isValidTime(course.end_time);
  if (!course.days && !hasTime) {
    return "Asynchronous / Online";
  }
  const days = course.days ? expandDays(course.days) : "";
  const time = hasTime ? `${course.start_time}\u2013${course.end_time}` : "";
  if (days && time) return `${days} ${time}`;
  if (days) return days;
  if (time) return time;
  return "Asynchronous / Online";
}

function courseMatchesDays(courseDays: string, filterDays: string[]): boolean {
  if (!courseDays) return false;
  // Extract day tokens — handles "M Tu W", "M T W Th", and "MTuWThF" formats
  const tokens = courseDays.match(/[A-Z][a-z]?/g);
  if (!tokens) return false;
  // Normalize: standalone "T" → "Tu" (some scrapers use T for Tuesday)
  const normalized = tokens.map((t) => (t === "T" ? "Tu" : t));
  // OR logic: course matches if it meets on ANY selected day
  return filterDays.some((fd) => normalized.includes(fd));
}

/** Sort: upcoming first (soonest start), then in-progress (most recent start first) */
function sortByStartDate(courses: CourseSection[]): CourseSection[] {
  return [...courses].sort((a, b) => {
    const aStarted = isInProgress(a.start_date);
    const bStarted = isInProgress(b.start_date);
    // Upcoming/starting-soon before in-progress
    if (aStarted !== bStarted) return aStarted ? 1 : -1;
    // Within upcoming: soonest first
    if (!aStarted) return (a.start_date || "").localeCompare(b.start_date || "");
    // Within in-progress: most recently started first
    return (b.start_date || "").localeCompare(a.start_date || "");
  });
}

function ShareButton({ course, collegeSlug }: { course: CourseSection; collegeSlug: string }) {
  const [copied, setCopied] = useState(false);

  const handleShare = useCallback(async () => {
    const title = `${course.course_prefix} ${course.course_number}: ${course.course_title}`;
    const text = `Check out ${title} — ${formatSchedule(course)}${course.campus ? ` at ${course.campus}` : ""}`;
    const url = typeof window !== "undefined"
      ? `${window.location.origin}/college/${collegeSlug}?crn=${course.crn}`
      : "";

    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch {
        // User cancelled or share failed — fall back to clipboard
      }
    }

    // Clipboard fallback
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Last resort
    }
  }, [course, collegeSlug]);

  return (
    <button
      type="button"
      onClick={handleShare}
      className="inline-flex items-center justify-center w-7 h-7 rounded-md border bg-white border-gray-300 text-gray-400 hover:text-teal-600 hover:border-teal-300 transition dark:bg-slate-800 dark:border-slate-600 dark:text-slate-500"
      title={copied ? "Link copied!" : "Share this course"}
    >
      {copied ? (
        <svg className="h-3.5 w-3.5 text-teal-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      ) : (
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
        </svg>
      )}
    </button>
  );
}

const SHORT_NAMES: Record<string, string> = {
  // VA
  vt: "VT", vcu: "VCU", odu: "ODU", gmu: "GMU", umw: "UMW", vsu: "VSU", vwu: "VWU", uva: "UVA",
  // NC
  "unc-ch": "UNC", ncstate: "NCSU", ecu: "ECU", uncw: "UNCW", uncc: "UNCC",
  appstate: "ASU", uncg: "UNCG", ncat: "NCAT", fsu: "FSU", uncp: "UNCP",
  wcu: "WCU", wssu: "WSSU", unca: "UNCA", ecsu: "ECSU", uncsa: "UNCSA",
  catawba: "Catawba", elon: "Elon", "high-point": "HPU", wingate: "Wingate",
  // SC
  clemson: "Clemson", usc: "USC", cofc: "CofC", "usc-upstate": "USC-Up",
  // GA
  uga: "UGA", gsu: "GSU", gatech: "GT", ksu: "KSU", uwg: "UWG",
  // MD
  umcp: "UMD", towson: "Towson", umbc: "UMBC", umgc: "UMGC",
  "bowie-state": "Bowie", frostburg: "Frostburg", "morgan-state": "Morgan", salisbury: "SU",
  // NY (CUNY senior colleges + specialized institutions, from T-Rex)
  baruch: "Baruch", brooklyn: "Brooklyn", ccny: "CCNY", csi: "CSI",
  hunter: "Hunter", "john-jay": "John Jay", lehman: "Lehman",
  "medgar-evers": "Medgar Evers", "city-tech": "City Tech",
  queens: "Queens", york: "York",
  "grad-center": "Grad Ctr", "cuny-sps": "SPS", "cuny-slu": "SLU",
  "cuny-sph": "SPH", "cuny-som": "SoM", "cuny-law": "CUNY Law",
  macaulay: "Macaulay",
  // TN (receiving 4-years from per-university transfer equivalency tools)
  utk: "UTK", mtsu: "MTSU", apsu: "APSU",
};

function TransferBadge({ prefix, number, lookup }: { prefix: string; number: string; lookup: TransferLookup }) {
  const [expanded, setExpanded] = useState(false);
  const key = `${prefix}-${number}`;
  const info = lookup[key];
  if (!info || info.length === 0) return null;

  // Deduplicate by university (keep best type: direct > elective)
  const byUni = new Map<string, { university: string; type: "direct" | "elective" | "no-credit"; course: string }>();
  for (const e of info) {
    if (e.type === "no-credit") continue;
    const existing = byUni.get(e.university);
    if (!existing || (e.type === "direct" && existing.type === "elective")) {
      byUni.set(e.university, e);
    }
  }
  const deduped = Array.from(byUni.values());
  const direct = deduped.filter((e) => e.type === "direct");
  const elective = deduped.filter((e) => e.type === "elective");
  const accepting = deduped;

  if (accepting.length === 0) return null;

  const totalUnis = accepting.length;
  const hasDirect = direct.length > 0;

  // Build badge text
  let badgeText: string;
  if (totalUnis === 1) {
    const e = accepting[0];
    const name = SHORT_NAMES[e.university] || e.university;
    badgeText = e.type === "elective" ? `${name} elective credit` : `Transfers to ${name}`;
  } else if (totalUnis === 2) {
    const names = accepting.map((e) => SHORT_NAMES[e.university] || e.university);
    badgeText = `Transfers to ${names.join(", ")}`;
  } else {
    badgeText = hasDirect
      ? `Transfers to ${totalUnis} universities`
      : `Elective credit at ${totalUnis} universities`;
  }

  return (
    <div className="inline-block">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
        className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${hasDirect ? "text-teal-700" : "text-gray-500 dark:text-slate-400"} hover:underline cursor-pointer`}
      >
        <svg className="h-2.5 w-2.5 text-teal-500 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
        {badgeText}
        {totalUnis > 1 && (
          <svg className={`h-2.5 w-2.5 text-gray-400 dark:text-slate-500 transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>
      {expanded && (
        <div className="mt-1 rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-[10px] text-gray-600 space-y-0.5 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400">
          {direct.length > 0 && direct.map((e) => (
            <div key={e.university} className="text-teal-700">
              {SHORT_NAMES[e.university] || e.university}: {e.course || "direct equivalent"}
            </div>
          ))}
          {elective.length > 0 && elective.map((e) => (
            <div key={e.university} className="text-gray-500 dark:text-slate-400">
              {SHORT_NAMES[e.university] || e.university}: elective credit
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CourseTable({ courses, collegeSlug, courseListingUrl, systemName, onAuditClick, pinnedCRNs, onTogglePin, transferLookup, state }: CourseTableProps) {
  const [subjectFilter, setSubjectFilter] = useState("");
  const [dayFilters, setDayFilters] = useState<string[]>([]);
  const [modeFilter, setModeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const subjects = useMemo(() => getUniqueSubjects(courses), [courses]);
  const modes = useMemo(() => getUniqueModes(courses), [courses]);

  const filtered = useMemo(() => {
    const result = courses.filter((c) => {
      if (subjectFilter && c.course_prefix !== subjectFilter) return false;
      if (dayFilters.length > 0 && !courseMatchesDays(c.days, dayFilters)) return false;
      if (modeFilter && c.mode !== modeFilter) return false;
      if (statusFilter === "upcoming" && isInProgress(c.start_date)) return false;
      if (statusFilter === "in-progress" && !isInProgress(c.start_date)) return false;
      return true;
    });
    return sortByStartDate(result);
  }, [courses, subjectFilter, dayFilters, modeFilter, statusFilter]);

  const activeFilters = [subjectFilter, dayFilters.length > 0 ? "days" : "", modeFilter, statusFilter].filter(Boolean).length;

  const clearFilters = () => {
    setSubjectFilter("");
    setDayFilters([]);
    setModeFilter("");
    setStatusFilter("");
  };

  return (
    <div>
      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-slate-700 dark:bg-slate-800">
        <div className="min-w-[140px]">
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">
            Subject
          </label>
          <select
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-200 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-300"
          >
            <option value="">All Subjects</option>
            {subjects.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">
            {dayFilters.length > 0 ? "Days" : "Day"}
          </label>
          <DayToggle selectedDays={dayFilters} onChange={setDayFilters} />
        </div>

        <div className="min-w-[130px]">
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">
            Mode
          </label>
          <select
            value={modeFilter}
            onChange={(e) => setModeFilter(e.target.value)}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-200 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-300"
          >
            <option value="">All Modes</option>
            {modes.map((m) => (
              <option key={m} value={m}>
                {MODE_STYLES[m].label}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-[170px]">
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">
            Status
          </label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-200 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-300"
          >
            <option value="">All Sections</option>
            <option value="upcoming">Open for Registration</option>
            <option value="in-progress">Already Started</option>
          </select>
        </div>

        {activeFilters > 0 && (
          <button
            type="button"
            onClick={clearFilters}
            className="rounded-md px-3 py-2 text-sm font-medium text-teal-600 hover:bg-teal-50"
          >
            Clear filters
          </button>
        )}

        <span className="ml-auto text-sm text-gray-500 dark:text-slate-400">
          {filtered.length} {filtered.length === 1 ? "section" : "sections"}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center dark:border-slate-600">
          <p className="text-gray-500 dark:text-slate-400">No courses match your filters.</p>
          <button
            type="button"
            onClick={clearFilters}
            className="mt-2 text-sm font-medium text-teal-600 hover:underline"
          >
            Reset all filters
          </button>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden rounded-lg border border-gray-200 md:block overflow-x-auto dark:border-slate-700">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wider text-gray-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                <tr>
                  <th className="whitespace-nowrap px-3 py-3 font-medium">CRN</th>
                  <th className="whitespace-nowrap px-3 py-3 font-medium">Course</th>
                  <th className="px-3 py-3 font-medium w-full">Title</th>
                  <th className="whitespace-nowrap px-3 py-3 font-medium">Schedule</th>
                  <th className="whitespace-nowrap px-3 py-3 font-medium">Starts</th>
                  <th className="whitespace-nowrap px-3 py-3 font-medium">Instructor</th>
                  <th className="whitespace-nowrap px-3 py-3 font-medium">Campus</th>
                  <th className="whitespace-nowrap px-3 py-3 font-medium">Mode</th>
                  <th className="px-2 py-3 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                {filtered.map((course) => {
                  const style = MODE_STYLES[course.mode];
                  const status = getCourseStatus(course.start_date);
                  const statusStyle = STATUS_STYLES[status];
                  const started = status === "in-progress";
                  return (
                    <tr
                      key={`${course.crn}-${course.course_prefix}${course.course_number}-${course.days}-${course.start_time}`}
                      className={`transition hover:bg-gray-50 dark:hover:bg-slate-800 ${started ? "opacity-50" : ""}`}
                    >
                      <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-gray-600 dark:text-slate-400 max-w-[100px] truncate">
                        {course.crn}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 font-medium text-gray-900 dark:text-slate-100">
                        {course.course_prefix} {course.course_number}
                      </td>
                      <td className="px-3 py-3 text-gray-700 dark:text-slate-300">
                        <div className="max-w-[280px]">
                          <div className="truncate">{course.course_title}</div>
                          {transferLookup && (
                            <div className="mt-0.5">
                              <TransferBadge prefix={course.course_prefix} number={course.course_number} lookup={transferLookup} />
                            </div>
                          )}
                          {course.prerequisite_text && (
                            <div className="mt-1">
                              {state ? (
                                <PrereqChain
                                  state={state}
                                  course={`${course.course_prefix} ${course.course_number}`}
                                  prereqText={course.prerequisite_text}
                                />
                              ) : (
                                <span
                                  className="inline-flex items-center gap-0.5 rounded bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:border-amber-800"
                                >
                                  <svg className="h-2.5 w-2.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                                  </svg>
                                  Requires: {course.prerequisite_text}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-xs text-gray-600 dark:text-slate-400">
                        {formatSchedule(course)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <span className={`inline-flex items-center gap-1.5 text-xs ${statusStyle.text}`}>
                          <span className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${statusStyle.dot}`} />
                          {formatStartInfo(course.start_date)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-xs text-gray-600 max-w-[130px] truncate dark:text-slate-400">
                        {course.instructor || <span className="text-gray-300 dark:text-slate-600">&mdash;</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-xs text-gray-600 max-w-[100px] truncate dark:text-slate-400">
                        {course.campus || "---"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${style.bg} ${style.text} ${
                            course.mode === "in-person" ? "dark:bg-emerald-900/30" :
                            course.mode === "online" ? "dark:bg-blue-900/30" :
                            course.mode === "hybrid" ? "dark:bg-purple-900/30" :
                            "dark:bg-orange-900/30"
                          }`}
                        >
                          {style.label}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <ShareButton course={course} collegeSlug={collegeSlug} />
                          {onTogglePin && (
                            <button
                              type="button"
                              onClick={() => onTogglePin(course.crn)}
                              className={`inline-flex items-center justify-center w-7 h-7 rounded-md border transition ${
                                pinnedCRNs?.has(course.crn)
                                  ? "bg-teal-100 border-teal-300 text-teal-700"
                                  : "bg-white border-gray-300 text-gray-400 hover:text-teal-600 hover:border-teal-300 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-500"
                              }`}
                              title={pinnedCRNs?.has(course.crn) ? "Remove from schedule" : "Add to schedule"}
                            >
                              <svg className="h-3.5 w-3.5" fill={pinnedCRNs?.has(course.crn) ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                              </svg>
                            </button>
                          )}
                          {onAuditClick && (
                            <button
                              type="button"
                              onClick={() => onAuditClick(course)}
                              className="text-xs font-medium text-teal-600 hover:text-teal-800 hover:underline"
                            >
                              Audit
                            </button>
                          )}
                          <a
                            href={buildCourseUrl(collegeSlug, course, courseListingUrl)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-medium text-gray-500 hover:text-gray-700 hover:underline dark:text-slate-400 dark:hover:text-slate-300"
                          >
                            {systemName} &rarr;
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="flex flex-col gap-3 md:hidden">
            {filtered.map((course) => {
              const style = MODE_STYLES[course.mode];
              const status = getCourseStatus(course.start_date);
              const statusStyle = STATUS_STYLES[status];
              const started = status === "in-progress";
              return (
                <div
                  key={`${course.crn}-${course.course_prefix}${course.course_number}-${course.days}-${course.start_time}`}
                  className={`rounded-lg border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800 ${started ? "opacity-50" : ""}`}
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-gray-900 dark:text-slate-100">
                        {course.course_prefix} {course.course_number}
                      </p>
                      <p className="text-sm text-gray-600 dark:text-slate-400 line-clamp-2">
                        {course.course_title}
                      </p>
                      {transferLookup && (
                        <div className="mt-0.5">
                          <TransferBadge prefix={course.course_prefix} number={course.course_number} lookup={transferLookup} />
                        </div>
                      )}
                      {course.prerequisite_text && (
                        <div className="mt-1">
                          {state ? (
                            <PrereqChain
                              state={state}
                              course={`${course.course_prefix} ${course.course_number}`}
                              prereqText={course.prerequisite_text}
                            />
                          ) : (
                            <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 inline-block dark:bg-amber-900/30 dark:border-amber-800">
                              Requires: {course.prerequisite_text}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${style.bg} ${style.text} ${
                        course.mode === "in-person" ? "dark:bg-emerald-900/30" :
                        course.mode === "online" ? "dark:bg-blue-900/30" :
                        course.mode === "hybrid" ? "dark:bg-purple-900/30" :
                        "dark:bg-orange-900/30"
                      }`}
                    >
                      {style.label}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-y-1 text-xs text-gray-500 dark:text-slate-400">
                    <span className="truncate">CRN: <span className="font-mono text-gray-700 dark:text-slate-300">{course.crn}</span></span>
                    <span>Campus: <span className="text-gray-700 dark:text-slate-300">{course.campus || "---"}</span></span>
                    <span className="col-span-2">
                      Schedule: <span className="text-gray-700 dark:text-slate-300">{formatSchedule(course)}</span>
                    </span>
                    <span className="col-span-2">
                      <span className={`inline-flex items-center gap-1 ${statusStyle.text}`}>
                        <span className={`inline-block h-1.5 w-1.5 rounded-full ${statusStyle.dot}`} />
                        {formatStartInfo(course.start_date)}
                      </span>
                    </span>
                    {course.instructor && (
                      <span className="col-span-2">
                        Instructor: <span className="text-gray-700 dark:text-slate-300">{course.instructor}</span>
                      </span>
                    )}
                  </div>
                  <div className="mt-3 flex items-center justify-center gap-4 border-t border-gray-100 pt-3 dark:border-slate-700">
                    <ShareButton course={course} collegeSlug={collegeSlug} />
                    {onTogglePin && (
                      <button
                        type="button"
                        onClick={() => onTogglePin(course.crn)}
                        className={`text-xs font-medium ${pinnedCRNs?.has(course.crn) ? "text-teal-700" : "text-gray-400 hover:text-teal-600 dark:text-slate-500"}`}
                      >
                        {pinnedCRNs?.has(course.crn) ? "Pinned" : "Pin to schedule"}
                      </button>
                    )}
                    {onAuditClick && (
                      <button
                        type="button"
                        onClick={() => onAuditClick(course)}
                        className="text-xs font-medium text-teal-600 hover:text-teal-800 hover:underline"
                      >
                        How to Audit
                      </button>
                    )}
                    <a
                      href={buildCourseUrl(collegeSlug, course, courseListingUrl)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-gray-500 hover:text-gray-700 hover:underline dark:text-slate-400 dark:hover:text-slate-300"
                    >
                      View on {systemName} &rarr;
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

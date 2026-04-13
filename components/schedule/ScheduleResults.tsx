"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { GeneratedSchedule, ScheduleResponse, ScheduleSection } from "@/lib/types";
import WeeklyCalendar from "./WeeklyCalendar";
import ScoreBar from "./ScoreBar";
import { isValidTime, expandDays } from "@/lib/time-utils";
import { useAuth } from "@/lib/hooks/useAuth";
import { createClient } from "@/lib/supabase/client";

interface Props {
  response: ScheduleResponse;
  state: string;
  formData?: Record<string, unknown>;
}

const MODE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  "in-person": { bg: "bg-emerald-50 dark:bg-emerald-900/30", text: "text-emerald-700 dark:text-emerald-400", label: "In-Person" },
  online: { bg: "bg-blue-50 dark:bg-blue-900/30", text: "text-blue-700 dark:text-blue-400", label: "Online" },
  hybrid: { bg: "bg-purple-50 dark:bg-purple-900/30", text: "text-purple-700 dark:text-purple-400", label: "Hybrid" },
  zoom: { bg: "bg-blue-50 dark:bg-blue-900/30", text: "text-blue-700 dark:text-blue-400", label: "Online" },
};

const TRANSFER_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  direct: { bg: "bg-green-50 dark:bg-green-900/30", text: "text-green-700 dark:text-green-400", label: "Direct Match" },
  elective: { bg: "bg-amber-50 dark:bg-amber-900/30", text: "text-amber-700 dark:text-amber-400", label: "Elective" },
  "no-credit": { bg: "bg-red-50 dark:bg-red-900/30", text: "text-red-700 dark:text-red-400", label: "No Credit" },
};

function formatSchedule(days: string, startTime: string, endTime: string): string {
  const hasTime = isValidTime(startTime) && isValidTime(endTime);
  if (!days && !hasTime) return "Async / Online";
  const d = days ? expandDays(days) : "";
  const time = hasTime ? `${startTime}\u2013${endTime}` : "";
  if (d && time) return `${d} ${time}`;
  return d || time || "Async / Online";
}

function scoreColor(score: number): string {
  if (score >= 80) return "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800";
  if (score >= 60) return "bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800";
  return "bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300 border-red-200 dark:border-red-800";
}

function scoreLabel(score: number): string {
  if (score >= 85) return "Great fit";
  if (score >= 70) return "Good fit";
  if (score >= 55) return "Okay";
  return "Trade-offs";
}

// ---------------------------------------------------------------------------
// ICS export — generates a downloadable .ics calendar file
// ---------------------------------------------------------------------------

function semesterWeeks(sections: ScheduleSection[]): number {
  const term = sections[0]?.term || "";
  if (term.endsWith("SU")) return 10;
  return 16;
}

function downloadICS(sections: ScheduleSection[]) {
  const DAY_MAP: Record<string, string> = {
    M: "MO", Tu: "TU", W: "WE", Th: "TH", F: "FR", Sa: "SA", Su: "SU",
  };

  function toICSDate(dateStr: string, timeStr: string): string {
    // dateStr = "2025-01-13" (YYYY-MM-DD), timeStr = "9:00 AM"
    const [year, month, day] = dateStr.split("-").map(Number);
    const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!timeMatch) return "";
    let hours = parseInt(timeMatch[1], 10);
    const mins = parseInt(timeMatch[2], 10);
    const period = timeMatch[3].toUpperCase();
    if (period === "PM" && hours !== 12) hours += 12;
    if (period === "AM" && hours === 12) hours = 0;
    return `${year}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}T${String(hours).padStart(2, "0")}${String(mins).padStart(2, "0")}00`;
  }

  function expandDaysToRRule(days: string): string {
    const parts: string[] = [];
    // Parse day abbreviations from string like "MWF" or "TuTh"
    let i = 0;
    while (i < days.length) {
      if (i + 1 < days.length && days[i + 1] === days[i + 1].toLowerCase()) {
        const twoChar = days.substring(i, i + 2);
        if (DAY_MAP[twoChar]) { parts.push(DAY_MAP[twoChar]); i += 2; continue; }
      }
      const oneChar = days[i];
      if (DAY_MAP[oneChar]) parts.push(DAY_MAP[oneChar]);
      i++;
    }
    return parts.join(",");
  }

  // JS day-of-week index for each abbreviation (Sunday=0)
  const DAY_INDEX: Record<string, number> = {
    Su: 0, M: 1, Tu: 2, W: 3, Th: 4, F: 5, Sa: 6,
  };

  /** Advance a YYYY-MM-DD date to the first day that matches the course's meeting days */
  function advanceToFirstMeetingDay(dateStr: string, days: string): string {
    // Parse which JS day-of-week numbers this course meets on
    const meetingDays: number[] = [];
    let i = 0;
    while (i < days.length) {
      if (i + 1 < days.length && days[i + 1] === days[i + 1].toLowerCase()) {
        const twoChar = days.substring(i, i + 2);
        if (DAY_INDEX[twoChar] !== undefined) { meetingDays.push(DAY_INDEX[twoChar]); i += 2; continue; }
      }
      const oneChar = days[i];
      if (DAY_INDEX[oneChar] !== undefined) meetingDays.push(DAY_INDEX[oneChar]);
      i++;
    }
    if (meetingDays.length === 0) return dateStr;

    const [year, month, day] = dateStr.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    const startDow = date.getDay(); // 0=Sun .. 6=Sat

    // If start_date already falls on a meeting day, keep it
    if (meetingDays.includes(startDow)) return dateStr;

    // Find the nearest future meeting day
    for (let offset = 1; offset <= 6; offset++) {
      if (meetingDays.includes((startDow + offset) % 7)) {
        date.setDate(date.getDate() + offset);
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, "0");
        const d = String(date.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
      }
    }
    return dateStr;
  }

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CommunityCollegePath//Schedule//EN",
    "CALSCALE:GREGORIAN",
  ];

  for (const s of sections) {
    if (!isValidTime(s.start_time) || !isValidTime(s.end_time) || !s.start_date) continue;

    const adjustedDate = advanceToFirstMeetingDay(s.start_date, s.days);
    const dtStart = toICSDate(adjustedDate, s.start_time);
    const dtEnd = toICSDate(adjustedDate, s.end_time);
    if (!dtStart || !dtEnd) continue;
    const rruleDays = expandDaysToRRule(s.days);

    const now = new Date();
    const dtstamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}T${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;

    lines.push("BEGIN:VEVENT");
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART:${dtStart}`);
    lines.push(`DTEND:${dtEnd}`);
    if (rruleDays) {
      lines.push(`RRULE:FREQ=WEEKLY;COUNT=${semesterWeeks(sections)};BYDAY=${rruleDays}`);
    }
    lines.push(`SUMMARY:${s.course_prefix} ${s.course_number} - ${s.course_title}`);
    lines.push(`LOCATION:${s.collegeName}${s.location ? ` — ${s.location}` : ""}`);
    lines.push(`DESCRIPTION:CRN: ${s.crn}\\nMode: ${s.mode}${s.instructor ? `\\nInstructor: ${s.instructor}` : ""}`);
    lines.push(`UID:${s.crn}-${s.college_code}@communitycollegepath.com`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");

  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "schedule.ics";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Schedule grouping — collapse visually identical schedules that only
// differ by which college offers the course(s).
// ---------------------------------------------------------------------------

interface CollegeOption {
  collegeName: string;
  college_code: string;
  distance: number | null;
}

interface ScheduleGroup {
  representative: GeneratedSchedule;
  collegeOptions: Map<string, CollegeOption[]>;
  count: number;
}

function patternKey(schedule: GeneratedSchedule): string {
  return schedule.sections
    .map(
      (s) =>
        `${s.course_prefix}-${s.course_number}:${s.mode}:${s.days || "ASYNC"}:${s.start_time}:${s.end_time}`
    )
    .sort()
    .join("|");
}

function groupSchedules(schedules: GeneratedSchedule[]): ScheduleGroup[] {
  const map = new Map<string, GeneratedSchedule[]>();

  for (const s of schedules) {
    const key = patternKey(s);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(s);
  }

  const groups: ScheduleGroup[] = [];

  for (const variants of map.values()) {
    variants.sort((a, b) => b.score - a.score);
    const representative = variants[0];

    const collegeOptions = new Map<string, CollegeOption[]>();
    for (const variant of variants) {
      for (const sec of variant.sections) {
        const courseLabel = `${sec.course_prefix} ${sec.course_number}`;
        if (!collegeOptions.has(courseLabel)) collegeOptions.set(courseLabel, []);
        const list = collegeOptions.get(courseLabel)!;
        if (!list.some((c) => c.college_code === sec.college_code)) {
          list.push({
            collegeName: sec.collegeName,
            college_code: sec.college_code,
            distance: sec.distance,
          });
        }
      }
    }

    groups.push({ representative, collegeOptions, count: variants.length });
  }

  groups.sort((a, b) => b.representative.score - a.representative.score);
  return groups;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ScheduleResults({ response, state, formData }: Props) {
  const { schedules, meta } = response;
  const groups = useMemo(() => groupSchedules(schedules), [schedules]);

  const [expandedId, setExpandedId] = useState<string | null>(
    groups.length > 0 ? groups[0].representative.id : null
  );
  const [displayLimit, setDisplayLimit] = useState(10);

  const displayed = groups.slice(0, displayLimit);
  const wasGrouped = groups.length < schedules.length;
  const hasTransferData = schedules.some((s) => s.sections.some((sec) => sec.transferStatus));

  if (meta.message && schedules.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 dark:border-slate-600 py-12 text-center">
        <svg className="mx-auto h-8 w-8 text-gray-300 dark:text-slate-600 mb-3" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
        </svg>
        <p className="text-gray-500 dark:text-slate-400 font-medium">{meta.message}</p>
        <p className="mt-1 text-sm text-gray-400 dark:text-slate-500">
          Try adjusting your constraints and search again.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Summary bar */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <p className="text-sm text-gray-700 dark:text-slate-300">
          Found{" "}
          <span className="font-semibold text-gray-900 dark:text-slate-100">{schedules.length}</span>{" "}
          conflict-free {schedules.length === 1 ? "schedule" : "schedules"}
          {wasGrouped && (
            <span className="text-gray-500 dark:text-slate-400">
              {" "}grouped into{" "}
              <span className="font-semibold text-gray-900 dark:text-slate-100">{groups.length}</span>{" "}
              unique {groups.length === 1 ? "pattern" : "patterns"}
            </span>
          )}
          {" "}from{" "}
          <span className="font-semibold text-gray-900 dark:text-slate-100">{meta.candidateSections}</span>{" "}
          sections of{" "}
          <span className="font-semibold text-gray-900 dark:text-slate-100">{meta.candidateCourses}</span>{" "}
          courses
        </p>
        <span className="text-xs text-gray-400 dark:text-slate-500">
          ({meta.timeTakenMs}ms)
        </span>
        {meta.filteredFullSections && meta.filteredFullSections > 0 && (
          <span className="text-xs text-gray-400 dark:text-slate-500">
            · {meta.filteredFullSections} full sections hidden
          </span>
        )}
      </div>

      {meta.message && (
        <div className="mb-4 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 px-4 py-2.5 text-sm text-amber-800 dark:text-amber-300">
          {meta.message}
        </div>
      )}

      {/* Schedule cards */}
      <div className="space-y-4">
        {displayed.map((group, idx) => (
          <ScheduleCard
            key={group.representative.id}
            group={group}
            rank={idx + 1}
            isExpanded={expandedId === group.representative.id}
            onToggle={() =>
              setExpandedId(
                expandedId === group.representative.id
                  ? null
                  : group.representative.id
              )
            }
            state={state}
            showTransfer={hasTransferData}
            formData={formData}
          />
        ))}
      </div>

      {/* Load more */}
      {displayLimit < groups.length && (
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => setDisplayLimit((prev) => prev + 10)}
            className="rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-6 py-2.5 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition"
          >
            Show more ({groups.length - displayLimit} remaining)
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Individual schedule card
// ---------------------------------------------------------------------------

function ScheduleCard({
  group,
  rank,
  isExpanded,
  onToggle,
  state,
  showTransfer,
  formData,
}: {
  group: ScheduleGroup;
  rank: number;
  isExpanded: boolean;
  onToggle: () => void;
  state: string;
  showTransfer: boolean;
  formData?: Record<string, unknown>;
}) {
  const { user, openLoginModal } = useAuth();
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const { representative, collegeOptions, count } = group;
  const { sections, score, scoreBreakdown } = representative;

  // Total unique colleges across all courses in this group
  const allCollegeCodes = new Set<string>();
  for (const opts of collegeOptions.values()) {
    for (const o of opts) allCollegeCodes.add(o.college_code);
  }
  const totalColleges = allCollegeCodes.size;

  // For single-variant groups, show colleges the old way
  const colleges = new Map<string, ScheduleSection[]>();
  for (const s of sections) {
    if (!colleges.has(s.college_code)) colleges.set(s.college_code, []);
    colleges.get(s.college_code)!.push(s);
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
      {/* Header (always visible) */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-5 py-4 flex items-start gap-4 text-left hover:bg-gray-50/50 dark:hover:bg-slate-700/50 transition"
      >
        {/* Rank */}
        <div className="shrink-0 flex items-center justify-center h-8 w-8 rounded-full bg-gray-100 dark:bg-slate-700 text-sm font-bold text-gray-500 dark:text-slate-400">
          {rank}
        </div>

        {/* Course pills */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap gap-2 mb-2">
            {sections.map((s) => {
              const modeStyle = MODE_STYLES[s.mode] || MODE_STYLES["in-person"];
              const transferStyle = s.transferStatus ? TRANSFER_STYLES[s.transferStatus] : null;
              return (
                <div
                  key={`${s.crn}-${s.course_prefix}${s.course_number}`}
                  className="rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-700 px-3 py-1.5 text-xs"
                >
                  <span className="font-semibold text-gray-900 dark:text-slate-100">
                    {s.course_prefix} {s.course_number}
                  </span>
                  <span className="text-gray-500 dark:text-slate-400 ml-1.5">
                    {formatSchedule(s.days, s.start_time, s.end_time)}
                  </span>
                  <span className={`ml-1.5 inline-block rounded-full px-1.5 py-0 text-[10px] font-medium ${modeStyle.bg} ${modeStyle.text}`}>
                    {modeStyle.label}
                  </span>
                  {s.distance !== null && (
                    <span className="ml-1 text-gray-400 dark:text-slate-500">{s.distance} mi</span>
                  )}
                  {s.seats_open !== null && s.seats_open !== undefined && (
                    <span className={`ml-1.5 inline-block rounded-full px-1.5 py-0 text-[10px] font-medium ${
                      s.seats_open > 10
                        ? "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400"
                        : s.seats_open > 0
                          ? "bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400"
                          : "bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                    }`}>
                      {s.seats_open} seat{s.seats_open !== 1 ? "s" : ""}
                    </span>
                  )}
                  {transferStyle && (
                    <span className={`ml-1.5 inline-block rounded-full px-1.5 py-0 text-[10px] font-medium ${transferStyle.bg} ${transferStyle.text}`}>
                      {transferStyle.label}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500 dark:text-slate-400">
            {(() => {
              const totalCredits = sections.reduce((sum, s) => sum + (s.credits || 0), 0);
              return totalCredits > 0 ? (
                <span className="font-medium text-gray-700 dark:text-slate-300">
                  {totalCredits} credit{totalCredits !== 1 ? "s" : ""}
                  {totalCredits >= 12 ? " (full-time)" : " (part-time)"}
                </span>
              ) : null;
            })()}
            {count > 1 ? (
              <span className="text-teal-600 dark:text-teal-400 font-medium">
                Available at {totalColleges} {totalColleges === 1 ? "college" : "colleges"}
              </span>
            ) : (
              Array.from(colleges.entries()).map(([slug, secs]) => (
                <span key={slug}>
                  {secs[0].collegeName}
                  {secs.length > 1 && ` (${secs.length})`}
                </span>
              ))
            )}
          </div>
        </div>

        {/* Score badge */}
        <div className="shrink-0 flex flex-col items-center gap-1">
          <span
            className={`inline-flex items-center rounded-lg border px-2.5 py-1 text-sm font-bold ${scoreColor(score)}`}
          >
            {score}
          </span>
          <span className="text-[10px] text-gray-400 dark:text-slate-500">{scoreLabel(score)}</span>
        </div>

        {/* Chevron */}
        <svg
          className={`shrink-0 h-5 w-5 text-gray-400 dark:text-slate-500 transition-transform mt-1.5 ${isExpanded ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-gray-100 dark:border-slate-700 px-5 py-4 space-y-4">
          {/* Score breakdown */}
          <ScoreBar breakdown={scoreBreakdown} total={score} showTransfer={showTransfer} />

          {/* Weekly calendar */}
          <WeeklyCalendar sections={sections} />

          {/* Export & Save buttons */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => downloadICS(sections)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
              </svg>
              Export to Calendar (.ics)
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!user) { openLoginModal(); return; }
                setSaveStatus("saving");
                try {
                  const supabase = createClient();
                  await supabase.from("saved_schedules").insert({
                    user_id: user.id,
                    state,
                    name: `Schedule #${rank}`,
                    form_data: formData || {},
                    sections: sections,
                    score,
                    score_breakdown: scoreBreakdown,
                  });
                  setSaveStatus("saved");
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
                  {user ? "Save" : "Sign in to save"}
                </>
              )}
            </button>
          </div>

          {/* Section details with college alternatives */}
          <div className="rounded-lg border border-gray-100 dark:border-slate-700 overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 dark:bg-slate-700 text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Course</th>
                  <th className="px-3 py-2 font-medium">Schedule</th>
                  <th className="px-3 py-2 font-medium">
                    {count > 1 ? "Available Colleges" : "College"}
                  </th>
                  <th className="px-3 py-2 font-medium">Mode</th>
                  <th className="px-3 py-2 font-medium">Seats</th>
                  {sections.some((s) => s.transferStatus) && (
                    <th className="px-3 py-2 font-medium">Transfer</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-slate-700">
                {sections.map((s) => {
                  const modeStyle = MODE_STYLES[s.mode] || MODE_STYLES["in-person"];
                  const courseLabel = `${s.course_prefix} ${s.course_number}`;
                  const options = collegeOptions.get(courseLabel) || [];

                  return (
                    <tr key={`${s.crn}-${s.course_prefix}${s.course_number}`} className="hover:bg-gray-50 dark:hover:bg-slate-700 align-top">
                      <td className="px-3 py-2">
                        <span className="font-semibold text-gray-900 dark:text-slate-100">
                          {s.course_prefix} {s.course_number}
                        </span>
                        <span className="block text-[10px] text-gray-500 dark:text-slate-400 truncate max-w-[200px]">
                          {s.course_title}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-700 dark:text-slate-300">
                        {formatSchedule(s.days, s.start_time, s.end_time)}
                      </td>
                      <td className="px-3 py-2 text-gray-600 dark:text-slate-400">
                        {options.length <= 1 ? (
                          <>
                            <Link
                              href={`/${state}/college/${s.college_code}`}
                              className="text-teal-600 dark:text-teal-400 hover:underline"
                            >
                              {s.collegeName}
                            </Link>
                            {s.distance !== null && (
                              <span className="block text-[10px] text-gray-400 dark:text-slate-500">
                                {s.distance} mi away
                              </span>
                            )}
                          </>
                        ) : (
                          <CollegeOptionsList options={options} state={state} />
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${modeStyle.bg} ${modeStyle.text}`}
                        >
                          {modeStyle.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-600 dark:text-slate-400">
                        {s.seats_open !== null && s.seats_open !== undefined ? (
                          <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            s.seats_open > 10
                              ? "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400"
                              : s.seats_open > 0
                                ? "bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400"
                                : "bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                          }`}>
                            {s.seats_open}{s.seats_total ? `/${s.seats_total}` : ""}
                          </span>
                        ) : (
                          <span className="text-[10px] text-gray-400 dark:text-slate-500">—</span>
                        )}
                      </td>
                      {sections.some((sec) => sec.transferStatus) && (
                        <td className="px-3 py-2">
                          {s.transferStatus ? (
                            <div>
                              <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                TRANSFER_STYLES[s.transferStatus]?.bg || ""
                              } ${TRANSFER_STYLES[s.transferStatus]?.text || ""}`}>
                                {TRANSFER_STYLES[s.transferStatus]?.label || s.transferStatus}
                              </span>
                              {s.transferCourse && (
                                <span className="block text-[10px] text-gray-500 dark:text-slate-400 mt-0.5">
                                  {s.transferCourse}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-[10px] text-gray-400 dark:text-slate-500">—</span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Prerequisite warnings */}
          {sections.some((s) => s.prerequisite_text) && (
            <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 px-4 py-3">
              <p className="text-xs font-medium text-amber-800 dark:text-amber-300 mb-1">Prerequisite Notice</p>
              {sections
                .filter((s) => s.prerequisite_text)
                .map((s) => (
                  <p key={`${s.crn}-${s.course_prefix}${s.course_number}-prereq`} className="text-xs text-amber-700 dark:text-amber-400">
                    <span className="font-medium">
                      {s.course_prefix} {s.course_number}
                    </span>
                    {" "}requires: {s.prerequisite_text}
                  </p>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// College options list (shown when multiple colleges offer the same course)
// ---------------------------------------------------------------------------

const INITIAL_SHOW = 4;

function CollegeOptionsList({ options, state }: { options: CollegeOption[]; state: string }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? options : options.slice(0, INITIAL_SHOW);
  const remaining = options.length - INITIAL_SHOW;

  return (
    <div className="space-y-0.5">
      {visible.map((o) => (
        <div key={o.college_code} className="leading-tight">
          <Link
            href={`/${state}/college/${o.college_code}`}
            className="text-teal-600 dark:text-teal-400 hover:underline"
          >
            {o.collegeName}
          </Link>
          {o.distance !== null && (
            <span className="text-[10px] text-gray-400 dark:text-slate-500 ml-1">
              {o.distance} mi
            </span>
          )}
        </div>
      ))}
      {remaining > 0 && !showAll && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setShowAll(true);
          }}
          className="text-[10px] text-teal-600 dark:text-teal-400 hover:underline font-medium"
        >
          +{remaining} more {remaining === 1 ? "college" : "colleges"}
        </button>
      )}
    </div>
  );
}

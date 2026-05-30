"use client";

import { useState, useRef, type KeyboardEvent } from "react";
import { track } from "@/lib/analytics";

export interface ScheduleFormData {
  subjects: string[];
  daysAvailable: string[];
  timeWindowStart: string;
  timeWindowEnd: string;
  maxCourses: 1 | 2 | 3 | 4 | 5;
  zip: string;
  maxDistance: number | undefined;
  mode: string;
  minBreakMinutes: 0 | 30 | 60;
  includeInProgress: boolean;
  targetUniversity?: string;
  hideFullSections: boolean;
  term?: string;
}

interface UniversityOption {
  slug: string;
  name: string;
}

interface TermOption {
  code: string;
  label: string;
}

interface Props {
  onSubmit: (data: ScheduleFormData) => void;
  loading: boolean;
  defaultZip?: string;
  universities?: UniversityOption[];
  terms?: TermOption[];
  quickAddSubjects?: string[];
  initialDefaults?: Partial<ScheduleFormData>;
}

const DAYS = [
  { key: "M", label: "Mon" },
  { key: "Tu", label: "Tue" },
  { key: "W", label: "Wed" },
  { key: "Th", label: "Thu" },
  { key: "F", label: "Fri" },
  { key: "Sa", label: "Sat" },
];

const TIME_PRESETS = [
  { value: "any", label: "Any Time", start: "any", end: "any" },
  { value: "morning", label: "Morning (8am\u201312pm)", start: "morning", end: "morning" },
  { value: "afternoon", label: "Afternoon (12\u20135pm)", start: "afternoon", end: "afternoon" },
  { value: "evening", label: "Evening (5\u20139pm)", start: "evening", end: "evening" },
];

const DISTANCE_OPTIONS = [
  { value: undefined, label: "Any Distance" },
  { value: 5, label: "5 miles" },
  { value: 10, label: "10 miles" },
  { value: 15, label: "15 miles" },
  { value: 20, label: "20 miles" },
  { value: 30, label: "30 miles" },
  { value: 50, label: "50 miles" },
];

const DEFAULT_QUICK_ADD = ["ART", "PSY", "BIO", "ENG", "MTH", "HIS", "MUS", "PHI"];

export default function ScheduleForm({ onSubmit, loading, defaultZip, universities, terms, quickAddSubjects, initialDefaults: d }: Props) {
  const [subjects, setSubjects] = useState<string[]>(d?.subjects || []);
  const [subjectInput, setSubjectInput] = useState("");
  const [daysAvailable, setDaysAvailable] = useState<string[]>(d?.daysAvailable || ["M", "Tu", "W", "Th", "F"]);
  const [timeBucket, setTimeBucket] = useState(d?.timeWindowStart || "any");
  const [maxCourses, setMaxCourses] = useState<1 | 2 | 3 | 4 | 5>(d?.maxCourses || 2);
  const [zip, setZip] = useState(d?.zip || "");
  const [maxDistance, setMaxDistance] = useState<number | undefined>(d?.maxDistance);
  const [mode, setMode] = useState(d?.mode || "any");
  const [minBreak, setMinBreak] = useState<0 | 30 | 60>(d?.minBreakMinutes || 0);
  const [includeInProgress, setIncludeInProgress] = useState(d?.includeInProgress || false);
  const [targetUniversity, setTargetUniversity] = useState(d?.targetUniversity || "");
  const [hideFullSections, setHideFullSections] = useState(d?.hideFullSections ?? true);
  const [selectedTerm, setSelectedTerm] = useState(d?.term || "");

  const inputRef = useRef<HTMLInputElement>(null);

  const chips = quickAddSubjects && quickAddSubjects.length > 0 ? quickAddSubjects : DEFAULT_QUICK_ADD;

  function addSubject(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    // Avoid duplicates (case-insensitive)
    if (subjects.some((s) => s.toLowerCase() === trimmed.toLowerCase())) return;
    setSubjects([...subjects, trimmed.toUpperCase()]);
    setSubjectInput("");
  }

  function removeSubject(idx: number) {
    setSubjects(subjects.filter((_, i) => i !== idx));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addSubject(subjectInput);
    }
    if (e.key === "Backspace" && subjectInput === "" && subjects.length > 0) {
      removeSubject(subjects.length - 1);
    }
  }

  function toggleDay(day: string) {
    setDaysAvailable((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  }

  const hasPartialZip = zip.length > 0 && zip.length < 5;
  const distanceWithoutZip = maxDistance !== undefined && zip.length === 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (subjects.length === 0 || hasPartialZip) return;

    const preset = TIME_PRESETS.find((p) => p.value === timeBucket) || TIME_PRESETS[0];

    track("schedule_build_submit", {
      subjects: subjects.length,
      max_courses: maxCourses,
      days: daysAvailable.join("") || "any",
      time_bucket: timeBucket,
      has_zip: !!zip,
      mode: mode || "any",
      target_university: targetUniversity || "none",
    });

    onSubmit({
      subjects,
      daysAvailable,
      timeWindowStart: preset.start,
      timeWindowEnd: preset.end,
      maxCourses,
      zip,
      maxDistance,
      mode,
      minBreakMinutes: minBreak,
      includeInProgress,
      targetUniversity: targetUniversity || undefined,
      hideFullSections,
      term: selectedTerm || undefined,
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm p-5 space-y-5">
        {/* Subjects input */}
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">
            Subjects or course codes
          </label>
          <div
            className="flex flex-wrap items-center gap-1.5 rounded-lg border border-gray-300 dark:border-slate-600 px-3 py-2 focus-within:border-teal-500 focus-within:ring-1 focus-within:ring-teal-200 dark:focus-within:ring-teal-800 cursor-text"
            onClick={() => inputRef.current?.focus()}
          >
            {subjects.map((s, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-md bg-teal-50 dark:bg-teal-900/30 border border-teal-200 dark:border-teal-800 px-2 py-0.5 text-xs font-medium text-teal-800 dark:text-teal-300"
              >
                {s}
                <button
                  type="button"
                  onClick={() => removeSubject(i)}
                  className="text-teal-400 hover:text-teal-700 dark:hover:text-teal-200"
                >
                  &times;
                </button>
              </span>
            ))}
            <input
              ref={inputRef}
              type="text"
              value={subjectInput}
              onChange={(e) => setSubjectInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => addSubject(subjectInput)}
              placeholder={
                subjects.length === 0
                  ? 'Type a subject (ART) or course (PSY 200) and press Enter'
                  : "Add more..."
              }
              className="flex-1 min-w-[180px] text-sm outline-none bg-transparent py-0.5 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
          </div>
          {/* Quick-add chips */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {chips.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => addSubject(s)}
                disabled={subjects.includes(s)}
                className="rounded-full border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-0.5 text-[11px] text-gray-500 dark:text-slate-400 hover:border-teal-300 hover:text-teal-700 dark:hover:border-teal-600 dark:hover:text-teal-400 transition disabled:opacity-30 disabled:cursor-not-allowed"
              >
                + {s}
              </button>
            ))}
          </div>
        </div>

        {/* Days + Time row */}
        <div className="grid sm:grid-cols-2 gap-4">
          {/* Days available */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">
              Days available
            </label>
            <div className="flex gap-1.5">
              {DAYS.map((d) => {
                const active = daysAvailable.includes(d.key);
                return (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => toggleDay(d.key)}
                    className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-medium transition ${
                      active
                        ? "bg-teal-600 border-teal-600 text-white"
                        : "bg-white dark:bg-slate-900 border-gray-300 dark:border-slate-600 text-gray-500 dark:text-slate-400 hover:border-teal-400"
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Time window */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">
              Time of day
            </label>
            <div className="flex gap-1.5">
              {TIME_PRESETS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTimeBucket(t.value)}
                  className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-medium transition ${
                    timeBucket === t.value
                      ? "bg-teal-600 border-teal-600 text-white"
                      : "bg-white dark:bg-slate-900 border-gray-300 dark:border-slate-600 text-gray-500 dark:text-slate-400 hover:border-teal-400"
                  }`}
                >
                  {t.value === "any"
                    ? "Any"
                    : t.value.charAt(0).toUpperCase() + t.value.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Max courses + Break */}
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">
              Max courses
            </label>
            <div className="flex gap-1.5">
              {([1, 2, 3, 4, 5] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setMaxCourses(n)}
                  className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-medium transition ${
                    maxCourses === n
                      ? "bg-teal-600 border-teal-600 text-white"
                      : "bg-white dark:bg-slate-900 border-gray-300 dark:border-slate-600 text-gray-500 dark:text-slate-400 hover:border-teal-400"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">
              Min break between classes
            </label>
            <div className="flex gap-1.5">
              {([0, 30, 60] as const).map((mins) => (
                <button
                  key={mins}
                  type="button"
                  onClick={() => setMinBreak(mins)}
                  className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                    minBreak === mins
                      ? "bg-teal-600 border-teal-600 text-white"
                      : "bg-white dark:bg-slate-900 border-gray-300 dark:border-slate-600 text-gray-500 dark:text-slate-400 hover:border-teal-400"
                  }`}
                >
                  {mins === 0 ? "None" : `${mins} min`}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Location + Mode row */}
        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">
              Zip code <span className="text-gray-400 dark:text-slate-500">(optional)</span>
            </label>
            <input
              type="text"
              value={zip}
              onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))}
              placeholder={defaultZip || "zip code"}
              className="w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-4 py-2 text-sm dark:text-slate-100 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-200 dark:focus:ring-teal-800 dark:placeholder:text-slate-500"
              maxLength={5}
            />
            {hasPartialZip && (
              <p className="mt-1 text-[11px] text-red-500 dark:text-red-400">
                Enter a full 5-digit zip code
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">
              Max distance
            </label>
            <select
              value={maxDistance ?? ""}
              onChange={(e) =>
                setMaxDistance(e.target.value ? Number(e.target.value) : undefined)
              }
              className="w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm dark:text-slate-100 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-200 dark:focus:ring-teal-800"
            >
              {DISTANCE_OPTIONS.map((d) => (
                <option key={d.label} value={d.value ?? ""}>
                  {d.label}
                </option>
              ))}
            </select>
            {distanceWithoutZip && (
              <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                Enter a zip code to filter by distance
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">
              Modality
            </label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm dark:text-slate-100 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-200 dark:focus:ring-teal-800"
            >
              <option value="any">Any Mode</option>
              <option value="in-person">In-Person</option>
              <option value="online">Online</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </div>
        </div>

        {/* Term + Transfer university */}
        <div className="grid sm:grid-cols-2 gap-4">
          {terms && terms.length > 1 && (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">
                Semester
              </label>
              <select
                value={selectedTerm}
                onChange={(e) => setSelectedTerm(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm dark:text-slate-100 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-200 dark:focus:ring-teal-800"
              >
                <option value="">Current semester</option>
                {terms.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          {universities && universities.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">
                Transfer university <span className="text-gray-400 dark:text-slate-500">(optional)</span>
              </label>
              <select
                value={targetUniversity}
                onChange={(e) => setTargetUniversity(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm dark:text-slate-100 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-200 dark:focus:ring-teal-800"
              >
                <option value="">No preference</option>
                {universities.map((u) => (
                  <option key={u.slug} value={u.slug}>
                    {u.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-gray-400 dark:text-slate-500">
                Prioritizes courses that transfer as direct matches
              </p>
            </div>
          )}
        </div>

        {/* Toggles */}
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={hideFullSections}
              onChange={(e) => setHideFullSections(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 dark:border-slate-600 text-teal-600 focus:ring-teal-500 dark:bg-slate-900"
            />
            <span className="text-sm text-gray-600 dark:text-slate-400">
              Hide full sections
            </span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={includeInProgress}
              onChange={(e) => setIncludeInProgress(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 dark:border-slate-600 text-teal-600 focus:ring-teal-500 dark:bg-slate-900"
            />
            <span className="text-sm text-gray-600 dark:text-slate-400">
              Include sections that already started
            </span>
          </label>
        </div>

        {/* Submit */}
        <div className="flex items-center justify-between pt-1">
          <p className="text-xs text-gray-400 dark:text-slate-500">
            {subjects.length === 0
              ? "Add at least one subject to get started"
              : `${subjects.length} subject${subjects.length > 1 ? "s" : ""} · ${daysAvailable.length} days · ${maxCourses} max`}
          </p>
          <button
            type="submit"
            disabled={loading || subjects.length === 0 || daysAvailable.length === 0 || hasPartialZip}
            className="rounded-lg bg-teal-600 px-8 py-2.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50 transition-colors"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Building...
              </span>
            ) : (
              "Build My Schedule"
            )}
          </button>
        </div>
      </div>
    </form>
  );
}

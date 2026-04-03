"use client";

import { useState, useRef, type KeyboardEvent } from "react";

export interface ScheduleFormData {
  subjects: string[];
  daysAvailable: string[];
  timeWindowStart: string;
  timeWindowEnd: string;
  maxCourses: 1 | 2 | 3;
  zip: string;
  maxDistance: number | undefined;
  mode: string;
  minBreakMinutes: 0 | 30 | 60;
  includeInProgress: boolean;
}

interface Props {
  onSubmit: (data: ScheduleFormData) => void;
  loading: boolean;
  defaultZip?: string;
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

export default function ScheduleForm({ onSubmit, loading, defaultZip = "22030" }: Props) {
  const [subjects, setSubjects] = useState<string[]>([]);
  const [subjectInput, setSubjectInput] = useState("");
  const [daysAvailable, setDaysAvailable] = useState<string[]>(["M", "Tu", "W", "Th", "F"]);
  const [timeBucket, setTimeBucket] = useState("any");
  const [maxCourses, setMaxCourses] = useState<1 | 2 | 3>(2);
  const [zip, setZip] = useState("");
  const [maxDistance, setMaxDistance] = useState<number | undefined>(undefined);
  const [mode, setMode] = useState("any");
  const [minBreak, setMinBreak] = useState<0 | 30 | 60>(0);
  const [includeInProgress, setIncludeInProgress] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (subjects.length === 0) return;

    const preset = TIME_PRESETS.find((p) => p.value === timeBucket) || TIME_PRESETS[0];

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
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-5 space-y-5">
        {/* Subjects input */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">
            Subjects or course codes
          </label>
          <div
            className="flex flex-wrap items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 focus-within:border-teal-500 focus-within:ring-1 focus-within:ring-teal-200 cursor-text"
            onClick={() => inputRef.current?.focus()}
          >
            {subjects.map((s, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-md bg-teal-50 border border-teal-200 px-2 py-0.5 text-xs font-medium text-teal-800"
              >
                {s}
                <button
                  type="button"
                  onClick={() => removeSubject(i)}
                  className="text-teal-400 hover:text-teal-700"
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
              className="flex-1 min-w-[180px] text-sm outline-none bg-transparent py-0.5"
            />
          </div>
          {/* Quick-add chips */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {["ART", "PSY", "BIO", "ENG", "MTH", "HIS", "MUS", "PHI"].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => addSubject(s)}
                disabled={subjects.includes(s)}
                className="rounded-full border border-gray-200 bg-white px-2.5 py-0.5 text-[11px] text-gray-500 hover:border-teal-300 hover:text-teal-700 transition disabled:opacity-30 disabled:cursor-not-allowed"
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
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
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
                        : "bg-white border-gray-300 text-gray-500 hover:border-teal-400"
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
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
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
                      : "bg-white border-gray-300 text-gray-500 hover:border-teal-400"
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
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              Max courses
            </label>
            <div className="flex gap-1.5">
              {([1, 2, 3] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setMaxCourses(n)}
                  className={`flex-1 rounded-md border px-3 py-1.5 text-sm font-medium transition ${
                    maxCourses === n
                      ? "bg-teal-600 border-teal-600 text-white"
                      : "bg-white border-gray-300 text-gray-500 hover:border-teal-400"
                  }`}
                >
                  {n} {n === 1 ? "course" : "courses"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
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
                      : "bg-white border-gray-300 text-gray-500 hover:border-teal-400"
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
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              Zip code <span className="text-gray-400">(optional)</span>
            </label>
            <input
              type="text"
              value={zip}
              onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))}
              placeholder={defaultZip}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-200"
              maxLength={5}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              Max distance
            </label>
            <select
              value={maxDistance ?? ""}
              onChange={(e) =>
                setMaxDistance(e.target.value ? Number(e.target.value) : undefined)
              }
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-200"
            >
              {DISTANCE_OPTIONS.map((d) => (
                <option key={d.label} value={d.value ?? ""}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              Modality
            </label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-200"
            >
              <option value="any">Any Mode</option>
              <option value="in-person">In-Person</option>
              <option value="online">Online</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </div>
        </div>

        {/* Include in-progress toggle */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={includeInProgress}
            onChange={(e) => setIncludeInProgress(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
          />
          <span className="text-sm text-gray-600">
            Include sections that already started
          </span>
        </label>

        {/* Submit */}
        <div className="flex items-center justify-between pt-1">
          <p className="text-xs text-gray-400">
            {subjects.length === 0
              ? "Add at least one subject to get started"
              : `${subjects.length} subject${subjects.length > 1 ? "s" : ""} · ${daysAvailable.length} days · ${maxCourses} max`}
          </p>
          <button
            type="submit"
            disabled={loading || subjects.length === 0 || daysAvailable.length === 0}
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

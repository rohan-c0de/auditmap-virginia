"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import ScheduleForm from "@/components/schedule/ScheduleForm";
import ScheduleResults from "@/components/schedule/ScheduleResults";
import type { ScheduleFormData } from "@/components/schedule/ScheduleForm";
import type { ScheduleResponse } from "@/lib/types";

interface UniversityOption {
  slug: string;
  name: string;
}

interface TermOption {
  code: string;
  label: string;
}

interface ScheduleClientProps {
  state: string;
  systemName?: string;
  collegeCount?: number;
  defaultZip?: string;
  universities?: UniversityOption[];
  terms?: TermOption[];
  quickAddSubjects?: string[];
}

/** Encode form data into URL search params (only non-default values) */
function formToParams(data: ScheduleFormData): URLSearchParams {
  const p = new URLSearchParams();
  if (data.subjects.length > 0) p.set("subjects", data.subjects.join(","));
  if (data.daysAvailable.join(",") !== "M,Tu,W,Th,F") p.set("days", data.daysAvailable.join(","));
  if (data.timeWindowStart !== "any") p.set("time", data.timeWindowStart);
  if (data.maxCourses !== 2) p.set("max", String(data.maxCourses));
  if (data.zip) p.set("zip", data.zip);
  if (data.maxDistance !== undefined) p.set("dist", String(data.maxDistance));
  if (data.mode !== "any") p.set("mode", data.mode);
  if (data.minBreakMinutes > 0) p.set("break", String(data.minBreakMinutes));
  if (data.includeInProgress) p.set("inprog", "1");
  if (data.targetUniversity) p.set("univ", data.targetUniversity);
  if (!data.hideFullSections) p.set("full", "1");
  if (data.term) p.set("term", data.term);
  return p;
}

/** Parse URL search params into partial form defaults */
function paramsToDefaults(p: URLSearchParams): Partial<ScheduleFormData> | null {
  const subjects = p.get("subjects");
  if (!subjects) return null;

  const defaults: Partial<ScheduleFormData> = {
    subjects: subjects.split(",").filter(Boolean),
  };

  const days = p.get("days");
  if (days) defaults.daysAvailable = days.split(",").filter(Boolean);

  const time = p.get("time");
  if (time) {
    defaults.timeWindowStart = time;
    defaults.timeWindowEnd = time;
  }

  const max = p.get("max");
  if (max) {
    const n = Number(max);
    if ([1, 2, 3, 4, 5].includes(n)) defaults.maxCourses = n as 1 | 2 | 3 | 4 | 5;
  }

  const zip = p.get("zip");
  if (zip) defaults.zip = zip;

  const dist = p.get("dist");
  if (dist) defaults.maxDistance = Number(dist);

  const mode = p.get("mode");
  if (mode) defaults.mode = mode;

  const brk = p.get("break");
  if (brk) {
    const n = Number(brk);
    if ([0, 30, 60].includes(n)) defaults.minBreakMinutes = n as 0 | 30 | 60;
  }

  if (p.get("inprog") === "1") defaults.includeInProgress = true;

  const univ = p.get("univ");
  if (univ) defaults.targetUniversity = univ;

  if (p.get("full") === "1") defaults.hideFullSections = false;

  const term = p.get("term");
  if (term) defaults.term = term;

  return defaults;
}

export default function ScheduleClient({ state, systemName, collegeCount, defaultZip, universities, terms, quickAddSubjects }: ScheduleClientProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [response, setResponse] = useState<ScheduleResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastFormData, setLastFormData] = useState<Record<string, unknown> | null>(null);
  const autoBuilt = useRef(false);

  // Parse initial defaults from URL
  const initialDefaults = useMemo(() => paramsToDefaults(searchParams), [searchParams]);

  const handleBuild = useCallback(async (data: ScheduleFormData) => {
    setLoading(true);
    setError("");
    setResponse(null);
    setLastFormData(data as unknown as Record<string, unknown>);

    // Update URL with form params (replace, don't push)
    const params = formToParams(data);
    const paramString = params.toString();
    const newUrl = paramString ? `/${state}/schedule?${paramString}` : `/${state}/schedule`;
    router.replace(newUrl, { scroll: false });

    try {
      const res = await fetch(`/api/${state}/schedule/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjects: data.subjects,
          daysAvailable: data.daysAvailable,
          timeWindowStart: data.timeWindowStart,
          timeWindowEnd: data.timeWindowEnd,
          maxCourses: data.maxCourses,
          zip: data.zip || undefined,
          maxDistance: data.maxDistance,
          mode: data.mode,
          minBreakMinutes: data.minBreakMinutes,
          includeInProgress: data.includeInProgress,
          targetUniversity: data.targetUniversity,
          hideFullSections: data.hideFullSections,
          term: data.term || undefined,
        }),
      });

      if (!res.ok) {
        const json = await res.json();
        setError(json.error || "Failed to build schedule.");
        setLoading(false);
        return;
      }

      const json: ScheduleResponse = await res.json();
      setResponse(json);
    } catch {
      setError("Failed to connect. Please try again.");
    }

    setLoading(false);
  }, [state, router]);

  // Auto-build on mount if URL has params
  useEffect(() => {
    if (autoBuilt.current || !initialDefaults) return;
    autoBuilt.current = true;

    const data: ScheduleFormData = {
      subjects: initialDefaults.subjects || [],
      daysAvailable: initialDefaults.daysAvailable || ["M", "Tu", "W", "Th", "F"],
      timeWindowStart: initialDefaults.timeWindowStart || "any",
      timeWindowEnd: initialDefaults.timeWindowEnd || "any",
      maxCourses: initialDefaults.maxCourses || 2,
      zip: initialDefaults.zip || "",
      maxDistance: initialDefaults.maxDistance,
      mode: initialDefaults.mode || "any",
      minBreakMinutes: initialDefaults.minBreakMinutes || 0,
      includeInProgress: initialDefaults.includeInProgress || false,
      targetUniversity: initialDefaults.targetUniversity,
      hideFullSections: initialDefaults.hideFullSections ?? true,
      term: initialDefaults.term,
    };

    if (data.subjects.length > 0) {
      handleBuild(data);
    }
  }, [initialDefaults, handleBuild]);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-slate-100">
          Smart Schedule Builder
        </h1>
        <p className="text-gray-600 dark:text-slate-400 mt-1">
          Tell us your constraints and we&apos;ll build conflict-free schedules
          across all {collegeCount} {systemName} colleges.
        </p>
      </div>

      {/* Form */}
      <div className="mb-8">
        <ScheduleForm
          onSubmit={handleBuild}
          loading={loading}
          defaultZip={defaultZip}
          universities={universities}
          terms={terms}
          quickAddSubjects={quickAddSubjects}
          initialDefaults={initialDefaults || undefined}
        />
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 p-4 mb-6">
          <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="py-12 text-center">
          <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" />
          <p className="mt-2 text-sm text-gray-500 dark:text-slate-400">
            Analyzing sections across all colleges...
          </p>
        </div>
      )}

      {/* Results */}
      {!loading && response && <ScheduleResults response={response} state={state} formData={lastFormData || undefined} />}

      {/* Empty state */}
      {!loading && !response && !error && (
        <div className="rounded-xl border border-dashed border-gray-200 dark:border-slate-700 py-16 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-teal-50 dark:bg-teal-900/30">
            <svg
              className="h-6 w-6 text-teal-600"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5m-9-6h.008v.008H12v-.008zM12 15h.008v.008H12V15zm0 2.25h.008v.008H12v-.008zM9.75 15h.008v.008H9.75V15zm0 2.25h.008v.008H9.75v-.008zM7.5 15h.008v.008H7.5V15zm0 2.25h.008v.008H7.5v-.008zm6.75-4.5h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V15zm0 2.25h.008v.008h-.008v-.008zm2.25-4.5h.008v.008H16.5v-.008zm0 2.25h.008v.008H16.5V15z"
              />
            </svg>
          </div>
          <h3 className="font-medium text-gray-900 dark:text-slate-100">
            Build your perfect schedule
          </h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400 max-w-lg mx-auto">
            Add the subjects you&apos;re interested in, set your availability
            constraints, and we&apos;ll find conflict-free course combinations
            across all community colleges.
          </p>
        </div>
      )}
    </div>
  );
}

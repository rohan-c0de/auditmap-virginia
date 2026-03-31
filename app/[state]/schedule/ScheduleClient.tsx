"use client";

import { useState } from "react";
import ScheduleForm from "@/components/schedule/ScheduleForm";
import ScheduleResults from "@/components/schedule/ScheduleResults";
import type { ScheduleFormData } from "@/components/schedule/ScheduleForm";
import type { ScheduleResponse } from "@/lib/types";

interface ScheduleClientProps {
  state: string;
  systemName?: string;
  collegeCount?: number;
}

export default function ScheduleClient({ state, systemName = "VCCS", collegeCount = 23 }: ScheduleClientProps) {
  const [response, setResponse] = useState<ScheduleResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleBuild(data: ScheduleFormData) {
    setLoading(true);
    setError("");
    setResponse(null);

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
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">
          Smart Schedule Builder
        </h1>
        <p className="text-gray-600 mt-1">
          Tell us your constraints and we&apos;ll build conflict-free schedules
          across all {collegeCount} {systemName} colleges.
        </p>
      </div>

      {/* Form */}
      <div className="mb-8">
        <ScheduleForm onSubmit={handleBuild} loading={loading} />
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 mb-6">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="py-12 text-center">
          <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" />
          <p className="mt-2 text-sm text-gray-500">
            Analyzing sections across all colleges...
          </p>
        </div>
      )}

      {/* Results */}
      {!loading && response && <ScheduleResults response={response} state={state} />}

      {/* Empty state */}
      {!loading && !response && !error && (
        <div className="rounded-xl border border-dashed border-gray-200 py-16 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-teal-50">
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
          <h3 className="font-medium text-gray-900">
            Build your perfect schedule
          </h3>
          <p className="mt-1 text-sm text-gray-500 max-w-lg mx-auto">
            Add the subjects you&apos;re interested in, set your availability
            constraints, and we&apos;ll find conflict-free course combinations
            across all Virginia community colleges.
          </p>
        </div>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import SemesterPlanner from "@/components/SemesterPlanner";

interface SavedPlanViewProps {
  planId: string;
  state: string;
  systemName?: string;
  name: string;
  targetCourses: string[];
  createdAt: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function SavedPlanView({
  planId,
  state,
  systemName,
  name,
  targetCourses,
  createdAt,
}: SavedPlanViewProps) {
  void planId;
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900">
      {/* Header */}
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link
            href="/account#plans"
            className="text-sm text-slate-500 dark:text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 transition-colors"
          >
            &larr; My Plans
          </Link>
          <Link
            href={`/${state}`}
            className="text-sm text-slate-500 dark:text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 transition-colors"
          >
            {systemName || state.toUpperCase()} home &rarr;
          </Link>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {name}
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Saved {formatDate(createdAt)} · {targetCourses.length} target
            {targetCourses.length === 1 ? "" : "s"}
          </p>
        </div>

        {/* Source banner — explains immutability + offers a fresh-start link.
            Saves on this page create a NEW saved_plans row (the Save button
            always INSERTs, never UPDATEs); this banner makes that obvious. */}
        <div className="mb-6 rounded-lg border border-teal-200 dark:border-teal-800/50 bg-teal-50 dark:bg-teal-900/20 px-4 py-3 text-sm text-teal-800 dark:text-teal-200 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-medium">Viewing a saved plan.</span>
          <span className="text-teal-700 dark:text-teal-300/80">
            Add or remove courses below. Saving creates a new plan rather than
            overwriting this one.
          </span>
          <Link
            href={`/${state}/plan`}
            className="ml-auto inline-flex items-center gap-1 underline underline-offset-2 hover:text-teal-900 dark:hover:text-teal-100"
          >
            Start fresh
          </Link>
        </div>

        <SemesterPlanner
          state={state}
          initialTargets={targetCourses}
          initialName={name}
        />
      </main>
    </div>
  );
}

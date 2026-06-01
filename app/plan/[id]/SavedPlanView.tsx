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

/** Build the duplicate URL: /{state}/plan?targets=BIOL+1010,MATH+1100&name=...
 *  Mirrors the parsing in app/[state]/plan/PlannerClient.tsx — '+' encodes a
 *  space inside each course code; ',' separates codes. Name gets URI-encoded
 *  via URLSearchParams. Returns a relative path so Next-Link can intercept. */
function duplicateUrl(state: string, targets: string[], name: string): string {
  if (targets.length === 0) return `/${state}/plan`;
  const codes = targets.map((c) => c.replace(/ /g, "+")).join(",");
  const sp = new URLSearchParams({ targets: codes, name: `${name} (copy)` });
  return `/${state}/plan?${sp.toString()}`;
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

        {/* Source banner — explains immutability + offers a duplicate/fresh
            option. Saves on this page create a NEW saved_plans row (the Save
            button always INSERTs, never UPDATEs); the explicit 'Duplicate to
            edit' button makes the model less surprising. The same flow also
            works inline: add/remove courses below, then click Save to create
            a new plan from the modified state. */}
        <div className="mb-6 rounded-lg border border-teal-200 dark:border-teal-800/50 bg-teal-50 dark:bg-teal-900/20 px-4 py-3 text-sm text-teal-800 dark:text-teal-200">
          <p className="font-medium mb-1">Viewing a saved plan.</p>
          <p className="text-teal-700 dark:text-teal-300/80 mb-3">
            Plans are immutable — clicking Save below creates a new plan
            rather than overwriting this one.
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            <Link
              href={duplicateUrl(state, targetCourses, name)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white px-3 py-1.5 text-xs font-medium transition"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.026a1.125 1.125 0 001.125 1.125h.375" />
              </svg>
              Duplicate to edit
            </Link>
            <Link
              href={`/${state}/plan`}
              className="inline-flex items-center gap-1 text-xs text-teal-700 dark:text-teal-300/80 underline underline-offset-2 hover:text-teal-900 dark:hover:text-teal-100"
            >
              Start a fresh plan instead
            </Link>
          </div>
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

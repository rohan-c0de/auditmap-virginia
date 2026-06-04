"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SemesterPlanner from "@/components/SemesterPlanner";
import { createClient } from "@/lib/supabase/client";
import {
  toggleCompleted,
  completedCount,
  progressSummary,
  type TransferVerdict,
} from "@/lib/transfer-tracker";

interface University {
  slug: string;
  name: string;
}

// Transfer verdict badge styles. Deliberately indigo / violet / rose / gray +
// ✓ ≈ ✕ icons — NOT the seat green/amber/red palette — so a transfer outcome is
// never confusable with a seat-availability signal. Icons carry the meaning so
// it's not color-only.
const VERDICT_STYLE: Record<TransferVerdict, { label: string; cls: string }> = {
  direct: {
    label: "✓ Transfers",
    cls: "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300",
  },
  elective: {
    label: "≈ Elective",
    cls: "bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300",
  },
  "no-credit": {
    label: "✕ No credit",
    cls: "bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300",
  },
  none: {
    label: "— No data",
    cls: "bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-slate-400",
  },
};

interface SavedPlanViewProps {
  planId: string;
  state: string;
  systemName?: string;
  name: string;
  targetCourses: string[];
  createdAt: string;
  /** In-state universities the user can pick as their transfer goal. */
  universities: University[];
  /** The plan's current target-university slug, or null if unset. */
  targetUniversity: string | null;
  /** Course codes the user has marked completed on this plan. */
  completedCourses: string[];
  /** Per-target-course transfer verdict to the current target university
   *  (server-computed). Empty {} when no target university is set. */
  verdicts: Record<string, TransferVerdict>;
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
  universities,
  targetUniversity,
  completedCourses,
  verdicts,
}: SavedPlanViewProps) {
  const router = useRouter();
  const [targetUni, setTargetUni] = useState<string | null>(targetUniversity);
  const [completed, setCompleted] = useState<string[]>(completedCourses);

  // Persist the two tracker fields IN PLACE on this plan. The plan's structure
  // (target_courses / plan_data) stays immutable — only target_university and
  // completed_courses update. RLS ("Users manage own plans" FOR ALL, 017)
  // scopes the UPDATE to the owner. Optimistic, revert on error.
  async function persistTargetUniversity(slug: string | null) {
    const prev = targetUni;
    setTargetUni(slug);
    const supabase = createClient();
    const { error } = await supabase
      .from("saved_plans")
      .update({ target_university: slug })
      .eq("id", planId);
    if (error) {
      setTargetUni(prev);
    } else {
      // Re-run the server component so per-course verdicts recompute for the
      // newly chosen university (the `verdicts` prop is server-derived).
      router.refresh();
    }
  }

  async function persistCompleted(next: string[]) {
    const prev = completed;
    setCompleted(next);
    const supabase = createClient();
    const { error } = await supabase
      .from("saved_plans")
      .update({ completed_courses: next })
      .eq("id", planId);
    if (error) setCompleted(prev);
  }

  const { done, total } = completedCount(targetCourses, completed);
  const summary = progressSummary(completed, verdicts);
  const hasGoal = targetUni != null && targetUni !== "";

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

        {/* Transfer goal & progress (Milestone C). Pick a target university +
            check off completed courses; each course shows how it transfers to
            that university (direct / elective / no-credit), with a live tally of
            the completed ones. Tracker fields update in place (RLS-scoped);
            changing the university re-runs the server to recompute verdicts. */}
        <section className="mb-6 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Transfer goal &amp; progress
          </h2>

          <label className="mt-3 block text-sm text-slate-600 dark:text-slate-400">
            University you&apos;re aiming to transfer to
            <select
              value={targetUni ?? ""}
              onChange={(e) => persistTargetUniversity(e.target.value || null)}
              className="mt-1 block w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none transition"
            >
              <option value="">Choose a university…</option>
              {universities.map((u) => (
                <option key={u.slug} value={u.slug}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>

          {targetCourses.length > 0 ? (
            <div className="mt-4">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                {done} of {total} {total === 1 ? "course" : "courses"} completed
              </p>

              {hasGoal && completed.length > 0 && (
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                  Of your {completed.length} completed: {summary.direct} transfer directly
                  {" · "}
                  {summary.elective} as elective{" · "}
                  {summary.noCredit} no-credit
                  {summary.noData > 0 ? ` · ${summary.noData} no transfer data` : ""}
                </p>
              )}

              <ul className="mt-2 space-y-1.5">
                {targetCourses.map((code) => {
                  const isDone = completed.includes(code);
                  const verdict = verdicts[code] ?? "none";
                  return (
                    <li key={code} className="flex items-center justify-between gap-2">
                      <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isDone}
                          onChange={() => persistCompleted(toggleCompleted(completed, code))}
                          className="h-4 w-4 rounded border-gray-300 dark:border-slate-600 text-teal-600 focus:ring-teal-500"
                        />
                        <span
                          className={
                            isDone
                              ? "line-through text-slate-400 dark:text-slate-500"
                              : "text-slate-700 dark:text-slate-300"
                          }
                        >
                          {code}
                        </span>
                      </label>
                      {hasGoal && (
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${VERDICT_STYLE[verdict].cls}`}
                        >
                          {VERDICT_STYLE[verdict].label}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
              This plan has no target courses to track yet.
            </p>
          )}

          <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
            {hasGoal
              ? "Transfer outcomes are in-state equivalencies from each university's published guides — verify with the receiving school's registrar."
              : "Pick a university above to see how each course transfers (direct, elective, or no credit)."}
          </p>
        </section>

        <SemesterPlanner
          state={state}
          initialTargets={targetCourses}
          initialName={name}
        />
      </main>
    </div>
  );
}

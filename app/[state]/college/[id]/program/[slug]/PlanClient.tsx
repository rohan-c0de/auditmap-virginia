"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { termLabel } from "@/lib/term-label";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/hooks/useAuth";
import type { MajorPlan, PlanCourse, PlanTerm, TransferStatus } from "@/lib/programs/planner";

interface Props {
  plan: MajorPlan;
  transferHref: string;
}

// Plain-language transfer verdicts. The precise receiving-course code (e.g.
// "MGNT 0XXX") is kept on hover, not in the always-visible label — a first-gen
// student reads "Counts as an elective", an advisor can hover for the code.
const STATUS_PILL: Record<TransferStatus, { label: string; cls: string }> = {
  direct: {
    label: "Transfers",
    cls: "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 ring-emerald-200 dark:ring-emerald-800",
  },
  elective: {
    label: "Counts as an elective",
    cls: "bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 ring-amber-200 dark:ring-amber-800",
  },
  "no-credit": {
    label: "Won't transfer",
    cls: "bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400 ring-rose-200 dark:ring-rose-800",
  },
};

const PILL_BASE =
  "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset";
const PILL_MUTED =
  "bg-gray-50 dark:bg-slate-800 text-gray-400 dark:text-slate-500 ring-gray-200 dark:ring-slate-700";

export default function PlanClient({ plan, transferHref }: Props) {
  const [uni, setUni] = useState<string>(plan.universities[0]?.slug ?? "__all__");
  const [view, setView] = useState<"requirements" | "sequence">("requirements");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const { user, openLoginModal } = useAuth();

  const allCourses = useMemo(
    () => plan.groups.flatMap((g) => g.courses),
    [plan.groups],
  );

  const summary = useMemo(() => {
    let direct = 0,
      elective = 0,
      noCredit = 0,
      unknown = 0;
    for (const c of allCourses) {
      if (uni === "__all__") {
        if (c.acceptingCount > 0) direct += 1;
        else unknown += 1;
        continue;
      }
      const t = c.transfers[uni];
      if (!t) unknown += 1;
      else if (t.status === "direct") direct += 1;
      else if (t.status === "elective") elective += 1;
      else noCredit += 1;
    }
    return { direct, elective, noCredit, unknown };
  }, [allCourses, uni]);

  const selectedUniName =
    uni === "__all__"
      ? "any university"
      : (plan.universities.find((u) => u.slug === uni)?.name ?? uni);

  return (
    <div className="space-y-6">
      {/* University picker */}
      <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 p-4">
        <label
          htmlFor="uni"
          className="block text-sm font-medium text-gray-700 dark:text-slate-200"
        >
          Show how these courses transfer to:
        </label>
        <select
          id="uni"
          value={uni}
          onChange={(e) => setUni(e.target.value)}
          className="mt-2 w-full max-w-md rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="__all__">Any university (show coverage)</option>
          {plan.universities.map((u) => (
            <option key={u.slug} value={u.slug}>
              {u.name} — accepts {u.accepts} of {plan.totals.listedCourses}
            </option>
          ))}
        </select>
        {plan.universities.length === 0 && (
          <p className="mt-2 text-sm text-gray-500 dark:text-slate-400">
            No transfer equivalencies are recorded for this program yet.
          </p>
        )}
      </div>

      {/* Summary line */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <SummaryStat
          n={summary.direct}
          label={uni === "__all__" ? "transfer to a school" : "transfer directly"}
          cls="text-emerald-700 dark:text-emerald-400"
        />
        {uni !== "__all__" && summary.elective > 0 && (
          <SummaryStat
            n={summary.elective}
            label="count as electives"
            cls="text-amber-700 dark:text-amber-400"
          />
        )}
        {uni !== "__all__" && summary.noCredit > 0 && (
          <SummaryStat
            n={summary.noCredit}
            label="won't transfer"
            cls="text-rose-700 dark:text-rose-400"
          />
        )}
        {summary.unknown > 0 && (
          <SummaryStat
            n={summary.unknown}
            label="not listed yet"
            cls="text-gray-500 dark:text-slate-400"
          />
        )}
        <SummaryStat
          n={plan.totals.offeredThisTerm}
          label={`open this term (${termLabel(plan.term)})`}
          cls="text-teal-700 dark:text-teal-400"
        />
      </div>

      <p className="text-sm text-gray-600 dark:text-slate-300">
        Showing transfer outcomes to{" "}
        <strong className="text-gray-900 dark:text-slate-100">{selectedUniName}</strong>{" "}
        for <strong className="text-gray-900 dark:text-slate-100">{plan.totals.listedCourses}</strong>{" "}
        required courses at {plan.collegeName}.{" "}
        <Link
          href={transferHref}
          className="text-blue-600 dark:text-blue-400 underline"
        >
          Browse all transfer pathways &rarr;
        </Link>
      </p>

      {/* View toggle + save — row that only shows when meaningful */}
      <div className="flex flex-wrap items-center gap-3">
        {plan.sequence && (
          <div className="flex items-center gap-1 rounded-lg bg-gray-100 dark:bg-slate-800 p-1">
            <ToggleButton active={view === "requirements"} onClick={() => setView("requirements")}>
              By requirement
            </ToggleButton>
            <ToggleButton active={view === "sequence"} onClick={() => setView("sequence")}>
              Suggested sequence
            </ToggleButton>
          </div>
        )}
        {/* Save this plan — auth-gated, same pattern as SemesterPlanner save */}
        <button
          type="button"
          onClick={async () => {
            if (!user) { openLoginModal(); return; }
            if (saveStatus !== "idle") return;
            setSaveStatus("saving");
            try {
              const supabase = createClient();
              const targetCourses = plan.groups
                .flatMap((g) => g.courses)
                .map((c) => c.code);
              await supabase.from("saved_plans").insert({
                user_id: user.id,
                state: plan.state,
                name: `${plan.program.title} — ${plan.collegeName}`,
                target_courses: targetCourses,
                plan_data: { groups: plan.groups },
              });
              setSaveStatus("saved");
              setTimeout(() => setSaveStatus("idle"), 3000);
            } catch {
              setSaveStatus("idle");
            }
          }}
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
          ) : (
            <>
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
              </svg>
              {user ? (saveStatus === "saving" ? "Saving…" : "Save this plan") : "Sign in to save"}
            </>
          )}
        </button>
      </div>

      {view === "sequence" && plan.sequence ? (
        <SequenceView terms={plan.sequence.terms} uni={uni} coverage={plan.sequence.prereqCoverage} truncated={plan.sequence.truncated} />
      ) : (
        /* Requirement groups */
        <div className="space-y-6">
          {plan.groups.map((g, i) => (
            <section
              key={`${g.name}-${i}`}
              className="rounded-lg border border-gray-200 dark:border-slate-700"
            >
              <header className="flex items-baseline justify-between border-b border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-800 px-4 py-2">
                <h3 className="font-semibold text-gray-900 dark:text-slate-100">{g.name}</h3>
                {g.creditsRequired != null && (
                  <span className="text-xs text-gray-500 dark:text-slate-400">
                    {g.creditsRequired} credits
                  </span>
                )}
              </header>
              {g.unenumerated ? (
                <p className="px-4 py-3 text-sm text-gray-500 dark:text-slate-400">
                  This requirement is satisfied by a choice of courses the catalog
                  doesn&apos;t list individually
                  {g.chooseN ? ` (choose ${g.chooseN})` : ""}.
                </p>
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-slate-800">
                  {g.courses.map((c) => (
                    <CourseRow key={c.code} course={c} uni={uni} />
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}

      <p className="text-xs text-gray-400 dark:text-slate-500">
        Transfer outcomes reflect recorded course-to-course equivalencies and may
        not capture every agreement. Confirm with your advisor and the receiving
        university before enrolling.
      </p>
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
        active
          ? "bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 shadow-sm"
          : "text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300"
      }`}
    >
      {children}
    </button>
  );
}

function SequenceView({
  terms,
  uni,
  coverage,
  truncated,
}: {
  terms: PlanTerm[];
  uni: string;
  coverage: number;
  truncated: boolean;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-slate-300">
        A suggested order to take these courses, based on recorded prerequisites
        ({Math.round(coverage * 100)}% of courses have prerequisite data). This is
        a starting point — your advisor sets the official sequence.
      </p>
      {truncated && (
        <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          This program has many prerequisites and needs more than 8 terms to fully
          sequence. Showing the first 8 — talk to an advisor to map out the full path.
        </div>
      )}
      {terms.map((t) => (
        <section
          key={t.index}
          className="rounded-lg border border-gray-200 dark:border-slate-700"
        >
          <header className="flex items-baseline justify-between border-b border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-800 px-4 py-2">
            <h3 className="font-semibold text-gray-900 dark:text-slate-100">
              Term {t.index}
            </h3>
            <span className="text-xs text-gray-500 dark:text-slate-400">
              {t.credits} credits
            </span>
          </header>
          <ul className="divide-y divide-gray-100 dark:divide-slate-800">
            {t.courses.map((c) => (
              <CourseRow key={c.code} course={c} uni={uni} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function SummaryStat({ n, label, cls }: { n: number; label: string; cls: string }) {
  return (
    <span className={`font-semibold ${cls}`}>
      {n} <span className="font-normal text-gray-500 dark:text-slate-400">{label}</span>
    </span>
  );
}

function CourseRow({ course, uni }: { course: PlanCourse; uni: string }) {
  const t = uni === "__all__" ? null : course.transfers[uni];
  const creditLabel = course.credits != null ? ` · ${course.credits} credit${course.credits === 1 ? "" : "s"}` : "";
  return (
    <li className="px-4 py-3">
      {/* Lead with the human name; code + credits are secondary. */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-900 dark:text-slate-100">
            {course.title || course.code}
          </div>
          <div className="font-mono text-xs text-gray-400 dark:text-slate-500">
            {course.code}
            {creditLabel}
          </div>
        </div>
        {/* The two things that matter, on the right. */}
        {course.sectionsThisTerm > 0 ? (
          <span className="shrink-0 text-xs font-medium text-teal-700 dark:text-teal-400">
            Open this term
          </span>
        ) : (
          <span className="shrink-0 text-xs text-gray-400 dark:text-slate-500">
            Not offered this term
          </span>
        )}
      </div>

      {/* Transfer verdict — plain language, precise code on hover. */}
      <div className="mt-1.5">
        {uni === "__all__" ? (
          course.acceptingCount > 0 ? (
            <span
              className={`${PILL_BASE} bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 ring-emerald-200 dark:ring-emerald-800`}
            >
              Transfers to {course.acceptingCount} school{course.acceptingCount === 1 ? "" : "s"}
            </span>
          ) : (
            <span className={`${PILL_BASE} ${PILL_MUTED}`}>Transfer not listed</span>
          )
        ) : t ? (
          <span
            className={`${PILL_BASE} ${STATUS_PILL[t.status].cls}`}
            title={t.univCourse ? `Receiving course: ${t.univCourse}` : undefined}
          >
            {STATUS_PILL[t.status].label}
          </span>
        ) : (
          <span className={`${PILL_BASE} ${PILL_MUTED}`}>Transfer not listed</span>
        )}
      </div>
    </li>
  );
}

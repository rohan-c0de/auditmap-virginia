"use client";

/**
 * "Help me choose" guided quiz (client). Three questions — interest field,
 * goal, schedule — then real program matches that link to the existing
 * /[state]/program/[slug] comparison pages.
 *
 * All data arrives as props from the server page (`facts`); this component
 * imports ONLY the client-safe taxonomy + pure `recommend` from
 * `lib/programs/choose` (never the Supabase/fs gatherer). Every number shown
 * is a measured value passed in — nothing is fabricated here.
 */

import { useState } from "react";
import Link from "next/link";
import {
  FIELDS,
  GOALS,
  TIMES,
  recommend,
  availableFieldIds,
  type ChooseProgramFact,
  type FieldId,
  type GoalId,
  type TimeId,
} from "@/lib/programs/choose";

type Props = {
  state: string;
  stateName: string;
  facts: ChooseProgramFact[];
  transferSupported: boolean;
};

/** Render one of our trusted inline-SVG path strings as a stroked icon. */
function Icon({ path, className }: { path: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: path }}
    />
  );
}

const GOAL_LABEL: Record<GoalId, string> = {
  job: "start working soon",
  transfer: "transfer to a four-year",
  pay: "earn the most",
};

/** One question card with a grid of selectable options. Module-level so it
 *  isn't recreated on every render (which would remount and lose state). */
function OptionGrid<T extends string>(props: {
  qn: string;
  title: string;
  options: { id: T; label: string; desc: string; iconPath: string }[];
  selected: T | null;
  onPick: (id: T) => void;
  canBack: boolean;
  onBack: () => void;
  two?: boolean;
}) {
  return (
    <div className="rounded-3xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm p-6 sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-teal-700 dark:text-teal-300">
        {props.qn}
      </p>
      <h2 className="mt-1.5 text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
        {props.title}
      </h2>
      <div
        className={`mt-5 grid gap-3 ${
          props.two ? "sm:grid-cols-2" : "grid-cols-1"
        }`}
      >
        {props.options.map((o) => {
          const on = props.selected === o.id;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => props.onPick(o.id)}
              aria-pressed={on}
              className={`flex items-center gap-3.5 rounded-2xl border-[1.5px] px-4 py-3.5 text-left transition-all hover:-translate-y-0.5 ${
                on
                  ? "border-teal-600 bg-teal-50 dark:bg-teal-900/30"
                  : "border-gray-200 dark:border-slate-700 hover:border-teal-600 bg-white dark:bg-slate-900"
              }`}
            >
              <span
                className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${
                  on
                    ? "bg-teal-600 text-white"
                    : "bg-teal-50 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300"
                }`}
              >
                <Icon path={o.iconPath} className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block font-semibold text-slate-900 dark:text-slate-100">
                  {o.label}
                </span>
                <span className="block text-[13px] text-slate-500 dark:text-slate-400">
                  {o.desc}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-5 flex items-center justify-between">
        <button
          type="button"
          onClick={props.onBack}
          disabled={!props.canBack}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 disabled:opacity-40 disabled:hover:text-slate-500"
        >
          <Icon path='<path d="M19 12H5M11 6l-6 6 6 6"/>' className="h-4 w-4" />
          Back
        </button>
        <span className="text-[13px] text-slate-400">
          Tap an answer to continue
        </span>
      </div>
    </div>
  );
}

export default function ChooseQuiz({
  state,
  stateName,
  facts,
  transferSupported,
}: Props) {
  const [step, setStep] = useState(0); // 0=field, 1=goal, 2=time, 3=results
  const [field, setField] = useState<FieldId | null>(null);
  const [goal, setGoal] = useState<GoalId | null>(null);
  const [time, setTime] = useState<TimeId | null>(null);

  const available = availableFieldIds(facts);
  const fieldOptions = FIELDS.filter((f) => available.has(f.id));
  const someFieldsHidden = fieldOptions.length < FIELDS.length;

  function reset() {
    setStep(0);
    setField(null);
    setGoal(null);
    setTime(null);
  }

  const progress = (
    <div className="flex items-center justify-center gap-2 my-7">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`h-1.5 w-9 rounded-full transition-colors ${
            i <= step ? "bg-teal-600" : "bg-gray-200 dark:bg-slate-700"
          }`}
        />
      ))}
    </div>
  );

  const goBack = () => setStep((s) => Math.max(0, s - 1));

  // ---- Questions ----
  if (step === 0) {
    return (
      <>
        {progress}
        <OptionGrid
          qn="Question 1 of 3"
          title="What kind of work sounds good to you?"
          options={fieldOptions}
          selected={field}
          two
          canBack={false}
          onBack={goBack}
          onPick={(id) => {
            setField(id);
            setStep(1);
          }}
        />
        {someFieldsHidden && (
          <p className="mt-4 text-center text-[13px] text-slate-500 dark:text-slate-400">
            Some career &amp; trades programs aren&rsquo;t offered in {stateName}{" "}
            yet.{" "}
            <Link
              href={`/${state}/programs`}
              className="text-teal-700 dark:text-teal-300 underline underline-offset-2"
            >
              Browse every program
            </Link>
            .
          </p>
        )}
      </>
    );
  }

  if (step === 1) {
    return (
      <>
        {progress}
        <OptionGrid
          qn="Question 2 of 3"
          title="What matters most right now?"
          options={GOALS}
          selected={goal}
          canBack
          onBack={goBack}
          onPick={(id) => {
            setGoal(id);
            setStep(2);
          }}
        />
      </>
    );
  }

  if (step === 2) {
    return (
      <>
        {progress}
        <OptionGrid
          qn="Question 3 of 3"
          title="How much time do you have for school?"
          options={TIMES}
          selected={time}
          two
          canBack
          onBack={goBack}
          onPick={(id) => {
            setTime(id);
            setStep(3);
          }}
        />
      </>
    );
  }

  // ---- Results ----
  const answers =
    field && goal && time ? { field, goal, time } : null;
  const matches = answers ? recommend(facts, answers) : [];

  return (
    <>
      {progress}
      <div className="text-center">
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          {matches.length > 0
            ? `Your best matches in ${stateName}`
            : "Let's widen the search"}
        </h2>
        {answers && matches.length > 0 && (
          <p className="mt-2 text-[15px] text-slate-500 dark:text-slate-400">
            Because you want to {GOAL_LABEL[answers.goal]}, here are real
            programs you can compare college by college.
          </p>
        )}
      </div>

      {matches.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 text-center">
          <p className="text-slate-600 dark:text-slate-300">
            We don&rsquo;t have programs in that area for {stateName} yet.
          </p>
          <Link
            href={`/${state}/programs`}
            className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 transition-colors"
          >
            See all programs in {stateName}
            <Icon path='<path d="M5 12h14M13 6l6 6-6 6"/>' className="h-4 w-4" />
          </Link>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {matches.map((m, i) => (
            <li key={m.slug}>
              <Link
                href={`/${state}/program/${m.slug}`}
                className={`group flex items-center gap-4 rounded-2xl border p-4 sm:p-5 transition-all hover:-translate-y-0.5 hover:shadow-md ${
                  i === 0
                    ? "border-teal-300 dark:border-teal-700 bg-gradient-to-b from-white to-teal-50/60 dark:from-slate-900 dark:to-teal-900/20"
                    : "border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-semibold text-teal-800 dark:text-teal-200">
                      {m.name}
                    </h3>
                    {i === 0 && (
                      <span className="rounded-full bg-teal-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                        Best match
                      </span>
                    )}
                    <span className="rounded-full border border-gray-200 dark:border-slate-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {m.careerOriented ? "Career-focused" : "Transfer-focused"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 line-clamp-2">
                    {m.blurb}
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-slate-600 dark:text-slate-300">
                    <span>
                      <b className="font-semibold text-slate-900 dark:text-slate-100">
                        {m.collegeCount}
                      </b>{" "}
                      {m.collegeCount === 1 ? "college" : "colleges"}
                    </span>
                    <span>
                      <b className="font-semibold text-slate-900 dark:text-slate-100">
                        {m.sectionCount}
                      </b>{" "}
                      sections this term
                    </span>
                    {m.medianWage != null && (
                      <span title="State median annual wage for the program's primary career (U.S. Bureau of Labor Statistics)">
                        <b className="font-semibold text-slate-900 dark:text-slate-100">
                          ${m.medianWage.toLocaleString()}
                        </b>{" "}
                        median pay · BLS
                      </span>
                    )}
                    {answers?.time === "online" &&
                      m.onlinePct != null &&
                      m.onlinePct > 0 && (
                        <span>
                          <b className="font-semibold text-slate-900 dark:text-slate-100">
                            {m.onlinePct}%
                          </b>{" "}
                          online
                        </span>
                      )}
                    {answers?.time === "evening" && m.eveningAvailable && (
                      <span className="text-teal-700 dark:text-teal-300">
                        Evening sections available
                      </span>
                    )}
                  </div>
                </div>
                <Icon
                  path='<path d="M5 12h14M13 6l6 6-6 6"/>'
                  className="h-5 w-5 flex-shrink-0 text-slate-400 group-hover:text-teal-600 transition-colors"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* Honesty note */}
      {matches.length > 0 && (
        <p className="mt-5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          Pay figures are state medians for a typical career from the U.S.
          Bureau of Labor Statistics — a guide, not a guarantee. College and
          section counts reflect the current term. Transfer-focused programs are
          built to continue toward a bachelor&rsquo;s
          {transferSupported ? (
            <>
              {" "}
              —{" "}
              <Link
                href={`/${state}/transfer`}
                className="text-teal-700 dark:text-teal-300 underline underline-offset-2"
              >
                check transfer equivalencies
              </Link>
              .
            </>
          ) : (
            "."
          )}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:border-teal-600 transition-colors"
        >
          <Icon
            path='<path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-6.4 2.6L3 8"/><path d="M3 3v5h5"/>'
            className="h-4 w-4"
          />
          Start over
        </button>
        <Link
          href={`/${state}/programs`}
          className="text-sm font-medium text-teal-700 dark:text-teal-300 underline underline-offset-2"
        >
          See all programs in {stateName}
        </Link>
      </div>
    </>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { countRealCourses, programSlug, PLAN_MIN_COURSES } from "@/lib/programs/plan-shared";
import { plannerHref } from "@/lib/planner-link";
import { track } from "@/lib/analytics";
import type { ProgramRequirement } from "@/lib/types";
import type { Institution } from "@/lib/types";

/**
 * Serializable availability data: "PREFIX NUMBER" → section count.
 * Passed from server components as a plain object (Maps aren't serializable).
 */
export type AvailabilityRecord = Record<string, number>;

// ---------------------------------------------------------------------------
// Per-college expandable card
// ---------------------------------------------------------------------------

function ProgramCard({
  program,
  state,
  collegeId,
  defaultOpen,
  availability,
}: {
  program: ProgramRequirement;
  state: string;
  /** When set, render a link to this program's transfer-validated plan. */
  collegeId?: string;
  defaultOpen?: boolean;
  availability?: AvailabilityRecord;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);

  const credLabel =
    program.credential === "other"
      ? ""
      : ` (${program.credential.toUpperCase()})`;

  const planHref =
    collegeId && countRealCourses(program) >= PLAN_MIN_COURSES
      ? `/${state}/college/${collegeId}/program/${programSlug(program)}`
      : null;

  // Every primary course across the program's requirement groups, as
  // "PREFIX NUMBER" codes, for the "Plan all required courses" deep link into
  // the semester planner. plannerHref de-dupes + caps at 100.
  const allCourseCodes = program.requirement_groups.flatMap((g) =>
    g.courses.map((c) => `${c.prefix} ${c.number}`),
  );
  const planAllHref = plannerHref(state, allCourseCodes);

  return (
    <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-gray-50 dark:hover:bg-slate-800"
        aria-expanded={open}
      >
        <div className="min-w-0">
          <span className="text-sm font-semibold text-gray-900 dark:text-slate-100">
            {program.title}
          </span>
          {credLabel && (
            <span className="ml-1.5 text-xs text-gray-500 dark:text-slate-400">
              {credLabel}
            </span>
          )}
          <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500 dark:text-slate-400">
            {program.total_credits != null && (
              <span>{program.total_credits} credits</span>
            )}
            {program.gpa_minimum != null && (
              <span>{program.gpa_minimum} GPA min</span>
            )}
            {program.requirement_groups.length > 0 && (
              <span>
                {program.requirement_groups.length}{" "}
                {program.requirement_groups.length === 1
                  ? "group"
                  : "groups"}
              </span>
            )}
          </div>
        </div>
        <svg
          className={`h-4 w-4 shrink-0 text-gray-400 dark:text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {planHref && (
        <div className="border-t border-gray-100 dark:border-slate-800 px-4 py-2">
          <Link
            href={planHref}
            className="inline-flex items-center text-xs font-medium text-teal-700 dark:text-teal-400 hover:underline"
          >
            See transfer plan — which courses transfer &amp; what&apos;s offered &rarr;
          </Link>
        </div>
      )}

      {open && (
        <div className="border-t border-gray-200 dark:border-slate-700 px-4 py-3 space-y-4">
          {program.description && (
            <p className="text-sm text-gray-600 dark:text-slate-400">
              {program.description}
            </p>
          )}

          {planAllHref && (
            <Link
              href={planAllHref}
              onClick={() =>
                track("planner_add", {
                  state,
                  source: "program_all",
                  count: Math.min(allCourseCodes.length, 100),
                })
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-900/20 px-3 py-1.5 text-xs font-semibold text-teal-700 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-900/40 transition"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Plan all required courses
            </Link>
          )}

          {program.requirement_groups.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-slate-400 italic">
              Detailed course requirements are not yet available for this
              program.{" "}
              {program.catalog_url && (
                <a
                  href={program.catalog_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-teal-600 dark:text-teal-400 underline"
                >
                  View in college catalog
                </a>
              )}
            </p>
          ) : (
            program.requirement_groups.map((group, gi) => (
              <RequirementGroupBlock
                key={gi}
                group={group}
                state={state}
                availability={availability}
              />
            ))
          )}

          {program.catalog_url && (
            <p className="text-xs text-gray-500 dark:text-slate-400 pt-1 border-t border-gray-100 dark:border-slate-800">
              Source:{" "}
              <a
                href={program.catalog_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-teal-600 dark:text-teal-400 hover:underline"
              >
                College catalog
              </a>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Requirement group (e.g. "Core Requirements", "General Education")
// ---------------------------------------------------------------------------

function AvailabilityBadge({ code, availability }: { code: string; availability?: AvailabilityRecord }) {
  if (!availability) return null;
  const count = availability[code];
  if (count != null && count > 0) {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
        {count} {count === 1 ? "section" : "sections"}
      </span>
    );
  }
  if (count === 0 || (availability && count == null)) {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-50 dark:bg-amber-900/30 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400 whitespace-nowrap">
        not offered
      </span>
    );
  }
  return null;
}

// Catch credit-slot hints in group titles across every state's catalog format
// we've seen: "(6 cr.)", "(6cr)", "(3 Credits)", "(6 credit hours)",
// "(4-6 Credits)" → low end. Falls back to `group.credits_required` when the
// scraper populated the field directly (NY BMCC "Common Core" has no hint in
// the title but credits_required: 4).
const CR_RE = /\b(\d+)(?:[-–]\d+)?\s*(?:cr|credit)s?\b/i;
// "Recommended Course Sequence" / "Course Sequence" headings list the entire
// degree in one bucket — same data shape as a menu but semantically different.
// Render with a "Full degree sequence" framing instead of "Choose N from M".
const SEQUENCE_RE = /recommended.*sequence|course\s+sequence/i;
const MENU_PREVIEW_COUNT = 5;

function RequirementGroupBlock({
  group,
  state,
  availability,
}: {
  group: ProgramRequirement["requirement_groups"][number];
  state: string;
  availability?: AvailabilityRecord;
}) {
  const [expanded, setExpanded] = useState(false);

  const parsedCredits = (() => {
    const m = group.name.match(CR_RE);
    return m ? parseInt(m[1], 10) : null;
  })();
  const effectiveCredits = group.credits_required ?? parsedCredits;

  // "Menu mode" = catalog defines a credit slot but lists more course-credits
  // than the slot needs. Heuristic: courses.length * 3 (assume avg ~3cr each)
  // materially exceeds the slot. Keeps short truly-required groups expanded
  // (Eng Comp 6cr / 2 courses: 6 ≯ 4 → not menu). The >= 2 floor blocks
  // 1-of-1 groups (e.g. SDV 100, 1 cr) from rendering as a fake "choice".
  const menuMode =
    effectiveCredits != null &&
    effectiveCredits > 0 &&
    group.choose_n == null &&
    group.courses.length >= 2 &&
    group.courses.length * 3 > effectiveCredits * 2;
  const sequenceMode = menuMode && SEQUENCE_RE.test(group.name);
  const collapsed = menuMode && !expanded;
  const visibleCourses = collapsed
    ? group.courses.slice(0, MENU_PREVIEW_COUNT)
    : group.courses;

  const heading = sequenceMode
    ? `Full degree sequence — ${group.courses.length} courses, ${effectiveCredits} credits`
    : menuMode
      ? `Choose ${effectiveCredits} credit${effectiveCredits === 1 ? "" : "s"} from ${group.courses.length} approved courses`
      : group.name;

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1.5 flex-wrap">
        <h4 className="text-sm font-medium text-gray-900 dark:text-slate-100">
          {heading}
        </h4>
        {!menuMode && group.credits_required != null && (
          <span className="text-xs text-gray-500 dark:text-slate-400">
            {group.credits_required} credits
          </span>
        )}
        {group.choose_n != null && (
          <span className="text-xs text-teal-600 dark:text-teal-400">
            choose {group.choose_n}
          </span>
        )}
      </div>
      {menuMode && (
        // Preserve the catalog's original title so any extra rules in it
        // (e.g. NC Alamance "from 2 different subject areas") aren't lost.
        <p className="text-xs italic text-gray-500 dark:text-slate-400 mb-1.5">
          Catalog group: {group.name}
        </p>
      )}

      {group.courses.length > 0 ? (
        <>
          <ul className="space-y-0.5">
            {visibleCourses.map((course, ci) => (
              <li key={ci} className="flex items-baseline gap-1.5 text-sm flex-wrap">
                <Link
                  href={`/${state}/course/${course.prefix.toLowerCase()}-${course.number.toLowerCase()}`}
                  className="font-mono text-xs font-medium text-teal-600 dark:text-teal-400 hover:underline whitespace-nowrap"
                >
                  {course.prefix} {course.number}
                </Link>
                <span className="text-gray-700 dark:text-slate-300 truncate">
                  {course.title}
                </span>
                {course.credits != null && (
                  <span className="text-xs text-gray-400 dark:text-slate-500 whitespace-nowrap">
                    ({course.credits} cr)
                  </span>
                )}
                <AvailabilityBadge code={`${course.prefix} ${course.number}`} availability={availability} />
                {course.or_alternatives.length > 0 && (
                  <span className="text-xs text-gray-500 dark:text-slate-400">
                    or{" "}
                    {course.or_alternatives.map((alt, ai) => (
                      <span key={ai}>
                        {ai > 0 && " or "}
                        <Link
                          href={`/${state}/course/${alt.prefix.toLowerCase()}-${alt.number.toLowerCase()}`}
                          className="font-mono text-teal-600 dark:text-teal-400 hover:underline"
                        >
                          {alt.prefix} {alt.number}
                        </Link>
                      </span>
                    ))}
                  </span>
                )}
                <Link
                  href={plannerHref(state, [`${course.prefix} ${course.number}`])}
                  onClick={() =>
                    track("planner_add", { state, source: "program_course", count: 1 })
                  }
                  className="text-[11px] font-medium text-gray-400 dark:text-slate-500 hover:text-teal-600 dark:hover:text-teal-400 hover:underline whitespace-nowrap"
                  title="Add this course to your semester planner"
                >
                  + plan
                </Link>
              </li>
            ))}
          </ul>
          {menuMode && group.courses.length > MENU_PREVIEW_COUNT && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              aria-expanded={expanded}
              className="mt-1.5 text-xs font-medium text-teal-600 dark:text-teal-400 hover:underline"
            >
              {expanded
                ? "Show fewer"
                : sequenceMode
                  ? `Show entire sequence (${group.courses.length} courses)`
                  : `Show all ${group.courses.length} options`}
            </button>
          )}
        </>
      ) : (
        <p className="text-xs text-gray-500 dark:text-slate-400 italic">
          See catalog for course list
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exported component: requirements section for the program hub page
// ---------------------------------------------------------------------------

export default function ProgramRequirements({
  state,
  entries,
  availabilityByCollege,
}: {
  state: string;
  entries: Array<{ college: Institution; programs: ProgramRequirement[] }>;
  availabilityByCollege?: Record<string, AvailabilityRecord>;
}) {
  if (entries.length === 0) return null;

  return (
    <section className="mb-10">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-1">
        Degree requirements by college
      </h2>
      <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
        Expand a college to see the courses required for graduation. Data
        sourced from each college&apos;s official catalog.
      </p>

      <div className="space-y-4">
        {entries.map(({ college, programs }) => (
          <div key={college.id}>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-2 flex items-center gap-2">
              <Link
                href={`/${state}/college/${college.id}`}
                className="text-teal-600 dark:text-teal-400 hover:underline"
              >
                {college.name}
              </Link>
              <span className="text-xs font-normal text-gray-500 dark:text-slate-400">
                {programs.length}{" "}
                {programs.length === 1 ? "program" : "programs"}
              </span>
            </h3>
            <div className="space-y-2 ml-0 sm:ml-4">
              {programs.map((prog, pi) => (
                <ProgramCard
                  key={pi}
                  program={prog}
                  state={state}
                  defaultOpen={programs.length === 1}
                  availability={availabilityByCollege?.[college.college_slug]}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Standalone component for per-college programs page
// ---------------------------------------------------------------------------

export function ProgramList({
  state,
  collegeId,
  programs,
  availability,
}: {
  state: string;
  collegeId?: string;
  programs: ProgramRequirement[];
  availability?: AvailabilityRecord;
}) {
  const byCredential = new Map<string, ProgramRequirement[]>();
  for (const p of programs) {
    const key = p.credential;
    if (!byCredential.has(key)) byCredential.set(key, []);
    byCredential.get(key)!.push(p);
  }

  const credOrder = ["AS", "AA", "AAS", "certificate", "diploma", "other"];
  const credLabels: Record<string, string> = {
    AS: "Associate of Science (AS)",
    AA: "Associate of Arts (AA)",
    AAS: "Associate of Applied Science (AAS)",
    certificate: "Certificates",
    diploma: "Diplomas",
    other: "Other Programs",
  };

  const sorted = [...byCredential.entries()].sort(
    (a, b) => credOrder.indexOf(a[0]) - credOrder.indexOf(b[0]),
  );

  return (
    <div className="space-y-8">
      {sorted.map(([cred, progs]) => (
        <section key={cred}>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-3">
            {credLabels[cred] ?? cred}
            <span className="ml-2 text-sm font-normal text-gray-500 dark:text-slate-400">
              ({progs.length})
            </span>
          </h2>
          <div className="space-y-2">
            {progs
              .sort((a, b) => a.title.localeCompare(b.title))
              .map((prog, pi) => (
                <ProgramCard
                  key={pi}
                  program={prog}
                  state={state}
                  collegeId={collegeId}
                  availability={availability}
                />
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}

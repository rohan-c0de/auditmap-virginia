import Link from "next/link";
import type { Institution } from "@/lib/types";

interface CollegeCardProps {
  institution: Institution;
  distance: number;
  courseCount: number;
  state: string;
}

export default function CollegeCard({
  institution,
  distance,
  courseCount,
  state,
}: CollegeCardProps) {
  const { audit_policy } = institution;

  return (
    <div className="group rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 transition hover:shadow-lg dark:hover:shadow-slate-900/50 sm:p-6">
      {/* Header */}
      <div className="mb-3">
        <h3 className="text-lg font-bold text-gray-900 dark:text-slate-100 group-hover:text-teal-700">
          {institution.name}
        </h3>
        <p className="text-sm text-gray-500 dark:text-slate-400">
          {distance.toFixed(1)} miles away
        </p>
      </div>

      {/* Cost summary */}
      <div className="mb-4 rounded-lg bg-gray-50 dark:bg-slate-800 px-4 py-3">
        <p className="text-sm text-gray-700 dark:text-slate-300">
          {audit_policy.eligibility.senior_discount.available ? (
            <>
              <span className="font-semibold text-teal-700">
                {audit_policy.eligibility.senior_discount.cost === "reduced" ? "Reduced" : "Free"} for {audit_policy.eligibility.senior_discount.age_threshold}+
              </span>
              {audit_policy.cost_note && (
                <span className="text-gray-500 dark:text-slate-400"> · {audit_policy.cost_note}</span>
              )}
            </>
          ) : (
            <span>{audit_policy.cost_note || "Contact for pricing details"}</span>
          )}
        </p>
      </div>

      {/* Course count + link */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-slate-400">
          <span className="font-semibold text-gray-700 dark:text-slate-300">{courseCount}</span>{" "}
          {courseCount === 1 ? "course" : "courses"} this term
        </p>
        <Link
          href={`/${state}/college/${institution.id}`}
          className="inline-flex items-center text-sm font-semibold text-teal-600 transition hover:text-teal-800"
        >
          Browse Courses
          <svg
            className="ml-1 h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 5l7 7-7 7"
            />
          </svg>
        </Link>
      </div>
    </div>
  );
}

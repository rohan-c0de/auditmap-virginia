import Link from "next/link";
import type { Metadata } from "next";
import institutionsData from "@/data/institutions.json";
import { getCourseCount } from "@/lib/courses";
import { getCurrentTerm } from "@/lib/terms";
import type { Institution } from "@/lib/types";

const institutions = institutionsData as Institution[];

export const metadata: Metadata = {
  title: "All 23 VCCS Colleges — AuditMap Virginia",
  description:
    "Browse all Virginia community colleges and their course auditing policies.",
};

export default function CollegesPage() {
  // Sort alphabetically
  const sorted = [...institutions].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  const verifiedCount = sorted.filter(
    (i) => i.audit_policy.allowed === true
  ).length;
  const unverifiedCount = sorted.filter(
    (i) => i.audit_policy.allowed === null
  ).length;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <Link
        href="/"
        className="text-sm text-teal-600 hover:text-teal-700 mb-6 inline-block"
      >
        &larr; Back to search
      </Link>

      <h1 className="text-3xl font-bold text-gray-900 mb-2">
        All 23 VCCS Colleges
      </h1>
      <p className="text-gray-600 mb-8">
        {verifiedCount} with verified audit policies · {unverifiedCount} pending
        verification
      </p>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {sorted.map((institution) => {
          const courseCount = getCourseCount(
            institution.vccs_slug,
            getCurrentTerm()
          );
          const allowed = institution.audit_policy.allowed;

          return (
            <Link
              key={institution.id}
              href={`/college/${institution.id}`}
              className="group block rounded-lg border border-gray-200 bg-white p-4 transition hover:shadow-md hover:border-teal-300"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <h2 className="font-semibold text-gray-900 group-hover:text-teal-700 text-sm leading-tight">
                  {institution.name}
                </h2>
                {allowed === true ? (
                  <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                    <span className="h-1 w-1 rounded-full bg-emerald-500" />
                    Verified
                  </span>
                ) : (
                  <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
                    <span className="h-1 w-1 rounded-full bg-amber-500" />
                    Unverified
                  </span>
                )}
              </div>

              <p className="text-xs text-gray-500 mb-3">
                {institution.campuses.map((c) => c.name).join(" · ")}
              </p>

              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">
                  {courseCount > 0 ? (
                    <>
                      <span className="font-medium text-gray-700">
                        {courseCount}
                      </span>{" "}
                      courses
                    </>
                  ) : (
                    <span className="text-gray-400">No course data</span>
                  )}
                </span>
                {allowed === true &&
                  institution.audit_policy.eligibility.senior_discount
                    .available && (
                    <span className="text-teal-600 font-medium">
                      Free for 60+
                    </span>
                  )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

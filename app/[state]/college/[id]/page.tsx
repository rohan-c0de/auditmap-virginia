import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { loadInstitutions } from "@/lib/institutions";
import { loadCoursesForCollege, isDataStale, getAvailableTerms } from "@/lib/courses";
import { isInProgress } from "@/lib/course-status";
import { getCurrentTerm, termLabel } from "@/lib/terms";
import CollegeDetailClient from "./CollegeDetailClient";
import CollegeMap from "./CollegeMap";
import TermSelector from "./TermSelector";
import { buildTransferLookup } from "@/lib/transfer";
import { getStateConfig, getAllStates } from "@/lib/states/registry";

// Revalidate every 24 hours — course data only changes when re-scraped
export const revalidate = 86400;

type PageProps = {
  params: Promise<{ state: string; id: string }>;
  searchParams: Promise<{ term?: string }>;
};

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const { state, id } = await props.params;
  const institutions = loadInstitutions(state);
  const institution = institutions.find((i) => i.id === id);
  if (!institution) return { title: "College Not Found" };

  return {
    title: `${institution.name} — Audit Courses | AuditMap ${getStateConfig(state).name}`,
    description: `Find out how to audit courses at ${institution.name}. ${
      institution.audit_policy.allowed
        ? "Auditing is available."
        : "Contact the college to confirm audit policies."
    }`,
  };
}

export function generateStaticParams() {
  return getAllStates().flatMap((config) =>
    loadInstitutions(config.slug).map((i) => ({ state: config.slug, id: i.id }))
  );
}

export default async function CollegeDetailPage(props: PageProps) {
  const { state, id } = await props.params;
  const { term: requestedTerm } = await props.searchParams;
  const config = getStateConfig(state);
  const institutions = loadInstitutions(state);
  const institution = institutions.find((i) => i.id === id);

  if (!institution) {
    notFound();
  }

  // Build list of terms that have data for THIS college
  const allTerms = getAvailableTerms(state);
  const termsWithData = allTerms
    .filter((t) => loadCoursesForCollege(institution.college_slug, t, state).length > 0)
    .sort();

  // Use requested term if valid, otherwise fall back to latest with data
  let currentTerm = requestedTerm && termsWithData.includes(requestedTerm)
    ? requestedTerm
    : getCurrentTerm(state);
  let courses = loadCoursesForCollege(institution.college_slug, currentTerm, state);
  if (courses.length === 0) {
    // Fall back to earlier terms that have data for this college
    for (const t of [...termsWithData].reverse()) {
      const c = loadCoursesForCollege(institution.college_slug, t, state);
      if (c.length > 0) {
        currentTerm = t;
        courses = c;
        break;
      }
    }
  }
  const stale = isDataStale(institution.college_slug, currentTerm, state);

  const collegeSlug = institution.college_slug;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://auditmap.virginia.example.com";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "EducationalOrganization",
    name: institution.name,
    url: `${siteUrl}/${state}/college/${institution.id}`,
    address: {
      "@type": "PostalAddress",
      addressRegion: "VA",
      addressCountry: "US",
    },
    ...(institution.campuses?.[0] && {
      geo: {
        "@type": "GeoCoordinates",
        latitude: institution.campuses[0].lat,
        longitude: institution.campuses[0].lng,
      },
    }),
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/* Breadcrumb */}
      <Link
        href={`/${state}`}
        className="text-sm text-teal-600 hover:text-teal-700 mb-4 inline-block"
      >
        &larr; Back to search
      </Link>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">
          {institution.name}
        </h1>
        <p className="text-gray-600 mt-1">
          {institution.campuses.map((c) => c.name).join(" · ")}
        </p>

        {/* Audit status badge */}
        <div className="mt-3">
          {institution.audit_policy.allowed === true && (
            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
              Auditing Available
            </span>
          )}
          {institution.audit_policy.allowed === null && (
            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800">
              Contact to Confirm
            </span>
          )}
          {institution.audit_policy.allowed === false && (
            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-800">
              Auditing Not Available
            </span>
          )}
        </div>
      </div>

      {/* Campus map */}
      {institution.campuses.length > 0 && (
        <div className="mb-8 h-[250px] rounded-lg overflow-hidden border border-gray-200">
          <CollegeMap institution={institution} />
        </div>
      )}

      {/* Staleness warning */}
      {stale && courses.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
          <p className="text-amber-800 text-sm">
            <strong>Note:</strong> Course data may be outdated (last updated
            more than 8 days ago). Check{" "}
            <a
              href={config.collegeCoursesUrl(institution.college_slug)}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              {config.systemName} course site
            </a>{" "}
            for the latest listings.
          </p>
        </div>
      )}

      {/* Audit Policy Section */}
      <section className="bg-white border border-gray-200 rounded-lg p-6 mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">
          Audit Policy
        </h2>

        {institution.audit_policy.allowed === null ? (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <p className="text-yellow-800">
              We haven&apos;t verified this college&apos;s audit policy yet.
              Contact the registrar to confirm whether auditing is available.
            </p>
            {institution.audit_policy.application_process.contact_email && (
              <p className="mt-2 text-yellow-800">
                Email:{" "}
                <a
                  href={`mailto:${institution.audit_policy.application_process.contact_email}`}
                  className="underline"
                >
                  {institution.audit_policy.application_process.contact_email}
                </a>
              </p>
            )}
            {institution.audit_policy.application_process.contact_phone && (
              <p className="mt-1 text-yellow-800">
                Phone:{" "}
                {institution.audit_policy.application_process.contact_phone}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Cost */}
            <div>
              <h3 className="font-medium text-gray-900 mb-1">Cost</h3>
              <p className="text-gray-600">
                {institution.audit_policy.cost_note}
              </p>
              {institution.audit_policy.eligibility.senior_discount
                .available && (
                <div className="mt-2 bg-teal-50 border border-teal-200 rounded p-3">
                  <p className="text-teal-800 text-sm font-medium">
                    60+ Senior Discount:{" "}
                    {
                      institution.audit_policy.eligibility.senior_discount
                        .cost
                    }
                  </p>
                  <p className="text-teal-700 text-xs mt-1">
                    {
                      institution.audit_policy.eligibility.senior_discount
                        .notes
                    }
                  </p>
                </div>
              )}
            </div>

            {/* Eligibility */}
            <div>
              <h3 className="font-medium text-gray-900 mb-1">Eligibility</h3>
              <ul className="text-gray-600 text-sm space-y-1">
                <li>
                  Minimum age:{" "}
                  {institution.audit_policy.eligibility.minimum_age}
                </li>
                <li>
                  Residency required:{" "}
                  {institution.audit_policy.eligibility.residency_required
                    ? "Yes"
                    : "No"}
                </li>
              </ul>
            </div>

            {/* Application process */}
            {institution.audit_policy.application_process.steps.length > 0 && (
              <div>
                <h3 className="font-medium text-gray-900 mb-2">
                  How to Apply
                </h3>
                <ol className="list-decimal list-inside text-gray-600 text-sm space-y-2">
                  {institution.audit_policy.application_process.steps.map(
                    (step, i) => (
                      <li key={i}>{step}</li>
                    )
                  )}
                </ol>
                {institution.audit_policy.application_process.timing && (
                  <p className="mt-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                    Deadline:{" "}
                    {institution.audit_policy.application_process.timing}
                  </p>
                )}
              </div>
            )}

            {/* Contact */}
            <div>
              <h3 className="font-medium text-gray-900 mb-1">Contact</h3>
              <div className="text-sm text-gray-600 space-y-1">
                {institution.audit_policy.application_process.contact_email && (
                  <p>
                    Email:{" "}
                    <a
                      href={`mailto:${institution.audit_policy.application_process.contact_email}`}
                      className="text-teal-600 hover:underline"
                    >
                      {
                        institution.audit_policy.application_process
                          .contact_email
                      }
                    </a>
                  </p>
                )}
                {institution.audit_policy.application_process.contact_phone && (
                  <p>
                    Phone:{" "}
                    {institution.audit_policy.application_process.contact_phone}
                  </p>
                )}
                {institution.audit_policy.application_process.form_url && (
                  <p>
                    <a
                      href={
                        institution.audit_policy.application_process.form_url
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-teal-600 hover:underline"
                    >
                      Audit Request Form &rarr;
                    </a>
                  </p>
                )}
              </div>
            </div>

            {/* Restrictions */}
            {institution.audit_policy.restrictions.length > 0 && (
              <div>
                <h3 className="font-medium text-gray-900 mb-1">
                  Restrictions
                </h3>
                <ul className="text-gray-600 text-sm space-y-1 list-disc list-inside">
                  {institution.audit_policy.restrictions.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Verification */}
            <div className="border-t border-gray-200 pt-4 text-xs text-gray-400">
              Last verified: {institution.audit_policy.last_verified}
              {institution.audit_policy.source_url && (
                <>
                  {" · "}
                  <a
                    href={institution.audit_policy.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-gray-600"
                  >
                    Source
                  </a>
                </>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Course Listings */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold text-gray-900">
              {termLabel(currentTerm)} Courses{" "}
              <span className="text-gray-500 font-normal text-base">
                ({courses.length} sections)
              </span>
            </h2>
            {termsWithData.length > 1 && (
              <TermSelector
                terms={termsWithData.map((t) => ({ code: t, label: termLabel(t) }))}
                currentTerm={currentTerm}
                collegeId={institution.id}
                state={state}
              />
            )}
          </div>
          <a
            href={config.collegeCoursesUrl(institution.college_slug)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-teal-600 hover:text-teal-700"
          >
            View on {config.systemName} &rarr;
          </a>
        </div>

        {/* Registration status summary */}
        {courses.length > 0 && (() => {
          const upcoming = courses.filter((c) => !isInProgress(c.start_date)).length;
          const started = courses.length - upcoming;
          return upcoming > 0 ? (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
              <span className="text-emerald-800">
                <strong>{upcoming}</strong> {upcoming === 1 ? "section" : "sections"} still open for registration
              </span>
              <span className="text-emerald-600">·</span>
              <span className="text-emerald-600">
                {started} already in progress
              </span>
            </div>
          ) : (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm">
              <span className="inline-block h-2 w-2 rounded-full bg-gray-300" />
              <span className="text-gray-600">
                All {started} sections have already started
              </span>
            </div>
          );
        })()}

        {courses.length === 0 ? (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
            <p className="text-gray-600 mb-2">
              No course data available for this term.
            </p>
            <a
              href={config.collegeCoursesUrl(institution.college_slug)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-teal-600 hover:underline text-sm"
            >
              Check {config.systemName} course site directly &rarr;
            </a>
          </div>
        ) : (
          <CollegeDetailClient
            courses={courses}
            institution={institution}
            collegeSlug={collegeSlug}
            transferLookup={buildTransferLookup(state)}
            systemName={config.systemName}
            courseListingUrl={config.courseDiscoveryUrl(collegeSlug, "", "")}
          />
        )}
      </section>
    </div>
  );
}

import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { loadInstitutions } from "@/lib/institutions";
import {
  loadCoursesForCollege,
  isDataStale,
  getAvailableTerms,
  trimCoursesForClient,
} from "@/lib/courses";
import { getCurrentTerm } from "@/lib/terms";
import CollegeMap from "./CollegeMap";
import CollegeTermSection from "./CollegeTermSection";
import { buildTransferLookupForCourses } from "@/lib/transfer-scoped";
import { getStateConfig, getAllStates } from "@/lib/states/registry";
import { getTopInstructors } from "@/lib/instructors";
import type { CourseSection } from "@/lib/types";
import AdUnit from "@/components/AdUnit";
import TrackView from "@/components/TrackView";

// Revalidate every 24 hours — course data only changes when re-scraped
export const revalidate = 86400;

type PageProps = {
  params: Promise<{ state: string; id: string }>;
  // Note: searchParams intentionally omitted. Reading searchParams in a server
  // page is a Request-time API that opts the route into fully dynamic
  // rendering and disables ISR edge caching. The `?term=` selection is now
  // handled client-side in CollegeTermSection via useSearchParams.
};

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const { state, id } = await props.params;
  const institutions = loadInstitutions(state);
  const institution = institutions.find((i) => i.id === id);
  if (!institution) return { title: "College Not Found" };

  return {
    title: `${institution.name} — Courses & Transfer Info | Community College Path ${getStateConfig(state).name}`,
    description: `Find out how to audit courses at ${institution.name}. ${
      institution.audit_policy.allowed
        ? "Auditing is available."
        : "Contact the college to confirm audit policies."
    }`,
    alternates: { canonical: `/${state}/college/${id}` },
  };
}

export function generateStaticParams() {
  return getAllStates().flatMap((config) =>
    loadInstitutions(config.slug).map((i) => ({ state: config.slug, id: i.id }))
  );
}

export default async function CollegeDetailPage(props: PageProps) {
  const { state, id } = await props.params;
  const config = getStateConfig(state);
  const institutions = loadInstitutions(state);
  const institution = institutions.find((i) => i.id === id);

  if (!institution) {
    notFound();
  }

  // Load courses for every term this college has data in. Doing this server-
  // side lets the client switch terms via the URL without triggering a fresh
  // server render, which would force the whole page out of ISR.
  const allTerms = await getAvailableTerms(state);
  const termCoursePairs: { term: string; courses: CourseSection[] }[] =
    await Promise.all(
      allTerms.map(async (t) => ({
        term: t,
        courses: await loadCoursesForCollege(institution.college_slug, t, state),
      }))
    );
  const termsWithData = termCoursePairs
    .filter((p) => p.courses.length > 0)
    .map((p) => p.term)
    .sort();

  // Default term = most-recent term with data (same fallback logic the page
  // used previously, only now it no longer depends on ?term=).
  const preferredTerm = await getCurrentTerm(state);
  const defaultTerm = termsWithData.includes(preferredTerm)
    ? preferredTerm
    : (termsWithData[termsWithData.length - 1] ?? preferredTerm);

  const collegeSlug = institution.college_slug;

  // Build per-term maps for the client wrapper. Only the terms that actually
  // have data are shipped.
  const coursesByTerm: Record<string, CourseSection[]> = {};
  const staleByTerm: Record<string, boolean> = {};
  const topInstructorsByTerm: Record<
    string,
    { slug: string; displayName: string; sectionCount: number }[]
  > = {};
  const courseListingUrlByTerm: Record<string, string> = {};

  const union: CourseSection[] = [];
  await Promise.all(
    termsWithData.map(async (t) => {
      const courses =
        termCoursePairs.find((p) => p.term === t)?.courses ?? [];
      coursesByTerm[t] = trimCoursesForClient(courses);
      staleByTerm[t] = await isDataStale(collegeSlug, t, state);
      topInstructorsByTerm[t] = await getTopInstructors(
        collegeSlug,
        t,
        state
      );
      courseListingUrlByTerm[t] = config.courseDiscoveryUrl(
        collegeSlug,
        "__PREFIX__",
        "__NUMBER__",
        t
      );
      union.push(...courses);
    })
  );

  // Shared transfer lookup, scoped to the union of courses across all terms
  // so the map stays the same regardless of which term the client picks.
  // Targeted Supabase query instead of loading the whole state catalog.
  const transferLookup = await buildTransferLookupForCourses(union, state);

  const systemCollegeCoursesUrl = config.collegeCoursesUrl(collegeSlug);

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com";
  const stateAbbr = state.toUpperCase();
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "EducationalOrganization",
    name: institution.name,
    url: `${siteUrl}/${state}/college/${institution.id}`,
    address: {
      "@type": "PostalAddress",
      addressRegion: stateAbbr,
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
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${siteUrl}/${state}` },
      { "@type": "ListItem", position: 2, name: "Colleges", item: `${siteUrl}/${state}/colleges` },
      { "@type": "ListItem", position: 3, name: institution.name },
    ],
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <TrackView
        event="college_detail_view"
        params={{ state, college: id }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
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
        <h1 className="text-3xl font-bold text-gray-900 dark:text-slate-100">
          {institution.name}
        </h1>
        <p className="text-gray-600 dark:text-slate-400 mt-1">
          {institution.campuses.map((c) => c.name).join(" · ")}
        </p>

        {/* Status badge */}
        <div className="mt-3">
          {institution.audit_policy.allowed === true && (
            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400">
              Verified
            </span>
          )}
          {institution.audit_policy.allowed === null && (
            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400">
              Contact to Confirm
            </span>
          )}
          {institution.audit_policy.allowed === false && (
            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400">
              Auditing Not Available
            </span>
          )}
        </div>
      </div>

      {/* Campus map */}
      {institution.campuses.length > 0 && (
        <div className="mb-8 h-[250px] rounded-lg overflow-hidden border border-gray-200 dark:border-slate-700 isolate">
          <CollegeMap institution={institution} />
        </div>
      )}

      {/* Term-dependent content (staleness, term picker, course table, subject
          browser, instructor browser) — client-rendered so ?term= switches
          happen without a server round-trip. */}
      <CollegeTermSection
        coursesByTerm={coursesByTerm}
        termsWithData={termsWithData}
        defaultTerm={defaultTerm}
        staleByTerm={staleByTerm}
        topInstructorsByTerm={topInstructorsByTerm}
        courseListingUrlByTerm={courseListingUrlByTerm}
        transferLookup={transferLookup}
        institution={institution}
        collegeSlug={collegeSlug}
        state={state}
        id={id}
        systemName={config.systemName}
        systemCollegeCoursesUrl={systemCollegeCoursesUrl}
      />

      {/* Audit Policy — collapsed by default, below courses */}
      <section className="mt-8">
        <details className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg">
          <summary className="px-6 py-4 cursor-pointer select-none flex items-center justify-between text-lg font-semibold text-gray-900 dark:text-slate-100 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors rounded-lg">
            <span>Audit Policy</span>
            <svg className="w-5 h-5 text-gray-400 dark:text-slate-500 transition-transform details-open:rotate-180" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </summary>
          <div className="px-6 pb-6">
            {institution.audit_policy.allowed === null ? (
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                <p className="text-yellow-800 dark:text-yellow-400">
                  We haven&apos;t verified this college&apos;s audit policy yet.
                  Contact the registrar to confirm whether auditing is available.
                </p>
                {institution.audit_policy.application_process.contact_email && (
                  <p className="mt-2 text-yellow-800 dark:text-yellow-400">
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
                  <p className="mt-1 text-yellow-800 dark:text-yellow-400">
                    Phone:{" "}
                    {institution.audit_policy.application_process.contact_phone}
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-6">
                {/* Cost */}
                <div>
                  <h3 className="font-medium text-gray-900 dark:text-slate-100 mb-1">Cost</h3>
                  <p className="text-gray-600 dark:text-slate-400">
                    {institution.audit_policy.cost_note}
                  </p>
                  {institution.audit_policy.eligibility.senior_discount
                    .available && (
                    <div className="mt-2 bg-teal-50 dark:bg-teal-900/30 border border-teal-200 dark:border-teal-800 rounded p-3">
                      <p className="text-teal-800 dark:text-teal-300 text-sm font-medium">
                        {institution.audit_policy.eligibility.senior_discount.age_threshold ?? 60}+ Senior Discount:{" "}
                        {institution.audit_policy.eligibility.senior_discount.cost}
                      </p>
                      <p className="text-teal-700 dark:text-teal-400 text-xs mt-1">
                        {institution.audit_policy.eligibility.senior_discount.notes}
                      </p>
                    </div>
                  )}
                </div>

                {/* Eligibility */}
                <div>
                  <h3 className="font-medium text-gray-900 dark:text-slate-100 mb-1">Eligibility</h3>
                  <ul className="text-gray-600 dark:text-slate-400 text-sm space-y-1">
                    <li>Minimum age: {institution.audit_policy.eligibility.minimum_age}</li>
                    <li>Residency required: {institution.audit_policy.eligibility.residency_required ? "Yes" : "No"}</li>
                  </ul>
                </div>

                {/* Application process */}
                {institution.audit_policy.application_process.steps.length > 0 && (
                  <div>
                    <h3 className="font-medium text-gray-900 dark:text-slate-100 mb-2">How to Apply</h3>
                    <ol className="list-decimal list-inside text-gray-600 dark:text-slate-400 text-sm space-y-2">
                      {institution.audit_policy.application_process.steps.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ol>
                    {institution.audit_policy.application_process.timing && (
                      <p className="mt-2 text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded p-2">
                        Deadline: {institution.audit_policy.application_process.timing}
                      </p>
                    )}
                  </div>
                )}

                {/* Contact */}
                <div>
                  <h3 className="font-medium text-gray-900 dark:text-slate-100 mb-1">Contact</h3>
                  <div className="text-sm text-gray-600 dark:text-slate-400 space-y-1">
                    {institution.audit_policy.application_process.contact_email && (
                      <p>
                        Email:{" "}
                        <a href={`mailto:${institution.audit_policy.application_process.contact_email}`} className="text-teal-600 hover:underline">
                          {institution.audit_policy.application_process.contact_email}
                        </a>
                      </p>
                    )}
                    {institution.audit_policy.application_process.contact_phone && (
                      <p>Phone: {institution.audit_policy.application_process.contact_phone}</p>
                    )}
                    {institution.audit_policy.application_process.form_url && (
                      <p>
                        <a href={institution.audit_policy.application_process.form_url} target="_blank" rel="noopener noreferrer" className="text-teal-600 hover:underline">
                          Audit Request Form &rarr;
                        </a>
                      </p>
                    )}
                  </div>
                </div>

                {/* Restrictions */}
                {institution.audit_policy.restrictions.length > 0 && (
                  <div>
                    <h3 className="font-medium text-gray-900 dark:text-slate-100 mb-1">Restrictions</h3>
                    <ul className="text-gray-600 dark:text-slate-400 text-sm space-y-1 list-disc list-inside">
                      {institution.audit_policy.restrictions.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Verification */}
                <div className="border-t border-gray-200 dark:border-slate-700 pt-4 text-xs text-gray-400 dark:text-slate-500">
                  Last verified: {institution.audit_policy.last_verified}
                  {institution.audit_policy.source_url && (
                    <>
                      {" · "}
                      <a href={institution.audit_policy.source_url} target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-600 dark:hover:text-slate-400">
                        Source
                      </a>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </details>
      </section>

      {/* In-page ad (well after main content per AdSense policy) */}
      <div className="mt-8">
        <AdUnit slot="3816492750" format="auto" className="min-h-[100px]" />
      </div>

      {/* Other colleges in this state — internal linking for SEO */}
      {(() => {
        const allInstitutions = loadInstitutions(state);
        const others = allInstitutions
          .filter((i) => i.id !== id)
          .sort((a, b) => a.name.localeCompare(b.name))
          .slice(0, 6);
        if (others.length === 0) return null;
        return (
          <section className="mt-8">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-3">
              Other {config.systemName} Colleges
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {others.map((inst) => (
                <Link
                  key={inst.id}
                  href={`/${state}/college/${inst.id}`}
                  className="group block rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 transition hover:shadow-md hover:border-teal-300"
                >
                  <h3 className="font-medium text-sm text-gray-900 dark:text-slate-100 group-hover:text-teal-700 transition-colors">
                    {inst.name}
                  </h3>
                  <p className="text-[11px] text-gray-400 dark:text-slate-500 truncate mt-0.5">
                    {inst.campuses?.map((c) => c.name).join(", ")}
                  </p>
                </Link>
              ))}
            </div>
            <p className="text-center mt-3">
              <Link
                href={`/${state}/colleges`}
                className="text-sm text-teal-600 hover:text-teal-700 transition-colors"
              >
                View all {config.collegeCount} {config.systemName} colleges &rarr;
              </Link>
            </p>
          </section>
        );
      })()}
    </div>
  );
}

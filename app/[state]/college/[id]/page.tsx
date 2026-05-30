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
import { runPooled } from "@/lib/concurrency";
import { getCurrentTerm } from "@/lib/terms";
import CollegeScorecardSection from "./CollegeScorecardSection";
import CollegeTermSection from "./CollegeTermSection";
import CollegeContext from "@/components/CollegeContext";
import TopProgramsSection from "./TopProgramsSection";
import { loadCollegePrograms } from "@/lib/programs/requirements";
import { countRealCourses, PLAN_MIN_COURSES } from "@/lib/programs/plan-shared";
import { buildTransferLookupForCourses } from "@/lib/transfer-scoped";
import { getPrerenderStates } from "@/lib/states/registry";
import { requireStateConfig } from "@/lib/states/route-helpers";
import { getTopInstructors } from "@/lib/instructors";
import { computeOfferingProfile } from "@/lib/college-stats";
import { subjectName } from "@/lib/subjects";
import type { CourseSection } from "@/lib/types";
import SectionHeading from "@/components/SectionHeading";
import AdUnit from "@/components/AdUnit";
import TrackView from "@/components/TrackView";
import RelatedBlogPosts from "@/components/RelatedBlogPosts";
import { getBlogRecommendations } from "@/lib/blog-recommendations";
import {
  getCollegeLastUpdated,
  formatLastUpdated,
} from "@/lib/data-freshness";
import {
  getScorecard,
  formatDollar,
  formatPercent,
} from "@/lib/scorecard";

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

  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com";

  return {
    title: `${institution.name} — Courses & Transfer Info | Community College Path ${requireStateConfig(state).name}`,
    description: `Find out how to audit courses at ${institution.name}. ${
      institution.audit_policy.allowed
        ? "Auditing is available."
        : "Contact the college to confirm audit policies."
    }`,
    alternates: { canonical: `/${state}/college/${id}` },
    openGraph: {
      images: [{
        url: `${baseUrl}/${state}/college/${id}/opengraph-image`,
        width: 1200,
        height: 630,
        alt: `${institution.name} — courses, audit policy, and transfer info on Community College Path`,
      }],
    },
  };
}

// Sparse SSG (#702): pre-render only the colleges whose state config sets
// `prerenderAtBuild: true`. Everything else renders on demand via ISR
// (24h `revalidate` below) on the first visit and serves from the CDN
// thereafter.
//
// Invalid (state, id) pairs still return a true HTTP 404 because the page
// body calls `notFound()` after the in-memory `institutions.find()` miss.
// Switching `dynamicParams` to `true` does not weaken the 404 guarantee
// the previous `false` setting offered; it only lets Next.js reach the
// page handler before bailing. The handler is a synchronous array lookup,
// so the per-invalid-request CPU cost is negligible.
//
// State priority is set on each StateConfig rather than hardcoded here —
// see CLAUDE.md invariant #1. To promote a state into the build-time
// tier, set `prerenderAtBuild: true` in `lib/states/{slug}/config.ts`.
export const dynamicParams = true;

export function generateStaticParams() {
  return getPrerenderStates().flatMap((config) =>
    loadInstitutions(config.slug).map((i) => ({ state: config.slug, id: i.id }))
  );
}

export default async function CollegeDetailPage(props: PageProps) {
  const { state, id } = await props.params;
  const config = requireStateConfig(state);
  const institutions = loadInstitutions(state);
  const institution = institutions.find((i) => i.id === id);

  if (!institution) {
    notFound();
  }

  // Load courses for every term this college has data in. Doing this server-
  // side lets the client switch terms via the URL without triggering a fresh
  // server render, which would force the whole page out of ISR.
  //
  // Concurrency note: each loadCoursesForCollege call internally fires
  // (count + N paginated fetches) capped at runPooled(..., 5). With ~4-6
  // terms fanned out at once via a naked Promise.all, peak parallelism per
  // college page was 4-6 × ~5 = ~20-30 simultaneous Supabase queries. Stack
  // that across the build's 3 worker processes and pgbouncer saturates,
  // producing the statement_timeout cascade visible on PRs #823 / #824 /
  // #825 / #826. Cap term-fan-out to 2 to keep peak in-flight queries per
  // page render at ~10.
  const allTerms = await getAvailableTerms(state);
  const termCoursePairs: { term: string; courses: CourseSection[] }[] =
    await runPooled(
      allTerms.map((t) => async () => ({
        term: t,
        courses: await loadCoursesForCollege(institution.college_slug, t, state),
      })),
      2,
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

  // How many of this college's programs have enough real courses to render a
  // transfer plan? Gates the "Plan a degree" call-to-action so it never points
  // at a programs page with no actual plans.
  const plannableCount = (await loadCollegePrograms(state, collegeSlug)).filter(
    (p) => countRealCourses(p) >= PLAN_MIN_COURSES,
  ).length;

  // Build per-term maps for the client wrapper. Only the terms that actually
  // have data are shipped.
  const coursesByTerm: Record<string, CourseSection[]> = {};
  const staleByTerm: Record<string, boolean> = {};
  const topInstructorsByTerm: Record<
    string,
    { slug: string; displayName: string; sectionCount: number }[]
  > = {};
  const courseListingUrlByTerm: Record<string, string> = {};

  // Same fan-out concern as the first Promise.all above: each iteration
  // fires isDataStale (1 query) + getTopInstructors (1 query) per term;
  // unbounded across N terms × 3 build workers × the parent loop's already
  // running queries piles onto pgbouncer. Cap to 2.
  const union: CourseSection[] = [];
  await runPooled(
    termsWithData.map((t) => async () => {
      const courses =
        termCoursePairs.find((p) => p.term === t)?.courses ?? [];
      // Only ship the default term's courses in the initial RSC payload.
      // Other terms are fetched on demand by CollegeTermSection via
      // /api/{state}/college/{id}/courses?term=X, cutting the initial
      // HTML from ~1 MB (all terms) to ~250 KB.
      if (t === defaultTerm) {
        coursesByTerm[t] = trimCoursesForClient(courses);
      }
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
      // Build union from all terms so the transfer lookup covers
      // every course the college offers, regardless of which term
      // the user has selected.
      union.push(...courses);
    }),
    2,
  );

  // Shared transfer lookup, scoped to the union of courses across all terms
  // so the map stays the same regardless of which term the client picks.
  // Targeted Supabase query instead of loading the whole state catalog.
  const transferLookup = await buildTransferLookupForCourses(union, state);

  // Course Offering Profile — server-side computed stats from the
  // most-recent term's sections. Surfaces mode breakdown, start-date
  // diversity, and top subject prefixes so the per-college page has
  // substantive unique content beyond the standard course catalog
  // (which is rendered client-side and not seen by Googlebot until JS
  // runs). Computed inline from data already in scope, no extra I/O.
  const offeringProfile = computeOfferingProfile(
    coursesByTerm[defaultTerm] ?? []
  );

  const systemCollegeCoursesUrl = config.collegeCoursesUrl(collegeSlug);

  const lastUpdated = getCollegeLastUpdated(state, institution.college_slug);

  // Scorecard data for the hero stat card (students, tuition, completion rate)
  const scorecard = getScorecard(state, id);

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com";
  const stateAbbr = state.toUpperCase();
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollegeOrUniversity",
    "@id": `${siteUrl}/${state}/college/${institution.id}#college`,
    name: institution.name,
    url: `${siteUrl}/${state}/college/${institution.id}`,
    // Tie the institution back to the site-wide WebSite + Organization
    // declared in the root layout so Google can build a connected entity
    // graph rather than treating each page's schema as isolated.
    isPartOf: { "@id": `${siteUrl}/#website` },
    parentOrganization: {
      "@type": "EducationalOrganization",
      name: config.systemName,
    },
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
    ...(lastUpdated && { dateModified: lastUpdated.toISOString() }),
  };
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${siteUrl}/${state}` },
      { "@type": "ListItem", position: 2, name: "Colleges", item: `${siteUrl}/${state}/colleges` },
      { "@type": "ListItem", position: 3, name: institution.name, item: `${siteUrl}/${state}/college/${id}` },
    ],
  };

  // Derive audit cost stat for hero card
  const sd = institution.audit_policy.eligibility.senior_discount;
  const auditCostStat = sd.available
    ? `Free ${sd.age_threshold ?? 60}+`
    : institution.audit_policy.allowed === false
    ? "N/A"
    : institution.audit_policy.cost_note
    ? institution.audit_policy.cost_note.slice(0, 14)
    : "—";

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
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
        href={`/${state}/colleges`}
        className="text-sm text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 mb-5 inline-block"
      >
        &larr; {config.name} colleges
      </Link>

      {/* COMPACT HERO */}
      <section className="mb-0 pb-7 grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-end">
        {/* Left — identity */}
        <div className="lg:col-span-7">
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <span className="text-xs font-mono font-medium uppercase tracking-wider text-teal-700 dark:text-teal-400">
              {config.systemName}
            </span>
            {lastUpdated && (
              <span className="text-xs font-mono text-gray-400 dark:text-slate-500">
                {formatLastUpdated(lastUpdated)}
              </span>
            )}
          </div>
          <h1 className="text-4xl font-semibold tracking-tight leading-tight text-gray-900 dark:text-slate-100">
            {institution.name}
          </h1>
          {institution.campuses.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600 dark:text-slate-400">
              {institution.campuses.map((c) => (
                <span key={c.name} className="inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-teal-500 shrink-0" />
                  {c.name}
                </span>
              ))}
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {institution.audit_policy.allowed === true && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-400 px-3 py-1 text-xs font-medium">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-8 8a1 1 0 01-1.4 0l-4-4a1 1 0 011.4-1.4L8 12.6l7.3-7.3a1 1 0 011.4 0z" clipRule="evenodd" />
                </svg>
                Audit verified
              </span>
            )}
            {institution.audit_policy.allowed === null && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-400 px-3 py-1 text-xs font-medium">
                Contact to confirm
              </span>
            )}
            {sd.available && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-400 px-3 py-1 text-xs font-medium">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 1.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.5 7.7l5.9-.9L10 1.5z" />
                </svg>
                Free for {sd.age_threshold ?? 60}+ {state.toUpperCase()} residents
              </span>
            )}
            <Link
              href={`/${state}/college/${id}/programs`}
              className="text-sm text-teal-600 dark:text-teal-400 hover:underline inline-flex items-center gap-1"
            >
              View programs &rarr;
            </Link>
          </div>
        </div>

        {/* Right — stat card */}
        <div className="lg:col-span-5">
          <div className="grid grid-cols-4 gap-px rounded-xl overflow-hidden border border-gray-200 dark:border-slate-700 bg-gray-200 dark:bg-slate-700">
            {[
              { label: "Students", value: scorecard?.size ? scorecard.size.toLocaleString() : "—" },
              { label: "In-state/yr", value: scorecard?.cost?.tuitionInState != null ? formatDollar(scorecard.cost.tuitionInState) : "—" },
              { label: "Completion", value: scorecard?.completion?.completionRate150nt != null ? formatPercent(scorecard.completion.completionRate150nt) : "—" },
              { label: "Audit cost", value: auditCostStat },
            ].map(({ label, value }) => (
              <div key={label} className="bg-white dark:bg-slate-800 px-3 py-4">
                <p className="text-[10px] font-mono font-medium uppercase tracking-wider text-gray-400 dark:text-slate-500">{label}</p>
                <p className="text-xl font-semibold tracking-tight text-gray-900 dark:text-slate-100 mt-1">{value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Plan-a-degree call-to-action — the planner's main entry point from a
          college page. Gated so it only shows when real plans exist. */}
      {plannableCount > 0 && (
        <Link
          href={`/${state}/college/${id}/programs`}
          className="group mt-6 flex items-center justify-between gap-4 rounded-xl border border-teal-200 dark:border-teal-900 bg-teal-50 dark:bg-teal-950/40 px-5 py-4 transition hover:bg-teal-100 dark:hover:bg-teal-900/40"
        >
          <div>
            <p className="text-sm font-semibold text-teal-800 dark:text-teal-300">
              Plan a degree at {institution.name}
            </p>
            <p className="mt-0.5 text-sm text-gray-600 dark:text-slate-300">
              Pick a program and see every course it needs — which ones transfer
              to the school you want, and what&rsquo;s open to register for now.
            </p>
          </div>
          <span className="shrink-0 text-teal-700 dark:text-teal-300 group-hover:translate-x-0.5 transition-transform">
            &rarr;
          </span>
        </Link>
      )}

      {/* At-a-glance — data-grounded editorial context paragraphs. Renders
          nothing when fewer than 2 sentences qualify (sparse-data colleges),
          so we don't get an empty heading. */}
      <CollegeContext
        state={state}
        stateName={config.name}
        systemName={config.systemName}
        institution={institution}
        sections={coursesByTerm[defaultTerm] ?? []}
        term={defaultTerm}
        seniorWaiver={
          config.seniorWaiver
            ? {
                ageThreshold: config.seniorWaiver.ageThreshold,
                legalCitation: config.seniorWaiver.legalCitation,
              }
            : null
        }
      />

      {/* COURSES — immediately after hero (courses-first layout) */}
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

      {/* CONTEXT CARDS — 3-col grid below courses */}
      <section className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Top programs */}
        <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="text-base font-semibold tracking-tight text-gray-900 dark:text-slate-100">Top programs</h3>
            <span className="text-[10px] font-mono font-medium uppercase tracking-wider text-gray-400 dark:text-slate-500">awards · IPEDS</span>
          </div>
          <TopProgramsSection
            state={state}
            collegeId={id}
            collegeName={institution.name}
          />
        </div>

        {/* Cost & outcomes */}
        <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="text-base font-semibold tracking-tight text-gray-900 dark:text-slate-100">Cost &amp; outcomes</h3>
            <span className="text-[10px] font-mono font-medium uppercase tracking-wider text-gray-400 dark:text-slate-500">federal scorecard</span>
          </div>
          <CollegeScorecardSection
            state={state}
            collegeId={id}
            collegeName={institution.name}
          />
        </div>

        {/* Audit policy */}
        <div id="audit-policy" className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="text-base font-semibold tracking-tight text-gray-900 dark:text-slate-100">Audit policy</h3>
            {institution.audit_policy.last_verified && (
              <span className="text-[10px] font-mono font-medium uppercase tracking-wider text-gray-400 dark:text-slate-500">
                verified {institution.audit_policy.last_verified}
              </span>
            )}
          </div>
          {institution.audit_policy.allowed === null ? (
            <p className="text-sm text-yellow-800 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-3">
              We haven&apos;t verified this college&apos;s audit policy yet. Contact the registrar to confirm.
              {institution.audit_policy.application_process.contact_email && (
                <> Email: <a href={`mailto:${institution.audit_policy.application_process.contact_email}`} className="underline">{institution.audit_policy.application_process.contact_email}</a></>
              )}
            </p>
          ) : (
            <div className="text-sm text-gray-700 dark:text-slate-300 space-y-2 leading-relaxed">
              {institution.audit_policy.allowed === false ? (
                <p className="text-red-700 dark:text-red-400">Auditing is not available at this college.</p>
              ) : (
                <p>
                  <strong>Auditing allowed.</strong>{" "}
                  {institution.audit_policy.cost_note}
                </p>
              )}
              {sd.available && (
                <p className="text-teal-700 dark:text-teal-400 font-medium">
                  Free for residents {sd.age_threshold ?? 60}+ (space-available).
                </p>
              )}
              {institution.audit_policy.application_process.steps.length > 0 && (
                <ul className="space-y-1 text-gray-600 dark:text-slate-400">
                  {institution.audit_policy.application_process.steps.slice(0, 3).map((step, i) => (
                    <li key={i}>· {step}</li>
                  ))}
                </ul>
              )}
              {institution.audit_policy.application_process.contact_email && (
                <p>
                  Contact:{" "}
                  <a href={`mailto:${institution.audit_policy.application_process.contact_email}`} className="text-teal-600 dark:text-teal-400 hover:underline">
                    {institution.audit_policy.application_process.contact_email}
                  </a>
                </p>
              )}
              {institution.audit_policy.source_url && (
                <a href={institution.audit_policy.source_url} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-400 dark:text-slate-500 hover:underline block mt-2">
                  Source &rarr;
                </a>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Course Offering Profile — server-rendered summary for SEO */}
      {offeringProfile && offeringProfile.total > 0 && (
        <section className="mt-8 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6">
          <SectionHeading id="offering-profile" className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-1">
            Course Offering Profile
          </SectionHeading>
          <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
            What {institution.name} is offering for{" "}
            {defaultTerm.toUpperCase()} — {offeringProfile.total} sections
            across {Object.keys(offeringProfile.modes.modes).length} delivery
            modes.
          </p>

          <div className="grid sm:grid-cols-2 gap-6">
            <div>
              <h3 className="text-sm font-medium text-gray-900 dark:text-slate-100 mb-2">Format mix</h3>
              <ul className="text-sm text-gray-700 dark:text-slate-300 space-y-1">
                {Object.entries(offeringProfile.modes.modes)
                  .sort((a, b) => b[1] - a[1])
                  .map(([mode, count]) => (
                    <li key={mode} className="flex justify-between">
                      <span className="capitalize">{mode.replace("-", " ")}</span>
                      <span>
                        <span className="font-medium text-gray-900 dark:text-slate-100">{count}</span>{" "}
                        <span className="text-xs text-gray-500 dark:text-slate-400">({offeringProfile.modes.modePcts[mode].toFixed(0)}%)</span>
                      </span>
                    </li>
                  ))}
              </ul>
            </div>

            <div>
              <h3 className="text-sm font-medium text-gray-900 dark:text-slate-100 mb-2">Section start dates</h3>
              {offeringProfile.distinctStartDates > 0 ? (
                <p className="text-sm text-gray-700 dark:text-slate-300">
                  Sections begin on{" "}
                  <span className="font-medium text-gray-900 dark:text-slate-100">{offeringProfile.distinctStartDates}</span>{" "}
                  distinct date{offeringProfile.distinctStartDates === 1 ? "" : "s"} this term.
                  {offeringProfile.lateStartCount > 0 && (
                    <>{" "}<Link href={`/${state}/starting-soon`} className="font-medium text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300">{offeringProfile.lateStartCount} late-start sections</Link>{" "}begin more than two weeks after the term starts.</>
                  )}
                </p>
              ) : (
                <p className="text-sm text-gray-500 dark:text-slate-400">Start-date data not available for this term.</p>
              )}
            </div>
          </div>

          {offeringProfile.topSubjects.length > 0 && (
            <div className="mt-6 pt-4 border-t border-gray-100 dark:border-slate-700">
              <h3 className="text-sm font-medium text-gray-900 dark:text-slate-100 mb-2">Most-offered subjects this term</h3>
              <div className="flex flex-wrap gap-2">
                {offeringProfile.topSubjects.map((s) => {
                  const label = subjectName(s.prefix);
                  const display = label && label !== s.prefix ? `${label} (${s.prefix})` : s.prefix;
                  return (
                    <Link key={s.prefix} href={`/${state}/college/${id}/courses/${s.prefix.toLowerCase()}`}
                      className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-slate-300 hover:border-teal-300 dark:hover:border-teal-700 hover:text-teal-700 dark:hover:text-teal-400 transition-colors"
                    >
                      <span>{display}</span>
                      <span className="text-gray-400 dark:text-slate-500">{s.sections}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {/* In-page ad */}
      <div className="mt-8">
        <AdUnit slot="3816492750" format="auto" className="min-h-[100px]" />
      </div>

      {/* Related blog posts */}
      <RelatedBlogPosts
        articles={getBlogRecommendations({
          state,
          pageType: "college",
          college: institution.college_slug,
        })}
        heading={`Related ${config.name} guides`}
      />

      {/* OTHER COLLEGES — footer band */}
      {(() => {
        const allInstitutions = loadInstitutions(state);
        const others = allInstitutions
          .filter((i) => i.id !== id)
          .sort((a, b) => a.name.localeCompare(b.name))
          .slice(0, 8);
        if (others.length === 0) return null;
        return (
          <section className="mt-12 -mx-4 sm:-mx-6 lg:-mx-8 border-t border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
              <div className="flex items-baseline justify-between mb-4">
                <h3 className="text-lg font-semibold tracking-tight text-gray-900 dark:text-slate-100">
                  Other {config.name} community colleges
                </h3>
                <Link href={`/${state}/colleges`} className="text-sm text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300">
                  View all {config.collegeCount} &rarr;
                </Link>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {others.map((inst) => (
                  <Link
                    key={inst.id}
                    href={`/${state}/college/${inst.id}`}
                    className="group block rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 hover:border-teal-300 dark:hover:border-teal-700 hover:shadow-sm transition"
                  >
                    <p className="font-medium text-sm text-gray-900 dark:text-slate-100 group-hover:text-teal-700 dark:group-hover:text-teal-400 transition-colors">
                      {inst.name}
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        );
      })()}
    </div>
  );
}

/**
 * State-wide subject aggregation page.
 *
 * Lists every course under a given subject (prefix) across all colleges in the
 * state. e.g. `/va/subject/eng` shows all ENG courses across VCCS.
 *
 * Uses ISR (revalidate = 604800). Pages are rendered on-demand and cached for
 * 7 days, same pattern as `/[state]/course/[code]`. Sitemap lists every valid
 * (state, prefix) combination so Google discovers them.
 */

import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import {
  loadCoursesBySubject,
  getDistinctSubjects,
} from "@/lib/courses";
import { getCurrentTerm, termLabel } from "@/lib/terms";
import { isValidState } from "@/lib/states/registry";
import { requireStateConfig } from "@/lib/states/route-helpers";
import { subjectName } from "@/lib/subjects";
import { computeCourseAvailabilityProfile } from "@/lib/course-stats";
import { getBestProgramForPrefix } from "@/lib/programs/registry";
import { getQualifyingProgramSlugs } from "@/lib/programs";
import SectionHeading from "@/components/SectionHeading";
import AdUnit from "@/components/AdUnit";
import TrackView from "@/components/TrackView";
import RelatedBlogPosts from "@/components/RelatedBlogPosts";
import { getBlogRecommendations } from "@/lib/blog-recommendations";
import type { CourseSection } from "@/lib/types";
import {
  getSubjectLastUpdated,
  formatLastUpdated,
} from "@/lib/data-freshness";

export const revalidate = 604800; // 7 days — pSEO content rarely changes

type PageProps = {
  params: Promise<{ state: string; prefix: string }>;
};

// ---------------------------------------------------------------------------
// Static params — enumerate every (state, prefix) pair with ≥5 sections in
// the current term, matching the sitemap's threshold. `dynamicParams = false`
// causes unlisted pairs to return HTTP 404 instead of a cached 200 soft-404.
// See #337. Prefixes are lowercased to match the canonical URLs Google sees.
// ---------------------------------------------------------------------------

// Generate on-demand via ISR. Previously prerendered every (state, subject)
// pair with ≥5 sections, but that called getCurrentTerm() per state on every
// build — which triggers the get_term_college_counts RPC that's been timing
// out since the courses table grew. The fallback N+1 query path then ran for
// each of ~1,300 pages, accumulating in memory and OOM-ing the Vercel build
// worker (observed 2026-05-26). The sitemap still lists every valid
// combination so Google finds them; ISR caches each page for 7 days after
// first visit, so cold-start latency is paid once per page lifetime.
export const dynamicParams = true;

export async function generateStaticParams() {
  return [];
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const { state, prefix: rawPrefix } = await props.params;
  if (!isValidState(state)) return { title: "Not Found" };

  const prefix = rawPrefix.toUpperCase();
  const config = requireStateConfig(state);
  const currentTerm = await getCurrentTerm(state);
  const filtered = await loadCoursesBySubject(prefix, currentTerm, state);

  if (filtered.length === 0) return { title: "Not Found" };

  const subject = subjectName(prefix);
  const uniqueCourses = new Set(
    filtered.map((c) => `${c.course_prefix} ${c.course_number}`)
  ).size;
  const collegeCount = new Set(filtered.map((c) => c.college_code)).size;
  const onlineCount = filtered.filter(
    (c) => c.mode === "online" || c.mode === "zoom"
  ).length;
  const term = termLabel(currentTerm);

  const title = `${subject} Courses — All ${config.systemName} Colleges (${term})`;
  const description = `Browse ${filtered.length} ${subject} sections across ${collegeCount} ${config.systemName} colleges for ${term}. ${uniqueCourses} unique courses${onlineCount > 0 ? `, ${onlineCount} available online` : ""}. Compare schedules, credits, and transfer options.`;

  const canonical = `${process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com"}/${state}/subject/${rawPrefix}`;

  return {
    title,
    description,
    keywords: [
      `${subject} courses ${config.name}`,
      `${prefix} classes ${config.systemName}`,
      `community college ${subject.toLowerCase()} ${config.name}`,
      `${subject.toLowerCase()} transfer ${config.name}`,
      ...config.branding.metaKeywords,
    ],
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      type: "website",
      siteName: config.branding.siteName,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface CourseRow {
  prefix: string;
  number: string;
  title: string;
  credits: number;
  sectionCount: number;
  collegeCount: number;
  onlineCount: number;
  hybridCount: number;
  inPersonCount: number;
}

function aggregateCourses(sections: CourseSection[]): CourseRow[] {
  const byCourse = new Map<string, CourseSection[]>();
  for (const s of sections) {
    const key = `${s.course_prefix}-${s.course_number}`;
    if (!byCourse.has(key)) byCourse.set(key, []);
    byCourse.get(key)!.push(s);
  }

  const rows: CourseRow[] = [];
  for (const [, secs] of byCourse) {
    const sample = secs[0];
    rows.push({
      prefix: sample.course_prefix,
      number: sample.course_number,
      title: sample.course_title,
      credits: sample.credits,
      sectionCount: secs.length,
      collegeCount: new Set(secs.map((s) => s.college_code)).size,
      onlineCount: secs.filter((s) => s.mode === "online" || s.mode === "zoom")
        .length,
      hybridCount: secs.filter((s) => s.mode === "hybrid").length,
      inPersonCount: secs.filter((s) => s.mode === "in-person").length,
    });
  }

  // Sort by course number
  rows.sort((a, b) => a.number.localeCompare(b.number));
  return rows;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function StateSubjectPage(props: PageProps) {
  const { state, prefix: rawPrefix } = await props.params;
  if (!isValidState(state)) notFound();

  const prefix = rawPrefix.toUpperCase();
  const config = requireStateConfig(state);
  const currentTerm = await getCurrentTerm(state);
  const sections = await loadCoursesBySubject(prefix, currentTerm, state);
  if (sections.length === 0) notFound();

  const subject = subjectName(prefix);
  const courses = aggregateCourses(sections);
  const collegeCount = new Set(sections.map((s) => s.college_code)).size;

  // Program-hub bridge (issue #416): when this prefix maps to one of our
  // curated programs *and* that program qualifies for the state's
  // program-comparison hub at `/[state]/program/[slug]`, surface a banner
  // link so subject-page visitors discover the cross-college comparison
  // view with earnings data.
  const matchedProgram = getBestProgramForPrefix(prefix);
  const qualifyingSlugs = matchedProgram
    ? await getQualifyingProgramSlugs(state)
    : [];
  const programLink =
    matchedProgram && qualifyingSlugs.includes(matchedProgram.slug)
      ? matchedProgram
      : null;
  const onlineCount = sections.filter(
    (s) => s.mode === "online" || s.mode === "zoom"
  ).length;
  const hybridCount = sections.filter((s) => s.mode === "hybrid").length;
  const inPersonCount = sections.filter((s) => s.mode === "in-person").length;
  const term = termLabel(currentTerm);

  // Subject Availability Snapshot — server-rendered substantive content
  // pulled from the same sections already loaded for the course list.
  // Same helper used by /[state]/course/[code] and /[state]/program/[slug]
  // for consistency.
  const subjectProfile = computeCourseAvailabilityProfile(sections);

  // Other subjects for browse links — distinct prefix scan, not full catalog
  const allSubjects = (await getDistinctSubjects(currentTerm, state)).filter(
    (s) => s !== prefix
  );

  const lastUpdated = getSubjectLastUpdated(state);

  // Structured data — ItemList of courses
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "@id": `${siteUrl}/${state}/subject/${rawPrefix}#itemlist`,
    name: `${subject} Courses — ${config.systemName}`,
    description: `${sections.length} ${subject} sections across ${collegeCount} ${config.systemName} colleges for ${term}.`,
    numberOfItems: courses.length,
    url: `${siteUrl}/${state}/subject/${rawPrefix}`,
    // Connect to the site-wide WebSite/Organization graph from the root
    // layout so Google sees this subject list as part of the site.
    isPartOf: { "@id": `${siteUrl}/#website` },
    ...(lastUpdated && { dateModified: lastUpdated.toISOString() }),
    itemListElement: courses.slice(0, 25).map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${siteUrl}/${state}/course/${c.prefix.toLowerCase()}-${c.number.toLowerCase()}`,
      item: {
        "@type": "Course",
        name: `${c.prefix} ${c.number}: ${c.title}`,
        courseCode: `${c.prefix} ${c.number}`,
        provider: {
          "@type": "Organization",
          name: config.systemFullName,
        },
        ...(c.credits > 0 && {
          numberOfCredits: {
            "@type": "StructuredValue",
            value: c.credits,
          },
        }),
      },
    })),
  };

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: config.name,
        item: `${siteUrl}/${state}`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Courses",
        item: `${siteUrl}/${state}/courses`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: subject,
        item: `${siteUrl}/${state}/subject/${rawPrefix}`,
      },
    ],
  };

  return (
    <>
      <TrackView
        event="subject_page_view"
        params={{
          state,
          subject: prefix,
          sections: sections.length,
          courses: courses.length,
          scope: "state",
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-slate-400 mb-6">
          <Link
            href={`/${state}`}
            className="hover:text-teal-600 dark:hover:text-teal-400"
          >
            {config.name}
          </Link>
          <span>/</span>
          <Link
            href={`/${state}/courses`}
            className="hover:text-teal-600 dark:hover:text-teal-400"
          >
            Courses
          </Link>
          <span>/</span>
          <span className="text-gray-900 dark:text-slate-100 font-medium">
            {subject}
          </span>
        </nav>

        {/* Header */}
        <div className="mb-8">
          <p className="text-sm font-medium text-teal-600 dark:text-teal-400 mb-1">
            {prefix}
          </p>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-slate-100">
            {subject} Courses
            <span className="font-normal text-gray-500 dark:text-slate-400 text-xl ml-2">
              across {config.systemName}
            </span>
          </h1>
          <p className="text-gray-600 dark:text-slate-400 mt-1.5">
            {sections.length} sections &middot; {courses.length} courses
            &middot; {collegeCount} {collegeCount === 1 ? "college" : "colleges"}{" "}
            &middot; {term}
            {lastUpdated && (
              <> &middot; {formatLastUpdated(lastUpdated)}</>
            )}
          </p>
        </div>

        {/* Mode breakdown */}
        <div className="flex flex-wrap gap-2 mb-8">
          {inPersonCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-900/30 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {inPersonCount} In-Person
            </span>
          )}
          {onlineCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 dark:bg-blue-900/30 px-3 py-1 text-xs font-medium text-blue-700 dark:text-blue-400">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
              {onlineCount} Online
            </span>
          )}
          {hybridCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-50 dark:bg-purple-900/30 px-3 py-1 text-xs font-medium text-purple-700 dark:text-purple-400">
              <span className="h-1.5 w-1.5 rounded-full bg-purple-500" />
              {hybridCount} Hybrid
            </span>
          )}
        </div>

        {programLink && (
          <div className="mb-8">
            <Link
              href={`/${state}/program/${programLink.slug}`}
              className="group flex items-center justify-between rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-900/20 px-4 py-3 hover:border-teal-400 dark:hover:border-teal-600 transition-colors"
            >
              <div>
                <div className="text-sm font-semibold text-teal-800 dark:text-teal-300">
                  Compare full {programLink.name} programs across{" "}
                  {config.name} community colleges
                </div>
                <div className="text-xs text-teal-700 dark:text-teal-400 mt-0.5">
                  Per-college program size, graduate earnings, and transfer
                  details.
                </div>
              </div>
              <svg
                className="h-4 w-4 text-teal-600 dark:text-teal-400 group-hover:translate-x-0.5 transition-transform"
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
        )}

        {/* Subject Availability Snapshot — server-rendered substantive
            content per term. Helps long-tail SEO ("[subject] online
            community college [state]", "[subject] evening sections").
            Computed inline from sections — no extra I/O. */}
        {subjectProfile && subjectProfile.totalSections > 0 && (
          <section className="mb-8 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
            <SectionHeading id="availability" className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-1">
              {subject} Availability Snapshot
            </SectionHeading>
            <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
              How {subject.toLowerCase()} sections are being offered across{" "}
              {subjectProfile.collegeCount}{" "}
              {subjectProfile.collegeCount === 1 ? "college" : "colleges"} in{" "}
              {config.name} this term ({subjectProfile.totalSections}{" "}
              {subjectProfile.totalSections === 1 ? "section" : "sections"}{" "}
              total).
            </p>

            <div className="grid sm:grid-cols-2 gap-6">
              <div>
                <h3 className="text-sm font-medium text-gray-900 dark:text-slate-100 mb-2">
                  When sections meet
                </h3>
                <ul className="text-sm text-gray-700 dark:text-slate-300 space-y-1">
                  {subjectProfile.timeOfDay.morning > 0 && (
                    <li className="flex justify-between">
                      <span>Morning (before noon)</span>
                      <span className="font-medium text-gray-900 dark:text-slate-100">
                        {subjectProfile.timeOfDay.morning}
                      </span>
                    </li>
                  )}
                  {subjectProfile.timeOfDay.afternoon > 0 && (
                    <li className="flex justify-between">
                      <span>Afternoon (noon&ndash;5 PM)</span>
                      <span className="font-medium text-gray-900 dark:text-slate-100">
                        {subjectProfile.timeOfDay.afternoon}
                      </span>
                    </li>
                  )}
                  {subjectProfile.timeOfDay.evening > 0 && (
                    <li className="flex justify-between">
                      <span>Evening (5 PM and after)</span>
                      <span className="font-medium text-gray-900 dark:text-slate-100">
                        {subjectProfile.timeOfDay.evening}
                      </span>
                    </li>
                  )}
                  {subjectProfile.timeOfDay.asynchronous > 0 && (
                    <li className="flex justify-between">
                      <span>Asynchronous / TBA</span>
                      <span className="font-medium text-gray-900 dark:text-slate-100">
                        {subjectProfile.timeOfDay.asynchronous}
                      </span>
                    </li>
                  )}
                </ul>
              </div>

              <div>
                <h3 className="text-sm font-medium text-gray-900 dark:text-slate-100 mb-2">
                  Start dates &amp; instructors
                </h3>
                <div className="text-sm text-gray-700 dark:text-slate-300 space-y-2">
                  {subjectProfile.startDates.distinct > 0 && (
                    <p>
                      Sections begin on{" "}
                      <span className="font-medium text-gray-900 dark:text-slate-100">
                        {subjectProfile.startDates.distinct}
                      </span>{" "}
                      distinct date
                      {subjectProfile.startDates.distinct === 1 ? "" : "s"}
                      {subjectProfile.startDates.lateStartCount > 0 && (
                        <>
                          ,{" "}
                          <Link
                            href={`/${state}/starting-soon`}
                            className="font-medium text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300"
                          >
                            {subjectProfile.startDates.lateStartCount}{" "}
                            late-start
                          </Link>
                        </>
                      )}
                      .
                    </p>
                  )}
                  {subjectProfile.instructorCount > 0 && (
                    <p>
                      Taught by{" "}
                      <span className="font-medium text-gray-900 dark:text-slate-100">
                        {subjectProfile.instructorCount}
                      </span>{" "}
                      distinct instructor
                      {subjectProfile.instructorCount === 1 ? "" : "s"} across
                      the state.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Course table */}
        <section className="mb-8">
          <h2 id="courses" className="sr-only">All {subject} courses</h2>
          <div className="rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-900">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 dark:bg-slate-800 text-xs uppercase tracking-wider text-gray-500 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Course</th>
                  <th className="px-4 py-2.5 font-medium">Title</th>
                  <th className="px-4 py-2.5 font-medium text-right">Credits</th>
                  <th className="px-4 py-2.5 font-medium text-right">
                    Sections
                  </th>
                  <th className="px-4 py-2.5 font-medium text-right">
                    Colleges
                  </th>
                  <th className="px-4 py-2.5 font-medium">Availability</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                {courses.map((c) => (
                  <tr
                    key={`${c.prefix}-${c.number}`}
                    className="hover:bg-gray-50 dark:hover:bg-slate-800"
                  >
                    <td className="px-4 py-2.5 font-mono font-medium text-gray-900 dark:text-slate-100">
                      <Link
                        href={`/${state}/course/${c.prefix.toLowerCase()}-${c.number.toLowerCase()}`}
                        className="text-teal-600 dark:text-teal-400 hover:underline"
                      >
                        {c.prefix} {c.number}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-gray-700 dark:text-slate-300">
                      {c.title}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-600 dark:text-slate-400">
                      {c.credits}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-900 dark:text-slate-100 font-medium">
                      {c.sectionCount}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-600 dark:text-slate-400">
                      {c.collegeCount}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {c.inPersonCount > 0 && (
                          <span className="inline-block rounded-full bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                            {c.inPersonCount} In-Person
                          </span>
                        )}
                        {c.onlineCount > 0 && (
                          <span className="inline-block rounded-full bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-400">
                            {c.onlineCount} Online
                          </span>
                        )}
                        {c.hybridCount > 0 && (
                          <span className="inline-block rounded-full bg-purple-50 dark:bg-purple-900/30 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 dark:text-purple-400">
                            {c.hybridCount} Hybrid
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Ad slot (below main content) */}
        <div className="mb-10">
          <AdUnit slot="2854671930" format="auto" className="min-h-[100px]" />
        </div>

        {/* Related blog posts — programmatic → editorial cross-pollination (#371) */}
        <RelatedBlogPosts
          articles={getBlogRecommendations({
            state,
            pageType: "subject",
          })}
          heading={`Related ${config.name} guides`}
        />

        {/* Browse other subjects */}
        {allSubjects.length > 0 && (
          <section className="mt-10">
            <SectionHeading id="other-subjects" className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-3">
              Browse Other Subjects
            </SectionHeading>
            <div className="flex flex-wrap gap-2">
              {allSubjects.slice(0, 48).map((s) => (
                <Link
                  key={s}
                  href={`/${state}/subject/${s.toLowerCase()}`}
                  className="inline-block rounded-md bg-gray-100 dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-slate-300 hover:bg-teal-100 dark:hover:bg-teal-900/40 hover:text-teal-700 dark:hover:text-teal-400 transition-colors"
                >
                  {subjectName(s)} ({s})
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Quick links */}
        <div className="mt-10 flex flex-wrap gap-4 pt-6 border-t border-gray-100 dark:border-slate-800 text-sm">
          <Link
            href={`/${state}/courses?q=${encodeURIComponent(prefix)}`}
            className="text-teal-600 dark:text-teal-400 hover:underline"
          >
            Search {prefix} sections
          </Link>
          <Link
            href={`/${state}/schedule?subjects=${encodeURIComponent(prefix)}`}
            className="text-teal-600 dark:text-teal-400 hover:underline"
          >
            Build schedule with {subject}
          </Link>
          {config.transferSupported && (
            <Link
              href={`/${state}/transfer`}
              className="text-teal-600 dark:text-teal-400 hover:underline"
            >
              Compare transfer equivalencies
            </Link>
          )}
        </div>
      </div>
    </>
  );
}

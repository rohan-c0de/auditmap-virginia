/**
 * State-wide subject aggregation page.
 *
 * Lists every course under a given subject (prefix) across all colleges in the
 * state. e.g. `/va/subject/eng` shows all ENG courses across VCCS.
 *
 * Uses ISR (revalidate = 86400). Pages are rendered on-demand and cached for
 * 24h, same pattern as `/[state]/course/[code]`. Sitemap lists every valid
 * (state, prefix) combination so Google discovers them.
 */

import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { loadAllCourses, getUniqueSubjects } from "@/lib/courses";
import { getCurrentTerm, termLabel } from "@/lib/terms";
import { getStateConfig, isValidState } from "@/lib/states/registry";
import { subjectName } from "@/lib/subjects";
import AdUnit from "@/components/AdUnit";
import TrackView from "@/components/TrackView";
import type { CourseSection } from "@/lib/types";

export const revalidate = 86400; // 24 hours

type PageProps = {
  params: Promise<{ state: string; prefix: string }>;
};

// ---------------------------------------------------------------------------
// Static params — empty, all pages generated on-demand via ISR
// ---------------------------------------------------------------------------

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
  const config = getStateConfig(state);
  const currentTerm = await getCurrentTerm(state);
  const allCourses = await loadAllCourses(currentTerm, state);
  const filtered = allCourses.filter((c) => c.course_prefix === prefix);

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
  const config = getStateConfig(state);
  const currentTerm = await getCurrentTerm(state);
  const allCourses = await loadAllCourses(currentTerm, state);

  const sections = allCourses.filter((c) => c.course_prefix === prefix);
  if (sections.length === 0) notFound();

  const subject = subjectName(prefix);
  const courses = aggregateCourses(sections);
  const collegeCount = new Set(sections.map((s) => s.college_code)).size;
  const onlineCount = sections.filter(
    (s) => s.mode === "online" || s.mode === "zoom"
  ).length;
  const hybridCount = sections.filter((s) => s.mode === "hybrid").length;
  const inPersonCount = sections.filter((s) => s.mode === "in-person").length;
  const term = termLabel(currentTerm);

  // Other subjects for browse links
  const allSubjects = getUniqueSubjects(allCourses).filter((s) => s !== prefix);

  // Structured data — ItemList of courses
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${subject} Courses — ${config.systemName}`,
    description: `${sections.length} ${subject} sections across ${collegeCount} ${config.systemName} colleges for ${term}.`,
    numberOfItems: courses.length,
    url: `${siteUrl}/${state}/subject/${rawPrefix}`,
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

        {/* Course table */}
        <section className="mb-8">
          <h2 className="sr-only">All {subject} courses</h2>
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

        {/* Browse other subjects */}
        {allSubjects.length > 0 && (
          <section className="mt-10">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-3">
              Browse Other Subjects
            </h2>
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

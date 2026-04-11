import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { loadInstitutions } from "@/lib/institutions";
import {
  loadCoursesForCollege,
  getAvailableTerms,
  getUniqueSubjects,
} from "@/lib/courses";
import { getCurrentTerm, termLabel } from "@/lib/terms";
import { getStateConfig, getAllStates } from "@/lib/states/registry";
import { buildTransferLookup } from "@/lib/transfer";
import { subjectName } from "@/lib/subjects";
import CollegeDetailClient from "../../CollegeDetailClient";

export const revalidate = 86400;

type PageProps = {
  params: Promise<{ state: string; id: string; prefix: string }>;
  searchParams: Promise<{ term?: string }>;
};

// ---------------------------------------------------------------------------
// Static params — generate one page per (state, college, subject)
// ---------------------------------------------------------------------------

export async function generateStaticParams() {
  const all: { state: string; id: string; prefix: string }[] = [];

  for (const stateConfig of getAllStates()) {
    const institutions = loadInstitutions(stateConfig.slug);
    const currentTerm = await getCurrentTerm(stateConfig.slug);

    for (const inst of institutions) {
      const courses = await loadCoursesForCollege(
        inst.college_slug,
        currentTerm,
        stateConfig.slug
      );
      const subjects = getUniqueSubjects(courses);
      for (const prefix of subjects) {
        all.push({
          state: stateConfig.slug,
          id: inst.id,
          prefix: prefix.toLowerCase(),
        });
      }
    }
  }

  return all;
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const { state, id, prefix: rawPrefix } = await props.params;
  const prefix = rawPrefix.toUpperCase();
  const config = getStateConfig(state);
  const institutions = loadInstitutions(state);
  const institution = institutions.find((i) => i.id === id);

  if (!institution) return { title: "Not Found" };

  const subject = subjectName(prefix);
  const currentTerm = await getCurrentTerm(state);
  const courses = await loadCoursesForCollege(
    institution.college_slug,
    currentTerm,
    state
  );
  const filtered = courses.filter((c) => c.course_prefix === prefix);
  const onlineCount = filtered.filter((c) => c.mode === "online").length;
  const uniqueCourses = new Set(
    filtered.map((c) => `${c.course_prefix} ${c.course_number}`)
  ).size;

  const title = `${subject} Courses at ${institution.name} — ${termLabel(currentTerm)} Schedule`;
  const description = `Browse ${filtered.length} ${subject} sections (${uniqueCourses} courses) at ${institution.name} for ${termLabel(currentTerm)}.${onlineCount > 0 ? ` ${onlineCount} available online.` : ""} View schedules, instructors, and prerequisites.`;

  return {
    title,
    description,
    keywords: [
      `${subject} courses ${institution.name}`,
      `${prefix} classes ${config.name}`,
      `${institution.name} ${subject.toLowerCase()} schedule`,
      `${subject.toLowerCase()} community college ${config.name}`,
      ...config.branding.metaKeywords,
    ],
    alternates: {
      canonical: `/${state}/college/${id}/courses/${rawPrefix}`,
    },
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function SubjectPage(props: PageProps) {
  const { state, id, prefix: rawPrefix } = await props.params;
  const { term: requestedTerm } = await props.searchParams;
  const prefix = rawPrefix.toUpperCase();
  const config = getStateConfig(state);
  const institutions = loadInstitutions(state);
  const institution = institutions.find((i) => i.id === id);

  if (!institution) notFound();

  // Resolve term
  const allTerms = await getAvailableTerms(state);
  const currentTerm =
    requestedTerm && allTerms.includes(requestedTerm)
      ? requestedTerm
      : await getCurrentTerm(state);

  // Load and filter courses
  const allCourses = await loadCoursesForCollege(
    institution.college_slug,
    currentTerm,
    state
  );
  const courses = allCourses.filter((c) => c.course_prefix === prefix);

  if (courses.length === 0) notFound();

  const subject = subjectName(prefix);
  const uniqueCourses = [
    ...new Set(courses.map((c) => `${c.course_prefix} ${c.course_number}`)),
  ].sort();
  const onlineCount = courses.filter((c) => c.mode === "online").length;
  const hybridCount = courses.filter((c) => c.mode === "hybrid").length;
  const inPersonCount = courses.filter(
    (c) => c.mode === "in-person"
  ).length;
  const eveningCount = courses.filter((c) => {
    if (!c.start_time) return false;
    const hour = parseInt(c.start_time.split(":")[0]);
    const isPM = c.start_time.toLowerCase().includes("pm");
    return isPM && hour >= 5 && hour !== 12;
  }).length;

  // Get all subjects for this college for the sidebar links
  const allSubjects = getUniqueSubjects(allCourses);

  // Transfer lookup
  const transferLookup = await buildTransferLookup(state);

  // Structured data
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${subject} Courses at ${institution.name}`,
    description: `${courses.length} ${subject} sections available for ${termLabel(currentTerm)}`,
    numberOfItems: courses.length,
    url: `${siteUrl}/${state}/college/${id}/courses/${rawPrefix}`,
    itemListElement: uniqueCourses.slice(0, 20).map((code, i) => {
      const sample = courses.find(
        (c) => `${c.course_prefix} ${c.course_number}` === code
      )!;
      return {
        "@type": "ListItem",
        position: i + 1,
        item: {
          "@type": "Course",
          name: `${code}: ${sample.course_title}`,
          provider: {
            "@type": "EducationalOrganization",
            name: institution.name,
          },
          courseCode: code,
          ...(sample.credits > 0 && {
            numberOfCredits: {
              "@type": "StructuredValue",
              value: sample.credits,
            },
          }),
        },
      };
    }),
  };

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: config.branding.siteName,
        item: `${siteUrl}/${state}`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: institution.name,
        item: `${siteUrl}/${state}/college/${id}`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: `${subject} Courses`,
      },
    ],
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />

      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-500 dark:text-slate-400 mb-4 flex-wrap">
        <Link
          href={`/${state}`}
          className="text-teal-600 hover:text-teal-700"
        >
          {config.name}
        </Link>
        <span>/</span>
        <Link
          href={`/${state}/college/${id}`}
          className="text-teal-600 hover:text-teal-700"
        >
          {institution.name}
        </Link>
        <span>/</span>
        <span className="text-gray-900 dark:text-slate-100 font-medium">
          {subject}
        </span>
      </nav>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-slate-100">
          {subject} Courses at {institution.name}
        </h1>
        <p className="text-gray-600 dark:text-slate-400 mt-1">
          {termLabel(currentTerm)} &middot; {courses.length} sections across{" "}
          {uniqueCourses.length} courses
        </p>
      </div>

      {/* Stats bar */}
      <div className="flex flex-wrap gap-3 mb-6">
        {inPersonCount > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 dark:bg-teal-900/30 px-3 py-1 text-xs font-medium text-teal-700 dark:text-teal-400 ring-1 ring-inset ring-teal-200 dark:ring-teal-800">
            <span className="h-1.5 w-1.5 rounded-full bg-teal-500" />
            {inPersonCount} In-Person
          </span>
        )}
        {onlineCount > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 dark:bg-blue-900/30 px-3 py-1 text-xs font-medium text-blue-700 dark:text-blue-400 ring-1 ring-inset ring-blue-200 dark:ring-blue-800">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
            {onlineCount} Online
          </span>
        )}
        {hybridCount > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-50 dark:bg-purple-900/30 px-3 py-1 text-xs font-medium text-purple-700 dark:text-purple-400 ring-1 ring-inset ring-purple-200 dark:ring-purple-800">
            <span className="h-1.5 w-1.5 rounded-full bg-purple-500" />
            {hybridCount} Hybrid
          </span>
        )}
        {eveningCount > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 dark:bg-amber-900/30 px-3 py-1 text-xs font-medium text-amber-700 dark:text-amber-400 ring-1 ring-inset ring-amber-200 dark:ring-amber-800">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            {eveningCount} Evening
          </span>
        )}
      </div>

      {/* Course table */}
      <section>
        <CollegeDetailClient
          courses={courses}
          institution={institution}
          collegeSlug={institution.college_slug}
          transferLookup={transferLookup}
          systemName={config.systemName}
          courseListingUrl={config.courseDiscoveryUrl(
            institution.college_slug,
            "__PREFIX__",
            "__NUMBER__"
          )}
          state={state}
        />
      </section>

      {/* Browse other subjects */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-3">
          Browse Other Subjects at {institution.name}
        </h2>
        <div className="flex flex-wrap gap-2">
          {allSubjects
            .filter((s) => s !== prefix)
            .map((s) => (
              <Link
                key={s}
                href={`/${state}/college/${id}/courses/${s.toLowerCase()}`}
                className="inline-block rounded-md bg-gray-100 dark:bg-slate-700 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-slate-300 hover:bg-teal-100 dark:hover:bg-teal-900/40 hover:text-teal-700 dark:hover:text-teal-400 transition-colors"
              >
                {subjectName(s)} ({s})
              </Link>
            ))}
        </div>
      </section>
    </div>
  );
}

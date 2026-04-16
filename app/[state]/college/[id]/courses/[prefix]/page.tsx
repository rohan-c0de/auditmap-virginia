import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { loadInstitutions } from "@/lib/institutions";
import {
  loadCoursesForCollege,
  getTermsWithDataForCollegeSubject,
  getUniqueSubjects,
  trimCoursesForClient,
} from "@/lib/courses";
import { getCurrentTerm, termLabel } from "@/lib/terms";
import { getStateConfig } from "@/lib/states/registry";
import { buildTransferLookupForCourses } from "@/lib/transfer-scoped";
import { subjectName } from "@/lib/subjects";
import SubjectTermSection from "./SubjectTermSection";
import AdUnit from "@/components/AdUnit";
import TrackView from "@/components/TrackView";

export const revalidate = 86400;

type PageProps = {
  params: Promise<{ state: string; id: string; prefix: string }>;
  // searchParams intentionally omitted — reading it would opt the page into
  // dynamic rendering and disable ISR edge caching. `?term=` is now handled
  // client-side in SubjectTermSection via useEffect + history.replaceState.
};

// ---------------------------------------------------------------------------
// Static params — generate one page per (state, college, subject)
// ---------------------------------------------------------------------------

// Prerender nothing at build time — there are ~9k college × subject
// combinations across all states, which blows out the deploy output size.
// Instead rely on ISR: Next will SSG each page on first request, cache the
// HTML for `revalidate` seconds at the edge, and serve subsequent visitors
// from cache. `dynamicParams` defaults to true so unknown params render
// on-demand rather than 404ing.
export async function generateStaticParams() {
  return [];
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

  // Resolve the default term for SEO copy — same fallback logic the page uses.
  // Use the targeted `getTermsWithDataForCollegeSubject` query instead of
  // loading every term's full catalog so metadata generation stays cheap.
  const termsWithData = await getTermsWithDataForCollegeSubject(
    institution.college_slug,
    prefix,
    state
  );
  if (termsWithData.length === 0) return { title: "Not Found" };

  const preferredTerm = await getCurrentTerm(state);
  const resolvedTerm = termsWithData.includes(preferredTerm)
    ? preferredTerm
    : termsWithData[termsWithData.length - 1];

  const allCourses = await loadCoursesForCollege(
    institution.college_slug,
    resolvedTerm,
    state
  );
  const filtered = allCourses.filter((c) => c.course_prefix === prefix);

  const onlineCount = filtered.filter((c) => c.mode === "online").length;
  const uniqueCourses = new Set(
    filtered.map((c) => `${c.course_prefix} ${c.course_number}`)
  ).size;

  const title = `${subject} Courses at ${institution.name} — ${termLabel(resolvedTerm)} Schedule`;
  const description = `Browse ${filtered.length} ${subject} sections (${uniqueCourses} courses) at ${institution.name} for ${termLabel(resolvedTerm)}.${onlineCount > 0 ? ` ${onlineCount} available online.` : ""} View schedules, instructors, and prerequisites.`;

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
  const prefix = rawPrefix.toUpperCase();
  const config = getStateConfig(state);
  const institutions = loadInstitutions(state);
  const institution = institutions.find((i) => i.id === id);

  if (!institution) notFound();

  // Discover which terms have data for this subject at this college via a
  // targeted `SELECT term` query (~hundreds of rows). Cheap enough to run on
  // every render, avoids loading every term's full catalog upfront.
  const termsWithData = await getTermsWithDataForCollegeSubject(
    institution.college_slug,
    prefix,
    state
  );

  if (termsWithData.length === 0) notFound();

  // Default term = most-recent term with data for this subject at this college.
  const preferredTerm = await getCurrentTerm(state);
  const defaultTerm = termsWithData.includes(preferredTerm)
    ? preferredTerm
    : termsWithData[termsWithData.length - 1];

  // Load ONLY the default term's full catalog for this college. Other terms
  // are lazy-loaded client-side via the `/api/[state]/college/[id]/courses/
  // [prefix]?term=...` route when the user switches, keeping cold ISR
  // latency bounded to a single-term round trip.
  const defaultTermFullCourses = await loadCoursesForCollege(
    institution.college_slug,
    defaultTerm,
    state
  );
  const defaultCoursesFull = defaultTermFullCourses.filter(
    (c) => c.course_prefix === prefix
  );
  const defaultCourses = trimCoursesForClient(defaultCoursesFull);

  // Build URL templates for every term up front — no DB work, just string
  // formatting via the state config.
  const courseListingUrlByTerm: Record<string, string> = {};
  for (const t of termsWithData) {
    courseListingUrlByTerm[t] = config.courseDiscoveryUrl(
      institution.college_slug,
      "__PREFIX__",
      "__NUMBER__",
      t
    );
  }

  // Transfer lookup is scoped to the default term's courses. When the client
  // switches terms, the API route returns a fresh lookup filtered to that
  // term's courses. Targeted Supabase query — avoids loading the full state
  // transfer catalog just to discard 99% of it.
  const defaultTransferLookup = await buildTransferLookupForCourses(
    defaultCoursesFull,
    state
  );

  const subject = subjectName(prefix);
  const uniqueCoursesForJsonLd = [
    ...new Set(
      defaultCourses.map((c) => `${c.course_prefix} ${c.course_number}`)
    ),
  ].sort();

  // All subjects at this college for the "Browse Other Subjects" links.
  // Reuses the default term's full course list we already loaded above.
  const allSubjects = getUniqueSubjects(defaultTermFullCourses);

  // Structured data — reflects the default term the page prerenders with.
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${subject} Courses at ${institution.name}`,
    description: `${defaultCourses.length} ${subject} sections available for ${termLabel(defaultTerm)}`,
    numberOfItems: defaultCourses.length,
    url: `${siteUrl}/${state}/college/${id}/courses/${rawPrefix}`,
    itemListElement: uniqueCoursesForJsonLd.slice(0, 20).map((code, i) => {
      const sample = defaultCourses.find(
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
      <TrackView
        event="subject_page_view"
        params={{
          state,
          college: id,
          subject: prefix,
          sections: defaultCourses.length,
          scope: "college",
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
      </div>

      {/* Term-scoped content (stats bar, term picker, course table) */}
      <SubjectTermSection
        defaultTerm={defaultTerm}
        defaultCourses={defaultCourses}
        defaultTransferLookup={defaultTransferLookup}
        termsWithData={termsWithData}
        courseListingUrlByTerm={courseListingUrlByTerm}
        institution={institution}
        systemName={config.systemName}
        state={state}
        collegeId={id}
        prefix={prefix}
      />

      {/* In-content ad */}
      <div className="mt-8">
        <AdUnit slot="9402617538" format="auto" className="min-h-[100px]" />
      </div>

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

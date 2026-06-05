import type { Metadata } from "next";
import Link from "next/link";
import CourseSearchClient, { type SearchResponse } from "./CourseSearchClient";
import { requireStateConfig } from "@/lib/states/route-helpers";
import { loadInstitutions } from "@/lib/institutions";
import { getDistinctSubjects } from "@/lib/courses";
import { searchCoursesAcrossColleges } from "@/lib/courses-search";
import { getCurrentTerm, termLabel } from "@/lib/terms";
import { subjectName } from "@/lib/subjects";

// Render on demand for every request. Required to read `searchParams` (SSR of
// ?q= course-search deep links) — without it the route stays in the default
// SSG-with-dynamicParams bucket, where touching searchParams throws
// DYNAMIC_SERVER_USAGE. This matches the sibling state routes (app/[state]/
// page.tsx, schedule, transfer are all force-dynamic). The no-q landing stays
// cheap: its data loaders (getDistinctSubjects, getCurrentTerm) are cached and
// loadInstitutions is a file read, so each render is inexpensive uncached.
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ state: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// searchParams values are string | string[] (a repeated key arrives as an
// array). The course search treats each filter as a single value, mirroring the
// /api/[state]/courses/search route, so collapse to the first occurrence.
function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { state } = await params;
  const config = requireStateConfig(state);
  const q = firstParam((await searchParams).q)?.trim();
  // Query-aware metadata so a shared or Googled course-search link has a
  // descriptive title/snippet and self-canonicals to the query URL (filters are
  // dropped from the canonical so day/time/zip variants consolidate to one page).
  if (q && q.length >= 2) {
    return {
      title: `"${q}" Courses — Search All ${config.collegeCount} ${config.systemName} Colleges | ${config.branding.siteName}`,
      description: `Find "${q}" course sections across all ${config.collegeCount} ${config.name} community colleges at once — compare schedule, location, format, and transfer credit.`,
      keywords: config.branding.metaKeywords,
      alternates: { canonical: `/${state}/courses?q=${encodeURIComponent(q)}` },
    };
  }
  return {
    title: `Find a Course — Search All ${config.collegeCount} ${config.systemName} Colleges | ${config.branding.siteName}`,
    description: `Search for courses across all ${config.collegeCount} ${config.name} community colleges at once. Find the best schedule, location, and format for auditing.`,
    keywords: config.branding.metaKeywords,
    alternates: { canonical: `/${state}/courses` },
  };
}

export default async function CoursesPage({ params, searchParams }: Props) {
  const { state } = await params;
  const config = requireStateConfig(state);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com";
  const currentTerm = await getCurrentTerm(state);

  // Server-render a subject directory + college list below the client search
  // widget. Before this change the only server-rendered content on /{state}/
  // courses was the H1 + form rendered by CourseSearchClient — too thin for
  // Google to index as a meaningful landing page (GSC audit 2026-05 flagged
  // these as candidates for "Discovered – not indexed"). The subject and
  // college links also seed internal crawl paths to the per-state subject
  // and college hub pages.
  const subjects = await getDistinctSubjects(currentTerm, state).catch(
    () => [] as string[]
  );

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${siteUrl}/${state}` },
      { "@type": "ListItem", position: 2, name: "Find a Course", item: `${siteUrl}/${state}/courses` },
    ],
  };

  const searchActionLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: `Find a Course — Search All ${config.collegeCount} ${config.systemName} Colleges`,
    url: `${siteUrl}/${state}/courses`,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${siteUrl}/${state}/courses?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };

  // Build college slug → course URL map for client-side link building
  const institutions = loadInstitutions(state);
  const courseUrlMap: Record<string, string> = {};
  for (const inst of institutions) {
    courseUrlMap[inst.college_slug] = config.courseDiscoveryUrl(inst.college_slug, "__PREFIX__", "__NUMBER__");
  }

  // Server-render the unified course search for ?q= deep links. Mirrors the
  // /api/[state]/courses/search route's parsing (q / zip / mode / days / day /
  // timeOfDay) and calls the same CA-504-safe SQL-predicate search, so the
  // initial HTML contains real result rows — previously the only server content
  // for /{state}/courses?q=… was the empty search form, leaving deep links,
  // shared links, and Google results blank until client JS ran.
  const sp = await searchParams;
  const initialQuery = firstParam(sp.q)?.trim() ?? "";
  let initialResults: SearchResponse | null = null;
  if (initialQuery.length >= 2) {
    const zip = firstParam(sp.zip)?.trim() || undefined;
    const mode = firstParam(sp.mode)?.trim() || undefined;
    const daysRaw = firstParam(sp.days)?.trim();
    const singleDay = firstParam(sp.day)?.trim();
    const days = daysRaw
      ? daysRaw.split(",").map((d) => d.trim()).filter(Boolean)
      : singleDay
        ? [singleDay]
        : undefined;
    const todRaw = firstParam(sp.timeOfDay)?.trim();
    const timeOfDay =
      todRaw === "morning" || todRaw === "afternoon" || todRaw === "evening"
        ? todRaw
        : undefined;
    try {
      const r = await searchCoursesAcrossColleges(
        currentTerm,
        initialQuery,
        institutions,
        { mode, days, timeOfDay, zip },
        50,
        0,
        state
      );
      // Only seed when the server search found sections. An empty match (or a
      // natural-language query the keyword search can't resolve) is left null so
      // the client runs its LLM-refined search and can still rescue the query.
      if (r.courses.length > 0) initialResults = r;
    } catch {
      // A search failure must never break the page render — fall back to the
      // client search by leaving initialResults null.
      initialResults = null;
    }
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(searchActionLd) }}
      />
      <CourseSearchClient
        state={state}
        systemName={config.systemName}
        collegeCount={config.collegeCount}
        courseUrlMap={courseUrlMap}
        defaultZip={config.defaultZip}
        initialResults={initialResults}
      />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <section className="mt-4 border-t border-gray-200 dark:border-slate-700 pt-10">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-2">
            Browse {config.systemName} courses by subject
          </h2>
          <p className="text-sm text-gray-600 dark:text-slate-400 mb-5">
            {subjects.length > 0
              ? `${subjects.length} subjects offered across ${config.collegeCount} ${config.name} community colleges for ${termLabel(currentTerm)}.`
              : `Browse ${config.name} community college subjects — every department offered across the ${config.collegeCount}-college ${config.systemName} system.`}
          </p>
          {subjects.length > 0 && (
            <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
              {subjects.map((p) => (
                <li key={p}>
                  <Link
                    href={`/${state}/subject/${p.toLowerCase()}`}
                    className="block rounded-md px-2 py-1 text-sm text-gray-700 dark:text-slate-300 hover:bg-teal-50 dark:hover:bg-teal-900/30 hover:text-teal-700 dark:hover:text-teal-400 transition"
                  >
                    <span className="font-mono text-xs text-gray-500 dark:text-slate-400 mr-1.5">
                      {p}
                    </span>
                    {subjectName(p)}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-10 pt-10 border-t border-gray-200 dark:border-slate-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-2">
            Browse by college
          </h2>
          <p className="text-sm text-gray-600 dark:text-slate-400 mb-5">
            Course schedules, transfer credit, and program details for each of
            the {institutions.length} {config.systemName} community colleges.
          </p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1.5">
            {institutions.map((inst) => (
              <li key={inst.id}>
                <Link
                  href={`/${state}/college/${inst.id}`}
                  className="block rounded-md px-2 py-1 text-sm text-gray-700 dark:text-slate-300 hover:bg-teal-50 dark:hover:bg-teal-900/30 hover:text-teal-700 dark:hover:text-teal-400 transition"
                >
                  {inst.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {config.popularCourses.length > 0 && (
          <section className="mt-10 pt-10 border-t border-gray-200 dark:border-slate-700">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-2">
              Popular {config.name} community college courses
            </h2>
            <p className="text-sm text-gray-600 dark:text-slate-400 mb-5">
              High-enrollment courses students search for first — see every
              section, every college, and transfer credit at a glance.
            </p>
            <ul className="flex flex-wrap gap-2">
              {config.popularCourses.map((c) => {
                const slug = c.toLowerCase().replace(/\s+/g, "-");
                return (
                  <li key={c}>
                    <Link
                      href={`/${state}/course/${slug}`}
                      className="inline-block rounded-full border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-mono font-medium text-gray-700 dark:text-slate-300 hover:border-teal-300 dark:hover:border-teal-700 hover:text-teal-700 dark:hover:text-teal-400 transition"
                    >
                      {c}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}

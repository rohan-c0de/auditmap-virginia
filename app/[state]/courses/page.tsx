import type { Metadata } from "next";
import { Suspense } from "react";
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

// Async boundary child: awaits the (already-started) search and renders the
// real CourseSearchClient with the server-found results. Because it lives
// inside <Suspense>, only THIS subtree blocks on the search — the page shell
// (the form-bearing fallback + the SEO directory below) has already streamed.
async function ResolvedCourseSearch({
  promise,
  state,
  systemName,
  collegeCount,
  courseUrlMap,
  defaultZip,
}: {
  promise: Promise<SearchResponse | null>;
  state: string;
  systemName: string;
  collegeCount: number;
  courseUrlMap: Record<string, string>;
  defaultZip?: string;
}) {
  const initialResults = await promise;
  return (
    <CourseSearchClient
      state={state}
      systemName={systemName}
      collegeCount={collegeCount}
      courseUrlMap={courseUrlMap}
      defaultZip={defaultZip}
      initialResults={initialResults}
    />
  );
}

type CoursesConfig = ReturnType<typeof requireStateConfig>;

// Instant fallback for the subject directory: the heading + generic intro paint
// with the shell; the term-specific count and the subject grid stream in once
// getDistinctSubjects resolves.
function SubjectDirectoryShell({ config }: { config: CoursesConfig }) {
  return (
    <section className="mt-4 border-t border-gray-200 dark:border-slate-700 pt-10">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-2">
        Browse {config.systemName} courses by subject
      </h2>
      <p className="text-sm text-gray-600 dark:text-slate-400 mb-5">
        Browse {config.name} community college subjects — every department
        offered across the {config.collegeCount}-college {config.systemName} system.
      </p>
    </section>
  );
}

// Streamed subject directory. getDistinctSubjects is a cold cross-state scan
// (CA paginates ~188k rows), so it renders inside its own <Suspense> boundary
// rather than blocking the page shell / search form.
async function SubjectDirectory({
  state,
  config,
  currentTermPromise,
}: {
  state: string;
  config: CoursesConfig;
  currentTermPromise: Promise<string>;
}) {
  const currentTerm = await currentTermPromise;
  const subjects = currentTerm
    ? await getDistinctSubjects(currentTerm, state).catch(() => [] as string[])
    : [];
  if (subjects.length === 0) return <SubjectDirectoryShell config={config} />;
  return (
    <section className="mt-4 border-t border-gray-200 dark:border-slate-700 pt-10">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-2">
        Browse {config.systemName} courses by subject
      </h2>
      <p className="text-sm text-gray-600 dark:text-slate-400 mb-5">
        {`${subjects.length} subjects offered across ${config.collegeCount} ${config.name} community colleges for ${termLabel(currentTerm)}.`}
      </p>
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
    </section>
  );
}

export default async function CoursesPage({ params, searchParams }: Props) {
  const { state } = await params;
  const config = requireStateConfig(state);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com";

  // Resolve the current term ONCE as a shared promise. NOT awaited here: both
  // the search promise and the subject directory consume it inside their own
  // streamed <Suspense> boundary, so a cold term lookup never blocks the shell.
  // (.catch keeps it from ever rejecting, so neither consumer needs to.)
  const currentTermPromise: Promise<string> = getCurrentTerm(state).catch(() => "");

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

  // Server-render the unified course search for ?q= deep links, but STREAM it:
  // start the cross-college search WITHOUT awaiting it here, so the page shell
  // (search form + SEO directory) paints immediately and the results stream into
  // a <Suspense> boundary below. Before this the page awaited the search inline,
  // blocking first paint for the whole search — multi-second on big states (CA
  // ~6–15s cold; searchSections is cached, so it's a one-time per-query cost).
  // The promise mirrors the /api/[state]/courses/search route's parsing
  // (q / zip / mode / days / day / timeOfDay) and uses the same CA-504-safe
  // search, so the streamed HTML still carries real result rows (SEO + no-JS).
  const sp = await searchParams;
  const initialQuery = firstParam(sp.q)?.trim() ?? "";
  const hasQuery = initialQuery.length >= 2;
  const initialResultsPromise: Promise<SearchResponse | null> = hasQuery
    ? (async () => {
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
          const currentTerm = await currentTermPromise;
          const r = await searchCoursesAcrossColleges(
            currentTerm,
            initialQuery,
            institutions,
            { mode, days, timeOfDay, zip },
            50,
            0,
            state
          );
          // Resolve to results only when the server search found sections. An
          // empty match (or a natural-language query the keyword search can't
          // resolve) resolves null so the client runs its LLM-refined search and
          // can still rescue the query.
          return r.courses.length > 0 ? r : null;
        } catch {
          // A search failure must never break the page render — resolve null and
          // let the client search take over.
          return null;
        }
      })()
    : Promise.resolve(null);

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
      {/* Streamed: the fallback (the same search form + a "Searching…" state)
          flushes with the static shell so first paint is instant on every
          state; the resolved results stream in when the search settles. The
          fallback is shown only while the search is in flight — for the common
          warm/small-state case it resolves in well under a second. */}
      <Suspense
        fallback={
          <CourseSearchClient
            state={state}
            systemName={config.systemName}
            collegeCount={config.collegeCount}
            courseUrlMap={courseUrlMap}
            defaultZip={config.defaultZip}
            initialResults={null}
            pendingInitial={hasQuery}
          />
        }
      >
        <ResolvedCourseSearch
          promise={initialResultsPromise}
          state={state}
          systemName={config.systemName}
          collegeCount={config.collegeCount}
          courseUrlMap={courseUrlMap}
          defaultZip={config.defaultZip}
        />
      </Suspense>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <Suspense fallback={<SubjectDirectoryShell config={config} />}>
          <SubjectDirectory
            state={state}
            config={config}
            currentTermPromise={currentTermPromise}
          />
        </Suspense>

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

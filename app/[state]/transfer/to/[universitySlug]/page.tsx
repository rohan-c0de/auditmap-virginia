import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import {
  getCoursesForUniversity,
  getUniversitiesWithCounts,
} from "@/lib/transfer";
import { loadInstitutions } from "@/lib/institutions";
import { getStateConfig, getAllStates, isValidState } from "@/lib/states/registry";
import { subjectName } from "@/lib/subjects";
import type { TransferMapping } from "@/lib/types";
import TransferHubClient from "./TransferHubClient";
import AdUnit from "@/components/AdUnit";
import TrackView from "@/components/TrackView";

export const revalidate = 86400;

// Only serve pre-generated (state, university) combos. Any slug not in
// generateStaticParams returns a proper HTTP 404 instead of Next.js's default
// 200+notFound-ui behavior for on-demand renders. The set of valid URLs is
// finite and enumerated below, so we don't need ISR-on-demand for this route.
export const dynamicParams = false;

// Thin-content guard: only pre-generate + render pages for universities
// with at least this many transferable (direct + elective) courses.
const MIN_TRANSFERABLE = 10;

type PageProps = {
  params: Promise<{ state: string; universitySlug: string }>;
};

// ---------------------------------------------------------------------------
// Static params — one page per (state, university) where transferSupported
// and the university has >= MIN_TRANSFERABLE transferable mappings.
// ---------------------------------------------------------------------------

export async function generateStaticParams() {
  const params: { state: string; universitySlug: string }[] = [];

  for (const stateConfig of getAllStates()) {
    if (!stateConfig.transferSupported) continue;

    try {
      const universities = await getUniversitiesWithCounts(stateConfig.slug);
      for (const u of universities) {
        if (u.totalCount < MIN_TRANSFERABLE) continue;
        params.push({ state: stateConfig.slug, universitySlug: u.slug });
      }
    } catch {
      // Skip state if transfer data loading fails
    }
  }

  return params;
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const { state, universitySlug } = await props.params;
  if (!isValidState(state)) return { title: "Not Found" };

  const config = getStateConfig(state);
  if (!config.transferSupported) return { title: "Not Found" };

  const universities = await getUniversitiesWithCounts(state);
  const uni = universities.find((u) => u.slug === universitySlug);
  if (!uni || uni.totalCount < MIN_TRANSFERABLE) return { title: "Not Found" };

  const title = `Transfer to ${uni.name} from ${config.name} Community Colleges`;
  const description = `${uni.totalCount} community college courses transfer to ${uni.name}: ${uni.directCount} with direct equivalencies${uni.electiveCount > 0 ? ` and ${uni.electiveCount} as elective credit` : ""}. Browse by college or subject.`;

  const canonical = `/${state}/transfer/to/${universitySlug}`;

  return {
    title,
    description,
    keywords: [
      `transfer to ${uni.name}`,
      `${uni.name} transfer credits`,
      `${uni.name} community college transfer`,
      `${config.systemName} to ${uni.name}`,
      `${config.name} community college transfer`,
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
// Page
// ---------------------------------------------------------------------------

export default async function TransferHubPage(props: PageProps) {
  const { state, universitySlug } = await props.params;
  if (!isValidState(state)) notFound();

  const config = getStateConfig(state);
  if (!config.transferSupported) notFound();

  const universities = await getUniversitiesWithCounts(state);
  const uni = universities.find((u) => u.slug === universitySlug);
  if (!uni || uni.totalCount < MIN_TRANSFERABLE) notFound();

  // Fetch all mappings for this university, filter to transferable only.
  const allMappings = await getCoursesForUniversity(universitySlug, state);
  const mappings: TransferMapping[] = allMappings.filter(
    (m) =>
      !m.no_credit &&
      !(m.univ_course && m.univ_course.includes("*"))
  );

  if (mappings.length < MIN_TRANSFERABLE) notFound();

  // Build a lookup from CC course prefix → CC display name. We use the course
  // *prefix* rather than college because the upstream data keys mappings to
  // the CC course code (e.g. "ENG 111"), not to a specific college — the
  // same CC course transfers from any college that offers it.
  //
  // We DO want to show which colleges in the state offer each course, but
  // that requires joining with the courses dataset. For v1 we keep the page
  // focused on the transfer mapping itself and link each row out to the
  // existing /[state]/course/[code] page, which already lists colleges.
  const institutions = loadInstitutions(state);

  // Subject breakdown (unique prefixes)
  const subjectCounts = new Map<string, number>();
  for (const m of mappings) {
    subjectCounts.set(
      m.cc_prefix,
      (subjectCounts.get(m.cc_prefix) || 0) + 1
    );
  }
  const subjects = Array.from(subjectCounts.entries())
    .sort((a, b) => b[1] - a[1]);

  // Type breakdown
  const directCount = mappings.filter((m) => !m.is_elective).length;
  const electiveCount = mappings.filter((m) => m.is_elective).length;

  // JSON-LD
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${config.name} Community College Courses that Transfer to ${uni.name}`,
    description: `${mappings.length} transferable courses from ${config.systemName} to ${uni.name}.`,
    numberOfItems: mappings.length,
    url: `${siteUrl}/${state}/transfer/to/${universitySlug}`,
    itemListElement: mappings.slice(0, 25).map((m, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "Course",
        name: `${m.cc_prefix} ${m.cc_number}: ${m.cc_title}`,
        courseCode: `${m.cc_prefix} ${m.cc_number}`,
        description: `Transfers to ${uni.name} as ${m.univ_course}${m.univ_title ? `: ${m.univ_title}` : ""}${m.is_elective ? " (elective credit)" : ""}.`,
        provider: {
          "@type": "EducationalOrganization",
          name: config.systemFullName,
        },
      },
    })),
  };

  const orgLd = {
    "@context": "https://schema.org",
    "@type": "EducationalOrganization",
    name: uni.name,
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
        name: "Transfer Course Finder",
        item: `${siteUrl}/${state}/transfer`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: `Transfer to ${uni.name}`,
        item: `${siteUrl}/${state}/transfer/to/${universitySlug}`,
      },
    ],
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <TrackView
        event="transfer_hub_view"
        params={{
          state,
          university: universitySlug,
          mapping_count: mappings.length,
          direct_count: directCount,
          elective_count: electiveCount,
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />

      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-500 dark:text-slate-400 mb-4 flex-wrap">
        <Link href={`/${state}`} className="text-teal-600 hover:text-teal-700">
          {config.name}
        </Link>
        <span>/</span>
        <Link
          href={`/${state}/transfer`}
          className="text-teal-600 hover:text-teal-700"
        >
          Transfer Course Finder
        </Link>
        <span>/</span>
        <span className="text-gray-900 dark:text-slate-100 font-medium">
          {uni.name}
        </span>
      </nav>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-slate-100">
          Transfer to {uni.name}
        </h1>
        <p className="text-gray-600 dark:text-slate-400 mt-2 max-w-3xl">
          {`${mappings.length} courses from ${config.name} community colleges (${config.systemName}) transfer to ${uni.name}. Browse the full list below, or filter by community college or subject to find the courses that fit your transfer plan.`}
        </p>
      </div>

      {/* Stats strip */}
      <div className="flex flex-wrap gap-3 mb-8">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 dark:bg-green-900/30 px-3 py-1 text-xs font-medium text-green-700 dark:text-green-400 ring-1 ring-inset ring-green-200 dark:ring-green-800">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
          {directCount} Direct Equivalents
        </span>
        {electiveCount > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 dark:bg-amber-900/30 px-3 py-1 text-xs font-medium text-amber-700 dark:text-amber-400 ring-1 ring-inset ring-amber-200 dark:ring-amber-800">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            {electiveCount} Elective Credit
          </span>
        )}
        <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 dark:bg-teal-900/30 px-3 py-1 text-xs font-medium text-teal-700 dark:text-teal-400 ring-1 ring-inset ring-teal-200 dark:ring-teal-800">
          <span className="h-1.5 w-1.5 rounded-full bg-teal-500" />
          {subjects.length} Subjects
        </span>
      </div>

      {/* Browse by subject */}
      {subjects.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-3">
            Browse by Subject
          </h2>
          <div className="flex flex-wrap gap-2">
            {subjects.slice(0, 24).map(([prefix, count]) => (
              <Link
                key={prefix}
                href={`/${state}/subject/${prefix.toLowerCase()}`}
                className="inline-flex items-center gap-1.5 rounded-md bg-gray-100 dark:bg-slate-700 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-slate-300 hover:bg-teal-100 dark:hover:bg-teal-900/40 hover:text-teal-700 dark:hover:text-teal-400 transition-colors"
              >
                <span>{subjectName(prefix)}</span>
                <span className="text-gray-500 dark:text-slate-400">
                  ({count})
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Filterable course table (client) */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-3">
          All Transferable Courses
        </h2>
        <TransferHubClient
          mappings={mappings}
          state={state}
          universityName={uni.name}
        />
      </section>

      {/* In-content ad */}
      <div className="mb-8">
        <AdUnit slot="9402617538" format="auto" className="min-h-[100px]" />
      </div>

      {/* Other universities in this state */}
      {universities.length > 1 && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-3">
            Transfer to Other Universities from {config.name} CCs
          </h2>
          <div className="flex flex-wrap gap-2">
            {universities
              .filter(
                (u) => u.slug !== universitySlug && u.totalCount >= MIN_TRANSFERABLE
              )
              .slice(0, 20)
              .map((u) => (
                <Link
                  key={u.slug}
                  href={`/${state}/transfer/to/${u.slug}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-slate-300 hover:border-teal-300 dark:hover:border-teal-700 hover:text-teal-700 dark:hover:text-teal-400 transition-colors"
                >
                  <span>{u.name}</span>
                  <span className="text-gray-400 dark:text-slate-500">
                    {u.totalCount}
                  </span>
                </Link>
              ))}
          </div>
        </section>
      )}

      {/* Browse all community colleges in the state */}
      {institutions.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-3">
            Community Colleges in {config.name}
          </h2>
          <div className="flex flex-wrap gap-2">
            {institutions.slice(0, 24).map((inst) => (
              <Link
                key={inst.id}
                href={`/${state}/college/${inst.id}`}
                className="inline-block rounded-md bg-gray-100 dark:bg-slate-700 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-slate-300 hover:bg-teal-100 dark:hover:bg-teal-900/40 hover:text-teal-700 dark:hover:text-teal-400 transition-colors"
              >
                {inst.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Footer CTA */}
      <div className="mt-10 pt-6 border-t border-gray-100 dark:border-slate-800 text-sm">
        <Link
          href={`/${state}/transfer`}
          className="text-teal-600 dark:text-teal-400 hover:underline"
        >
          &larr; See all transfer pathways
        </Link>
      </div>
    </div>
  );
}

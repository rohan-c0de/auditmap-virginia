import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  loadTransferMappingsByUniversity,
  getUniversities,
  getUniversitiesWithCounts,
  loadCourseAvailability,
} from "@/lib/transfer";
import { getAllStates } from "@/lib/states/registry";
import { requireStateConfig } from "@/lib/states/route-helpers";
import TransferClient from "./TransferClient";
import TransferCoverageSection from "./TransferCoverageSection";
import { loadTransferCoverage } from "@/lib/transfer-coverage";

// Render on demand — some states' transfer data exceeds Vercel's ISR size limit
export const dynamic = "force-dynamic";
// Bump function timeout above the default 15s. Even after the perf fixes in
// #781 / #786 / #787, cold-start variance on Vercel was tipping TX/NY/MI
// over the default cap. 60s is the Pro tier ceiling for serverless. Issue #777.
export const maxDuration = 60;

type Props = {
  params: Promise<{ state: string }>;
  searchParams: Promise<{ subject?: string; to?: string }>;
};

export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { state } = await params;
  const config = requireStateConfig(state);
  if (!config.transferSupported) return {};
  return {
    title: `Transfer Course Finder — Which ${config.systemName} Courses Transfer? | ${config.branding.siteName}`,
    description: `Find which ${config.name} community college courses transfer to universities. See direct equivalencies, elective credit, and course availability.`,
    keywords: config.branding.metaKeywords,
    alternates: { canonical: `/${state}/transfer` },
  };
}

export default async function TransferPage({ params, searchParams }: Props) {
  const { state } = await params;
  const { subject: initialSubject, to: initialUniversity } = await searchParams;
  const config = requireStateConfig(state);
  if (!config.transferSupported) notFound();
  const universities = await getUniversities(state);
  const defaultUni = universities[0]?.slug || "";
  // Only ship the default university's mappings in the initial payload.
  // The client fetches other universities on demand via
  // /api/{state}/transfer/mappings?university=X, reducing the initial
  // HTML from ~7 MB (full state dataset) to ~500 KB.
  // Skip server-side mapping fetch entirely. Even capped at 2500 rows,
  // the RSC payload was hitting 3-4 MB for large states (CA/TX/MI/TN/NY),
  // and Vercel's stream took 15+ seconds to deliver it — the browser was
  // bailing with "Connection closed". TransferClient already has a lazy
  // fetch path via /api/{state}/transfer/mappings that runs on mount when
  // the seeded cache is empty. Brief loading state replaces the page-wide
  // 500. Issue #777.
  const mappings: Awaited<ReturnType<typeof loadTransferMappingsByUniversity>> = [];

  // Course-availability map ("available this term"): read from the build-time
  // cache data/{state}/course-availability.json (loadCourseAvailability →
  // scripts/build-course-availability-cache.ts). Building it server-side at
  // request time tripped Vercel's ~15s streaming timeout on big states (#777),
  // so it shipped empty and the feature silently showed 0; the cache is a cheap
  // file read with no Supabase, restoring the "Available Now" count, the
  // "available this term only" filter, and the per-row badge.
  const courseAvailability = loadCourseAvailability(state);

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com";

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${siteUrl}/${state}` },
      { "@type": "ListItem", position: 2, name: "Transfer Course Finder", item: `${siteUrl}/${state}/transfer` },
    ],
  };

  // WebPage + SearchAction for the transfer-lookup tool. Tells Google
  // this state's transfer page is a searchable surface (the receiving
  // university dropdown + course lookup), and ties back to the site-wide
  // WebSite/Organization entities declared in the root layout via @id.
  const webPageLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${siteUrl}/${state}/transfer#webpage`,
    url: `${siteUrl}/${state}/transfer`,
    name: `${config.name} Community College Transfer Course Finder`,
    description: `Find which ${config.name} community college courses transfer to universities. See direct equivalencies, elective credit, and course availability.`,
    isPartOf: { "@id": `${siteUrl}/#website` },
    about: { "@id": `${siteUrl}/#organization` },
    breadcrumb: { "@id": `${siteUrl}/${state}/transfer#breadcrumb` },
    primaryImageOfPage: { "@type": "ImageObject", url: `${siteUrl}/${state}/opengraph-image` },
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${siteUrl}/${state}/transfer?course={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageLd) }}
      />
      <Link
        href={`/${state}`}
        className="text-sm text-teal-600 hover:text-teal-700 mb-6 inline-block"
      >
        &larr; Back to search
      </Link>

      <h1 className="text-3xl font-bold text-gray-900 dark:text-slate-100 mb-2">
        Transfer Course Finder
      </h1>
      <p className="text-gray-600 dark:text-slate-400 mb-8">
        {`Find which ${config.systemName} courses transfer to your target university. See direct equivalencies, elective credit, and what's available this term.`}
      </p>

      <TransferClient
        universities={universities}
        mappings={mappings}
        courseAvailability={courseAvailability}
        defaultUniversity={defaultUni}
        state={state}
        popularCourses={config.popularCourses}
        initialSubject={initialSubject}
        initialUniversity={initialUniversity}
      />

      {/* Browse transfer pathways by university — hub-page directory */}
      <BrowseTransferHubs state={state} />

      {/* Per-receiver coverage map (currently CA only — loader returns null
          for states without a data/{state}/transfer-coverage.json file). */}
      <TransferCoverageSectionWrapper state={state} systemName={config.systemName} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal linking: directory of per-university transfer hub pages. Feeds
// crawl discovery and gives users a way to drop straight into a specific
// university's pathway. Only shows universities meeting the thin-content
// guard (>= 10 transferable courses).
// ---------------------------------------------------------------------------
async function TransferCoverageSectionWrapper({
  state,
  systemName,
}: {
  state: string;
  systemName: string;
}) {
  const coverage = await loadTransferCoverage(state);
  if (!coverage) return null;
  return <TransferCoverageSection coverage={coverage} systemName={systemName} />;
}

async function BrowseTransferHubs({ state }: { state: string }) {
  const universities = await getUniversitiesWithCounts(state);
  const eligible = universities.filter((u) => u.totalCount >= 10);
  if (eligible.length === 0) return null;

  return (
    <section className="mt-12 pt-8 border-t border-gray-200 dark:border-slate-700">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-1">
        Browse transfer pathways by university
      </h2>
      <p className="text-sm text-gray-600 dark:text-slate-400 mb-4">
        Pick a target 4-year school to see every community college course in
        the state that transfers in.
      </p>
      <div className="flex flex-wrap gap-2">
        {eligible.map((u) => (
          <Link
            key={u.slug}
            href={`/${state}/transfer/to/${u.slug}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-slate-300 hover:border-teal-300 dark:hover:border-teal-700 hover:text-teal-700 dark:hover:text-teal-400 transition-colors"
          >
            <span>{u.name}</span>
            <span className="text-xs text-gray-400 dark:text-slate-500">
              {u.totalCount}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

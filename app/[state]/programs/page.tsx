/**
 * State-level programs index — `/[state]/programs`.
 *
 * Lists every program that qualifies for the state with a one-line
 * description and section/college count, each linking to the dedicated
 * `/[state]/program/[slug]` comparison hub.
 *
 * Closes priority #5 of issue #413's internal-link audit. Pairs with the
 * "Programs" link added to the global header — every page on the site
 * now reaches the per-program comparison views in two clicks
 * (any-page → header "Programs" → state index → program hub).
 *
 * ISR cadence matches the per-program page (7 days).
 */

import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { isValidState } from "@/lib/states/registry";
import { requireStateConfig } from "@/lib/states/route-helpers";
import { PROGRAMS } from "@/lib/programs/registry";
import {
  loadProgramData,
  qualifies,
  getQualifyingProgramSlugs,
} from "@/lib/programs";
import Breadcrumbs from "@/components/Breadcrumbs";

export const revalidate = 1209600; // 14 days

type PageProps = {
  params: Promise<{ state: string }>;
};

// On-demand ISR: generate no pages at build (keeps build memory low — see the
// staticGenerationMaxConcurrency note in next.config). Programs index loads a
// state's full program data, so building all 48 at once was a memory hog.
// requireStateConfig()/isValidState 404 invalid states.
export const dynamicParams = true;

export async function generateStaticParams() {
  return [];
}

function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com"
  );
}

export async function generateMetadata(
  props: PageProps,
): Promise<Metadata> {
  const { state } = await props.params;
  if (!isValidState(state)) return { title: "Not Found" };
  const config = requireStateConfig(state);
  const slugs = await getQualifyingProgramSlugs(state);

  const title = `Programs at ${config.name} Community Colleges — Earnings, Transfer, and Course Comparison`;
  const description = `Compare ${slugs.length} program${slugs.length === 1 ? "" : "s"} across ${config.systemName} community colleges. Side-by-side awards-per-year, graduate earnings, and transfer details for popular majors at every CC in ${config.name}.`;
  const canonical = `${siteUrl()}/${state}/programs`;

  return {
    title,
    description,
    keywords: [
      `${config.name} community college programs`,
      `${config.name} community college majors`,
      `${config.systemName} programs`,
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
    twitter: { card: "summary_large_image", title, description },
  };
}

interface ProgramRow {
  slug: string;
  name: string;
  description: string;
  totalSections: number;
  totalColleges: number;
}

export default async function StateProgramsIndexPage(props: PageProps) {
  const { state } = await props.params;
  if (!isValidState(state)) notFound();
  const config = requireStateConfig(state);

  // Walk every curated program; only include ones that qualify in this
  // state. Reuses loadProgramData + qualifies() so we match exactly what
  // the per-program page shows (no chance of linking to a 404).
  const rows: ProgramRow[] = (
    await Promise.all(
      PROGRAMS.map(async (def) => {
        const data = await loadProgramData(state, def.slug).catch(() => null);
        if (!data || !qualifies(data)) return null;
        return {
          slug: def.slug,
          name: def.name,
          description: def.description,
          totalSections: data.totalSections,
          totalColleges: data.totalColleges,
        } satisfies ProgramRow;
      }),
    )
  )
    .filter((r): r is ProgramRow => r !== null)
    .sort((a, b) => b.totalSections - a.totalSections);

  if (rows.length === 0) notFound();

  const url = siteUrl();
  const itemListLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "@id": `${url}/${state}/programs#itemlist`,
    name: `Programs at ${config.name} community colleges`,
    numberOfItems: rows.length,
    url: `${url}/${state}/programs`,
    isPartOf: { "@id": `${url}/#website` },
    itemListElement: rows.map((r, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "EducationalOccupationalProgram",
        name: `${r.name} programs at ${config.name} community colleges`,
        url: `${url}/${state}/program/${r.slug}`,
        description: r.description,
      },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"

        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListLd) }}
      />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Breadcrumbs
          siteUrl={url}
          items={[
            { name: config.branding.siteName, href: `/${state}` },
            { name: "Programs", href: `/${state}/programs` },
          ]}
        />
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-slate-100">
            Programs at {config.name} community colleges
          </h1>
          <p className="text-gray-600 dark:text-slate-400 mt-2 max-w-3xl">
            {rows.length} program{rows.length === 1 ? "" : "s"} across{" "}
            {config.systemName}. Click any program to compare every college
            offering it, including median graduate earnings from the federal
            College Scorecard and per-college section counts for the current
            term.
          </p>
        </header>

        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {rows.map((r) => (
            <li key={r.slug}>
              <Link
                href={`/${state}/program/${r.slug}`}
                className="block rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 hover:border-teal-300 dark:hover:border-teal-600 transition-colors h-full"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-lg font-semibold text-teal-700 dark:text-teal-300">
                    {r.name}
                  </h2>
                  <span className="text-xs text-gray-500 dark:text-slate-400 tabular-nums whitespace-nowrap">
                    {r.totalColleges} college{r.totalColleges === 1 ? "" : "s"}
                  </span>
                </div>
                <p className="mt-1 text-sm text-gray-600 dark:text-slate-400 line-clamp-3">
                  {r.description}
                </p>
                <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">
                  {r.totalSections} section{r.totalSections === 1 ? "" : "s"}{" "}
                  this term
                </p>
              </Link>
            </li>
          ))}
        </ul>

        <p className="mt-8 text-sm text-gray-500 dark:text-slate-400">
          Don&rsquo;t see a program?{" "}
          <Link
            href={`/${state}/colleges`}
            className="underline hover:text-teal-700 dark:hover:text-teal-400"
          >
            Browse every {config.name} community college
          </Link>{" "}
          to see its full degree catalog directly.
        </p>
      </div>
    </>
  );
}


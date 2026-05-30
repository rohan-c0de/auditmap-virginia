/**
 * Online community college courses landing page (phase 4d).
 *
 * Targets queries like "online classes [state] community college". Lists
 * every college in the state offering online sections this term, with
 * total counts and top subjects. Threshold-gated — see ONLINE_MIN_*
 * in lib/online.
 */

import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { isValidState } from "@/lib/states/registry";
import { requireStateConfig } from "@/lib/states/route-helpers";
import { termLabel } from "@/lib/terms";
import { subjectName } from "@/lib/subjects";
import { loadOnlineData, onlineQualifies } from "@/lib/online";
import Breadcrumbs from "@/components/Breadcrumbs";
import RelatedBlogPosts from "@/components/RelatedBlogPosts";
import { getBlogRecommendations } from "@/lib/blog-recommendations";

export const revalidate = 604800; // 7 days

type PageProps = {
  params: Promise<{ state: string }>;
};

function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com"
  );
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const { state } = await props.params;
  if (!isValidState(state)) return { title: "Not Found" };
  const config = requireStateConfig(state);
  const data = await loadOnlineData(state);
  if (!onlineQualifies(data) || !data) return { title: "Not Found" };

  const title = `Online Community College Courses in ${config.name} (${termLabel(data.term)})`;
  const description = `Find ${data.totalSections} online sections across ${data.totalColleges} ${config.systemName} colleges for ${termLabel(data.term)}. ${data.totalUniqueCourses} unique courses available online — compare schedules and transfer options.`;
  const canonical = `${siteUrl()}/${state}/online`;

  return {
    title,
    description,
    keywords: [
      `online community college ${config.name}`,
      `online classes ${config.name} community college`,
      `${config.systemName} online courses`,
      `distance learning ${config.name}`,
      `online associate degree ${config.name}`,
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

export default async function OnlinePage(props: PageProps) {
  const { state } = await props.params;
  if (!isValidState(state)) notFound();
  const config = requireStateConfig(state);
  const data = await loadOnlineData(state);
  if (!onlineQualifies(data) || !data) notFound();

  const url = siteUrl();
  const itemListLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `Online community college courses in ${config.name}`,
    description: `${data.totalSections} online sections across ${data.totalColleges} ${config.systemName} colleges for ${termLabel(data.term)}.`,
    numberOfItems: data.colleges.length,
    url: `${url}/${state}/online`,
    itemListElement: data.colleges.slice(0, 25).map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "CollegeOrUniversity",
        name: c.collegeName,
        url: `${url}/${state}/college/${c.collegeId}`,
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
            { name: "Home", href: "/" },
            { name: config.name, href: `/${state}` },
            { name: "Online Courses", href: `/${state}/online` },
          ]}
        />

        <header className="mb-8">
          <p className="text-sm font-medium text-teal-600 dark:text-teal-400 mb-1">
            {config.name} Community Colleges
          </p>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-slate-100">
            Online Courses
          </h1>
          <p className="text-gray-600 dark:text-slate-400 mt-3 leading-relaxed max-w-3xl">
            {data.totalSections} online sections across {data.totalColleges}{" "}
            {config.systemName} colleges for {termLabel(data.term)}.{" "}
            {data.totalUniqueCourses} unique courses delivered fully online or
            via Zoom — same credits, same transfer eligibility as in-person
            sections.
          </p>
        </header>

        <section className="mb-10">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-4">
            Colleges with online courses
          </h2>
          <div className="rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-900">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 dark:bg-slate-800 text-xs uppercase tracking-wider text-gray-500 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2.5 font-medium">College</th>
                  <th className="px-4 py-2.5 font-medium text-right">
                    Online sections
                  </th>
                  <th className="px-4 py-2.5 font-medium text-right">
                    Unique courses
                  </th>
                  <th className="px-4 py-2.5 font-medium">Top subjects</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                {data.colleges.map((c) => (
                  <tr
                    key={c.collegeCode}
                    className="hover:bg-gray-50 dark:hover:bg-slate-800"
                  >
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/${state}/college/${c.collegeId}`}
                        className="font-medium text-teal-600 dark:text-teal-400 hover:underline"
                      >
                        {c.collegeName}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-900 dark:text-slate-100 font-medium">
                      {c.sectionCount}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-600 dark:text-slate-400">
                      {c.uniqueCourses}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-slate-400 text-xs">
                      {c.topSubjects.join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {data.subjects.length > 0 && (
          <section className="mb-10">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-4">
              Online subjects
            </h2>
            <ul className="grid sm:grid-cols-2 gap-2">
              {data.subjects.slice(0, 30).map((s) => (
                <li key={s.prefix}>
                  <Link
                    href={`/${state}/subject/${s.prefix.toLowerCase()}`}
                    className="flex items-baseline justify-between rounded-lg border border-gray-200 dark:border-slate-700 px-3 py-2 hover:border-teal-300 dark:hover:border-teal-600 transition"
                  >
                    <span>
                      <span className="font-mono text-sm font-medium text-teal-600 dark:text-teal-400">
                        {s.prefix}
                      </span>
                      <span className="ml-2 text-sm text-gray-700 dark:text-slate-300">
                        {subjectName(s.prefix)}
                      </span>
                    </span>
                    <span className="text-xs text-gray-500 dark:text-slate-400 shrink-0 ml-2">
                      {s.sectionCount} sections &middot; {s.collegeCount}{" "}
                      {s.collegeCount === 1 ? "college" : "colleges"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Related blog posts — programmatic → editorial cross-pollination (#371) */}
        <RelatedBlogPosts
          articles={getBlogRecommendations({
            state,
            pageType: "online",
          })}
          heading={`Related ${config.name} guides`}
        />
      </div>
    </>
  );
}

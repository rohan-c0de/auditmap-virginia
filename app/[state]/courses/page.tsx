import type { Metadata } from "next";
import CourseSearchClient from "./CourseSearchClient";
import { getStateConfig, getAllStates } from "@/lib/states/registry";
import { loadInstitutions } from "@/lib/institutions";

type Props = {
  params: Promise<{ state: string }>;
};

export function generateStaticParams() {
  return getAllStates().map((s) => ({ state: s.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { state } = await params;
  const config = getStateConfig(state);
  return {
    title: `Find a Course — Search All ${config.collegeCount} ${config.systemName} Colleges | ${config.branding.siteName}`,
    description: `Search for courses across all ${config.collegeCount} ${config.name} community colleges at once. Find the best schedule, location, and format for auditing.`,
    keywords: config.branding.metaKeywords,
    alternates: { canonical: `/${state}/courses` },
  };
}

export default async function CoursesPage({ params }: Props) {
  const { state } = await params;
  const config = getStateConfig(state);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com";

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
      />
    </>
  );
}

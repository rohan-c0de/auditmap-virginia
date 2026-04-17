import Link from "next/link";
import type { Metadata } from "next";
import { loadInstitutions } from "@/lib/institutions";
import { getCourseCount } from "@/lib/courses";
import { getCurrentTerm } from "@/lib/terms";
import { getStateConfig, getAllStates } from "@/lib/states/registry";

export const revalidate = 86400; // Revalidate daily so new course imports show up

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
    title: `All ${config.collegeCount} ${config.systemName} Colleges — ${config.branding.siteName}`,
    description: `Browse all ${config.name} community colleges — see course counts, transfer data, and campus locations.`,
    keywords: config.branding.metaKeywords,
    alternates: { canonical: `/${state}/colleges` },
  };
}

export default async function CollegesPage({ params }: Props) {
  const { state } = await params;
  const config = getStateConfig(state);
  const institutions = loadInstitutions(state);

  // Sort alphabetically
  const sorted = [...institutions].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  const verifiedCount = sorted.filter(
    (i) => i.audit_policy.allowed === true
  ).length;
  const unverifiedCount = sorted.filter(
    (i) => i.audit_policy.allowed === null
  ).length;

  // Pre-compute course counts (async)
  const currentTerm = await getCurrentTerm(state);
  const courseCountMap = new Map<string, number>();
  for (const inst of sorted) {
    const count = await getCourseCount(inst.college_slug, currentTerm, state);
    courseCountMap.set(inst.college_slug, count);
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com";

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${siteUrl}/${state}` },
      { "@type": "ListItem", position: 2, name: "All Colleges", item: `${siteUrl}/${state}/colleges` },
    ],
  };

  const collectionLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `All ${config.collegeCount} ${config.systemName} Colleges`,
    description: `Browse all ${config.name} community colleges — see course counts, transfer data, and campus locations.`,
    url: `${siteUrl}/${state}/colleges`,
    numberOfItems: sorted.length,
    itemListElement: sorted.map((inst, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "EducationalOrganization",
        name: inst.name,
        url: `${siteUrl}/${state}/college/${inst.id}`,
      },
    })),
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionLd) }}
      />
      <Link
        href={`/${state}`}
        className="text-sm text-teal-600 hover:text-teal-700 mb-6 inline-block"
      >
        &larr; Back to search
      </Link>

      <h1 className="text-3xl font-bold text-gray-900 dark:text-slate-100 mb-2">
        All {config.collegeCount} {config.systemName} Colleges
      </h1>
      <p className="text-gray-600 dark:text-slate-400 mb-8">
        Browse courses, check transfers, and find audit policies across all{" "}
        {config.collegeCount} colleges.
      </p>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {sorted.map((institution) => {
          const courseCount = courseCountMap.get(institution.college_slug) || 0;
          const allowed = institution.audit_policy.allowed;

          return (
            <Link
              key={institution.id}
              href={`/${state}/college/${institution.id}`}
              className="group block rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 transition hover:shadow-md dark:hover:shadow-slate-900/50 hover:border-teal-300"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <h2 className="font-semibold text-gray-900 dark:text-slate-100 group-hover:text-teal-700 text-sm leading-tight">
                  {institution.name}
                </h2>
                {allowed === true ? (
                  <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 ring-1 ring-inset ring-emerald-200 dark:ring-emerald-800">
                    <span className="h-1 w-1 rounded-full bg-emerald-500" />
                    Verified
                  </span>
                ) : (
                  <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-900/30 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400 ring-1 ring-inset ring-amber-200 dark:ring-amber-800">
                    <span className="h-1 w-1 rounded-full bg-amber-500" />
                    Unverified
                  </span>
                )}
              </div>

              <p className="text-xs text-gray-500 dark:text-slate-400 mb-3">
                {institution.campuses?.map((c) => c.name).join(" · ") || "Campus info unavailable"}
              </p>

              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500 dark:text-slate-400">
                  {courseCount > 0 ? (
                    <>
                      <span className="font-medium text-gray-700 dark:text-slate-300">
                        {courseCount}
                      </span>{" "}
                      courses
                    </>
                  ) : (
                    <span className="text-gray-400 dark:text-slate-500">No course data</span>
                  )}
                </span>
                {allowed === true &&
                  institution.audit_policy.eligibility.senior_discount
                    .available && (
                    <span className="text-teal-600 font-medium">
                      Free for {institution.audit_policy.eligibility.senior_discount.age_threshold ?? config.seniorWaiver?.ageThreshold ?? 60}+
                    </span>
                  )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

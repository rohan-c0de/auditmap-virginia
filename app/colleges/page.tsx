import Link from "next/link";
import type { Metadata } from "next";
import { getAllStates } from "@/lib/states/registry";
import { loadInstitutions } from "@/lib/institutions";
import { getCourseCount } from "@/lib/courses";
import { getCurrentTerm } from "@/lib/terms";

export const revalidate = 86400;

export const metadata: Metadata = {
  title:
    "All Community Colleges — Browse 160+ Colleges Across 13 States | CC CourseMap",
  description:
    "Browse every community college on CC CourseMap. Find courses, check transfer equivalencies, and compare colleges across Virginia, North Carolina, Georgia, New York, and more.",
  keywords: [
    "community colleges",
    "community college directory",
    "community college courses",
    "community college near me",
    "CC course finder",
  ],
  alternates: {
    canonical: "/colleges",
  },
};

export default async function AllCollegesPage() {
  const states = getAllStates();
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com";

  // Build per-state data: institutions + course counts
  const stateData: {
    slug: string;
    name: string;
    systemName: string;
    institutions: {
      id: string;
      name: string;
      campuses: string;
      courseCount: number;
      hasSenior: boolean;
    }[];
  }[] = [];

  let totalColleges = 0;
  let totalCourses = 0;

  for (const config of states) {
    const institutions = loadInstitutions(config.slug);
    const currentTerm = await getCurrentTerm(config.slug);
    const sorted = [...institutions].sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    const insts: (typeof stateData)[number]["institutions"] = [];
    for (const inst of sorted) {
      const courseCount = await getCourseCount(
        inst.college_slug,
        currentTerm,
        config.slug
      );
      totalCourses += courseCount;
      insts.push({
        id: inst.id,
        name: inst.name,
        campuses:
          inst.campuses?.map((c) => c.name).join(", ") || "",
        courseCount,
        hasSenior:
          inst.audit_policy.allowed === true &&
          inst.audit_policy.eligibility.senior_discount.available,
      });
    }

    totalColleges += insts.length;
    stateData.push({
      slug: config.slug,
      name: config.name,
      systemName: config.systemName,
      institutions: insts,
    });
  }

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: siteUrl,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "All Colleges",
        item: `${siteUrl}/colleges`,
      },
    ],
  };

  const collectionLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "All Community Colleges",
    description: `Browse ${totalColleges} community colleges across ${states.length} states.`,
    url: `${siteUrl}/colleges`,
    numberOfItems: totalColleges,
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionLd) }}
      />

      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-500 dark:text-slate-400 mb-6">
        <Link href="/" className="text-teal-600 hover:text-teal-700">
          Home
        </Link>
        <span>/</span>
        <span className="text-gray-900 dark:text-slate-100 font-medium">
          All Colleges
        </span>
      </nav>

      {/* Header */}
      <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-slate-100 mb-2">
        All Community Colleges
      </h1>
      <p className="text-gray-600 dark:text-slate-400 mb-8 max-w-2xl">
        Browse {totalColleges} community colleges across {states.length} states
        {totalCourses > 0 && (
          <>
            {" "}
            with{" "}
            <span className="font-medium text-gray-900 dark:text-slate-200">
              {totalCourses.toLocaleString()}
            </span>{" "}
            course sections available
          </>
        )}
        .
      </p>

      {/* Jump links */}
      <div className="flex flex-wrap gap-2 mb-10">
        {stateData.map((s) => (
          <a
            key={s.slug}
            href={`#${s.slug}`}
            className="inline-block rounded-md bg-gray-100 dark:bg-slate-700 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-slate-300 hover:bg-teal-100 dark:hover:bg-teal-900/40 hover:text-teal-700 dark:hover:text-teal-400 transition-colors"
          >
            {s.name} ({s.institutions.length})
          </a>
        ))}
      </div>

      {/* State sections */}
      <div className="space-y-12">
        {stateData.map((s) => (
          <section key={s.slug} id={s.slug}>
            <div className="flex items-baseline gap-3 mb-4">
              <Link href={`/${s.slug}`} className="group">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-slate-100 group-hover:text-teal-600 transition-colors">
                  {s.name}
                </h2>
              </Link>
              <span className="text-sm text-gray-500 dark:text-slate-400">
                {s.systemName} &middot; {s.institutions.length} colleges
              </span>
              <Link
                href={`/${s.slug}/colleges`}
                className="ml-auto text-sm text-teal-600 hover:text-teal-700 transition-colors"
              >
                View all &rarr;
              </Link>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {s.institutions.map((inst) => (
                <Link
                  key={inst.id}
                  href={`/${s.slug}/college/${inst.id}`}
                  className="group block rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3.5 transition hover:shadow-md dark:hover:shadow-slate-900/50 hover:border-teal-300"
                >
                  <h3 className="font-semibold text-gray-900 dark:text-slate-100 group-hover:text-teal-700 text-sm leading-tight mb-1">
                    {inst.name}
                  </h3>
                  {inst.campuses && (
                    <p className="text-[11px] text-gray-400 dark:text-slate-500 truncate mb-2">
                      {inst.campuses}
                    </p>
                  )}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-500 dark:text-slate-400">
                      {inst.courseCount > 0 ? (
                        <>
                          <span className="font-medium text-gray-700 dark:text-slate-300">
                            {inst.courseCount}
                          </span>{" "}
                          sections
                        </>
                      ) : (
                        <span className="text-gray-400 dark:text-slate-500">
                          No course data
                        </span>
                      )}
                    </span>
                    {inst.hasSenior && (
                      <span className="text-green-600 dark:text-green-400 font-medium text-[10px]">
                        Senior discount
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { loadInstitutions } from "@/lib/institutions";
import { requireStateConfig } from "@/lib/states/route-helpers";
import { getAllStates } from "@/lib/states/registry";
import { loadCollegePrograms, checkCourseAvailability } from "@/lib/programs/requirements";
import { getCurrentTerm } from "@/lib/terms";
import { ProgramList } from "@/components/ProgramRequirements";
import Breadcrumbs from "@/components/Breadcrumbs";

export const revalidate = 1209600; // 14 days

type PageProps = {
  params: Promise<{ state: string; id: string }>;
};

function siteUrl() {
  return (
    process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com"
  );
}

export async function generateStaticParams() {
  return [];
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const { state, id } = await props.params;
  const institutions = loadInstitutions(state);
  const institution = institutions.find((i) => i.id === id);
  if (!institution) return { title: "Not Found" };

  const config = requireStateConfig(state);
  const title = `Degree Programs at ${institution.name} | Community College Path`;
  const description = `Browse degree and certificate programs at ${institution.name}. See requirements, courses, and credits needed for graduation.`;

  const canonical = `/${state}/college/${id}/programs`;
  return {
    title,
    description,
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

export default async function CollegeProgramsPage(props: PageProps) {
  const { state, id } = await props.params;
  const config = requireStateConfig(state);
  const institutions = loadInstitutions(state);
  const institution = institutions.find((i) => i.id === id);
  if (!institution) notFound();

  const [programs, term] = await Promise.all([
    loadCollegePrograms(state, institution.college_slug),
    getCurrentTerm(state),
  ]);

  const availabilityMap = programs.length > 0
    ? await checkCourseAvailability(state, institution.college_slug, term, programs)
    : new Map<string, number>();
  const availability = Object.fromEntries(availabilityMap);

  const url = siteUrl();

  const programsLd = programs.slice(0, 50).map((p) => ({
    "@type": "EducationalOccupationalProgram",
    name: p.title,
    educationalCredentialAwarded: p.credential.toUpperCase(),
    ...(p.total_credits != null && { numberOfCredits: { "@type": "StructuredValue", value: p.total_credits } }),
    ...(p.catalog_url && { url: p.catalog_url }),
    provider: {
      "@type": "CollegeOrUniversity",
      name: institution.name,
      url: `${url}/${state}/college/${id}`,
    },
  }));

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `Degree & Certificate Programs at ${institution.name}`,
    numberOfItems: programs.length,
    url: `${url}/${state}/college/${id}/programs`,
    itemListElement: programsLd.map((p, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: p,
    })),
  };

  return (
    <>
      {programs.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Breadcrumbs
        siteUrl={url}
        items={[
          { name: "Home", href: "/" },
          { name: config.name, href: `/${state}` },
          { name: institution.name, href: `/${state}/college/${id}` },
          {
            name: "Programs",
            href: `/${state}/college/${id}/programs`,
          },
        ]}
      />

      <header className="mb-8">
        <p className="text-sm font-medium text-teal-600 dark:text-teal-400 mb-1">
          <Link
            href={`/${state}/college/${id}`}
            className="hover:underline"
          >
            {institution.name}
          </Link>
        </p>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-slate-100">
          Degree &amp; Certificate Programs
        </h1>
        {programs.length > 0 ? (
          <p className="text-gray-600 dark:text-slate-400 mt-2">
            {programs.length}{" "}
            {programs.length === 1 ? "program" : "programs"} available.
            Expand any program to see the courses required for graduation.
          </p>
        ) : (
          <p className="text-gray-600 dark:text-slate-400 mt-2">
            Program requirement data is not yet available for{" "}
            {institution.name}. Check back soon or visit the{" "}
            <Link
              href={`/${state}/college/${id}`}
              className="text-teal-600 dark:text-teal-400 hover:underline"
            >
              college page
            </Link>{" "}
            to browse available courses.
          </p>
        )}
      </header>

      {programs.length > 0 && (
        <ProgramList
          state={state}
          collegeId={id}
          programs={programs}
          availability={availability}
        />
      )}

      <div className="mt-10 pt-6 border-t border-gray-200 dark:border-slate-700">
        <Link
          href={`/${state}/college/${id}`}
          className="text-sm text-teal-600 dark:text-teal-400 hover:underline"
        >
          &larr; Back to {institution.name}
        </Link>
      </div>
    </div>
    </>
  );
}

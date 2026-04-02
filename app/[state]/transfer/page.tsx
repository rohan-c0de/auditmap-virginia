import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadTransferMappings, getUniversities } from "@/lib/transfer";
import { loadAllCourses, getAvailableTerms } from "@/lib/courses";
import { getStateConfig } from "@/lib/states/registry";
import TransferClient from "./TransferClient";

type Props = {
  params: Promise<{ state: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { state } = await params;
  const config = getStateConfig(state);
  if (!config.transferSupported) return {};
  return {
    title: `Transfer Course Finder — Which ${config.systemName} Courses Transfer? | ${config.branding.siteName}`,
    description: `Find which ${config.name} community college courses transfer to universities. See direct equivalencies, elective credit, and course availability.`,
  };
}

export default async function TransferPage({ params }: Props) {
  const { state } = await params;
  const config = getStateConfig(state);
  if (!config.transferSupported) notFound();
  const universities = getUniversities(state);
  const defaultUni = universities[0]?.slug || "";
  // Pass ALL mappings — client filters by selected university
  const mappings = loadTransferMappings(state);

  // Get course availability across all terms for cross-referencing
  const allCourses = getAvailableTerms(state).flatMap((t) => loadAllCourses(t, state));
  const courseAvailability: Record<string, { colleges: string[]; totalSections: number }> = {};
  for (const c of allCourses) {
    const key = `${c.course_prefix}-${c.course_number}`;
    if (!courseAvailability[key]) {
      courseAvailability[key] = { colleges: [], totalSections: 0 };
    }
    courseAvailability[key].totalSections++;
    if (!courseAvailability[key].colleges.includes(c.college_code)) {
      courseAvailability[key].colleges.push(c.college_code);
    }
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://www.auditmap.com";

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${siteUrl}/${state}` },
      { "@type": "ListItem", position: 2, name: "Transfer Course Finder" },
    ],
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      <Link
        href={`/${state}`}
        className="text-sm text-teal-600 hover:text-teal-700 mb-6 inline-block"
      >
        &larr; Back to search
      </Link>

      <h1 className="text-3xl font-bold text-gray-900 mb-2">
        Transfer Course Finder
      </h1>
      <p className="text-gray-600 mb-8">
        {`Find which ${config.systemName} courses transfer to your target university. See direct equivalencies, elective credit, and what's available this term.`}
      </p>

      <TransferClient
        universities={universities}
        mappings={mappings}
        courseAvailability={courseAvailability}
        defaultUniversity={defaultUni}
        state={state}
      />
    </div>
  );
}

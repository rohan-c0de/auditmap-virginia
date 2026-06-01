import type { Metadata } from "next";
import { requireStateConfig } from "@/lib/states/route-helpers";
import PlannerClient from "./PlannerClient";

type Props = {
  params: Promise<{ state: string }>;
};

// On-demand ISR: generate no pages at build (keeps build memory low — see the
// staticGenerationMaxConcurrency note in next.config). requireStateConfig()
// 404s invalid states.
export const dynamicParams = true;
export const revalidate = 1209600; // 14 days
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { state } = await params;
  const config = requireStateConfig(state);
  // Title leads with the search-intent phrase ("{State} Community College
  // Course Planner") so the SERP snippet matches what users type when they
  // search for this tool. The previous title led with "Semester Planner —"
  // which buried the state and the noun ("course planner") behind a brand
  // prefix.
  const title = `${config.name} Community College Course Planner — Free Prerequisite Sequencer`;
  const description = `Free degree planner for ${config.name} community college students. Add the courses you want to take and we'll automatically map prerequisites into a semester-by-semester sequence. Save your plan and get notified when seats open.`;
  const url = `https://communitycollegepath.com/${state}/plan`;
  return {
    title,
    description,
    // Was noindex; flipping now that the page is a real destination — PR #827
    // turned plans into saved objects and PR #859 added seat-open
    // notifications, so this URL is genuinely worth ranking for.
    robots: { index: true, follow: true },
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      type: "website",
    },
  };
}

export default async function PlanPage({ params }: Props) {
  const { state } = await params;
  const config = requireStateConfig(state);

  // Schema.org WebApplication markup tells Google this is an interactive
  // tool, not a static article. Improves rich-result eligibility for
  // "{state} community college planner" queries.
  const webAppLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: `${config.name} Community College Course Planner`,
    description: `Free semester-by-semester degree planner for ${config.name} community college students. Maps prerequisites automatically; saves plans and notifies you when seats open.`,
    url: `https://communitycollegepath.com/${state}/plan`,
    applicationCategory: "EducationalApplication",
    operatingSystem: "Any",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    inLanguage: "en-US",
    audience: {
      "@type": "EducationalAudience",
      educationalRole: "student",
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webAppLd) }}
      />
      <PlannerClient
        state={state}
        systemName={config.systemName}
        stateName={config.name}
      />
    </>
  );
}

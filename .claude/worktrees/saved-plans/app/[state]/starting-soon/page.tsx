import type { Metadata } from "next";
import StartingSoonClient from "./StartingSoonClient";
import { getAllStates } from "@/lib/states/registry";
import { requireStateConfig } from "@/lib/states/route-helpers";
import Breadcrumbs from "@/components/Breadcrumbs";

type Props = {
  params: Promise<{ state: string }>;
};

export function generateStaticParams() {
  return getAllStates().map((s) => ({ state: s.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { state } = await params;
  const config = requireStateConfig(state);
  return {
    title: `Courses Starting Soon — Late-Start Classes | ${config.branding.siteName}`,
    description: `Find late-start courses, mini-sessions, and upcoming classes across all ${config.collegeCount} ${config.name} community colleges. Don't miss registration deadlines.`,
    alternates: { canonical: `/${state}/starting-soon` },
    // Tool page: the section list loads client-side, so the server HTML is
    // just a heading + empty container. Google was flagging these as Soft
    // 404 because the rendered HTML it crawls contains no real content.
    robots: { index: false, follow: true },
  };
}

export default async function StartingSoonPage({ params }: Props) {
  const { state } = await params;
  const config = requireStateConfig(state);
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com";

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <Breadcrumbs
        siteUrl={siteUrl}
        items={[
          { name: "Home", href: "/" },
          { name: config.name, href: `/${state}` },
          { name: "Starting Soon", href: `/${state}/starting-soon` },
        ]}
      />

      <h1 className="text-3xl font-bold text-gray-900 dark:text-slate-100 mb-2">
        Courses Starting Soon
      </h1>
      <p className="text-gray-600 dark:text-slate-400 mb-8">
        Late-start courses, mini-sessions, and upcoming classes across all{" "}
        {config.collegeCount} {config.name} community colleges. Find sections
        still open for registration.
      </p>

      <StartingSoonClient state={state} defaultZip={config.defaultZip} />
    </div>
  );
}

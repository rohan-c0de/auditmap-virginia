import Link from "next/link";
import type { Metadata } from "next";
import StartingSoonClient from "./StartingSoonClient";
import { getStateConfig } from "@/lib/states/registry";

type Props = {
  params: Promise<{ state: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { state } = await params;
  const config = getStateConfig(state);
  return {
    title: `Courses Starting Soon — Late-Start Classes | ${config.branding.siteName}`,
    description: `Find late-start courses, mini-sessions, and upcoming classes across all ${config.collegeCount} ${config.name} community colleges. Don't miss registration deadlines.`,
  };
}

export default async function StartingSoonPage({ params }: Props) {
  const { state } = await params;
  const config = getStateConfig(state);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <Link
        href={`/${state}`}
        className="text-sm text-teal-600 hover:text-teal-700 mb-6 inline-block"
      >
        &larr; Back to search
      </Link>

      <h1 className="text-3xl font-bold text-gray-900 mb-2">
        Courses Starting Soon
      </h1>
      <p className="text-gray-600 mb-8">
        Late-start courses, mini-sessions, and upcoming classes across all{" "}
        {config.collegeCount} {config.name} community colleges. Find sections
        still open for registration.
      </p>

      <StartingSoonClient state={state} defaultZip={config.defaultZip} />
    </div>
  );
}

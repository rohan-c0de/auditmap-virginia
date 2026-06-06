import type { Metadata } from "next";
import ScheduleClient from "./ScheduleClient";
import { requireStateConfig } from "@/lib/states/route-helpers";
import { getUniversities } from "@/lib/transfer";
import { getAvailableTermsForDisplay } from "@/lib/terms";
import { loadSubjectVocab } from "@/lib/programs/subject-vocab";
import { quickAddSubjectsForState } from "@/lib/schedule-chips";

type Props = {
  params: Promise<{ state: string }>;
};

// Schedule pages are noindex and fully client-driven — no SEO benefit from
// static generation. At build time, large states (TX: 20k+ sections, 90MB
// transfers) saturate the Supabase connection pool when multiple pages are
// generated in parallel, causing statement timeouts that kill the entire
// build. Force-dynamic avoids the build-time query load entirely; the page
// renders on first request and is then edge-cached per Vercel's defaults.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { state } = await params;
  const config = requireStateConfig(state);
  return {
    title: `Smart Schedule Builder — ${config.branding.siteName}`,
    description: `Build conflict-free course schedules across all ${config.collegeCount} ${config.name} community colleges. Set your constraints and get personalized schedule suggestions.`,
    robots: { index: false, follow: true },
  };
}

export default async function SchedulePage({ params }: Props) {
  const { state } = await params;
  const config = requireStateConfig(state);

  // Load available transfer universities and terms for this state
  let universities: { slug: string; name: string }[] = [];
  let terms: { code: string; label: string }[] = [];
  try {
    universities = await getUniversities(state);
  } catch {
    // Transfer data unavailable — university dropdown will be hidden
  }
  try {
    terms = await getAvailableTermsForDisplay(state);
  } catch {
    // Terms unavailable — term selector will be hidden
  }

  // Quick-add chips: curated popularCourses prefixes first, then the state's
  // most-offered subjects from the precomputed subject vocab. Falls back to
  // just the popularCourses prefixes when no vocab exists for the state.
  const quickAddSubjects = quickAddSubjectsForState(
    loadSubjectVocab(state),
    config.popularCourses
  );

  return (
    <ScheduleClient
      state={state}
      systemName={config.systemName}
      collegeCount={config.collegeCount}
      defaultZip={config.defaultZip}
      universities={universities}
      terms={terms}
      quickAddSubjects={quickAddSubjects}
    />
  );
}

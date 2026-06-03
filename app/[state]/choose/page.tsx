/**
 * "Help me choose" guided flow — `/[state]/choose`.
 *
 * A short interest → goal → schedule quiz for students who don't yet know
 * what to study. Matches against the REAL program catalog and links each
 * result to the existing /[state]/program/[slug] comparison hub.
 *
 * Owner-approved concept (the `choose.html` prototype). Data is gathered
 * server-side via `gatherChooseFacts` (live sections + BLS wages); the quiz
 * itself is a small client component. Only programs that QUALIFY for a
 * program page are ever surfaced, so a match can never dead-end on a 404.
 *
 * On-demand ISR (7 days) like the program/programs pages — no build-time
 * fan-out. notFound() when the state has no qualifying programs at all
 * (same gate as the /[state]/programs index).
 */

import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { isValidState } from "@/lib/states/registry";
import { requireStateConfig } from "@/lib/states/route-helpers";
import { gatherChooseFacts } from "@/lib/programs/choose-data";
import Breadcrumbs from "@/components/Breadcrumbs";
import ChooseQuiz from "@/components/ChooseQuiz";

export const revalidate = 604800; // 7 days
export const dynamicParams = true;

export async function generateStaticParams() {
  return [];
}

type PageProps = {
  params: Promise<{ state: string }>;
};

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com";
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const { state } = await props.params;
  if (!isValidState(state)) return { title: "Not Found" };
  const config = requireStateConfig(state);
  const title = `Not sure what to study? Find your program — ${config.name} Community Colleges`;
  const description = `Answer three quick questions and we'll point you to community-college programs in ${config.name} that fit how you want to work — with real college counts, schedules, and earnings.`;
  const canonical = `${siteUrl()}/${state}/choose`;
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
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function ChoosePage(props: PageProps) {
  const { state } = await props.params;
  if (!isValidState(state)) notFound();
  const config = requireStateConfig(state);

  const facts = await gatherChooseFacts(state);
  // No qualifying programs at all → the tool has nothing to offer. Same gate
  // as the /[state]/programs index, which notFound()s on an empty result.
  if (facts.length === 0) notFound();

  const url = siteUrl();

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-8">
      <Breadcrumbs
        siteUrl={url}
        items={[
          { name: config.branding.siteName, href: `/${state}` },
          { name: "Find your program", href: `/${state}/choose` },
        ]}
      />

      <header className="mt-2 text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-900/30 px-3.5 py-1.5 text-[13px] font-semibold text-teal-700 dark:text-teal-300">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5"
            aria-hidden="true"
          >
            <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z" />
          </svg>
          No experience needed
        </span>
        <h1 className="mt-4 text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
          Not sure what to study?{" "}
          <span className="text-teal-600 dark:text-teal-400">Let&rsquo;s find it.</span>
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-[15px] sm:text-base text-slate-500 dark:text-slate-400">
          Three quick questions. We&rsquo;ll point you to {config.name} community
          college programs that fit how you want to work — and what you want out
          of it.
        </p>
      </header>

      <div className="mt-2">
        {/* Suspense boundary required: ChooseQuiz reads useSearchParams to keep
            the quiz answers in the URL (shareable / refresh-safe). */}
        <Suspense fallback={<div className="min-h-[420px]" />}>
          <ChooseQuiz
            state={state}
            stateName={config.name}
            facts={facts}
            transferSupported={config.transferSupported}
          />
        </Suspense>
      </div>
    </div>
  );
}

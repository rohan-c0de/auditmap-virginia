/**
 * Transfer-Validated Major Plan — Phase 1 of the Degree-Path Planner.
 *
 * e.g. `/ga/college/atlanta-tech/program/business-management-aas`
 *
 * For one college program, shows every required course with a per-university
 * transfer verdict (direct / elective / no-credit) and live section counts —
 * the cross-dataset join that the separate search / transfer / schedule tools
 * make the student assemble by hand. See lib/programs/planner.ts.
 *
 * ISR (1 day), same cadence as the college page. University selection happens
 * client-side from a tiny server-built payload, so the route stays static and
 * never opts into dynamic rendering (cf. the college page's searchParams note).
 */

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { isValidState } from "@/lib/states/registry";
import { requireStateConfig } from "@/lib/states/route-helpers";
import { loadInstitutions } from "@/lib/institutions";
import { buildMajorPlan } from "@/lib/programs/planner";
import { getScorecard, formatDollar, formatPercent } from "@/lib/scorecard";
import { termLabel } from "@/lib/terms";
import Breadcrumbs from "@/components/Breadcrumbs";
import PlanClient from "./PlanClient";

export const revalidate = 86400; // 1 day
export const dynamicParams = true;

interface PageProps {
  params: Promise<{ state: string; id: string; slug: string }>;
}

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com";
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const { state, id, slug } = await props.params;
  if (!isValidState(state)) return {};
  const plan = await buildMajorPlan(state, id, slug).catch(() => null);
  if (!plan) return {};
  const title = `${plan.program.title} (${plan.program.credential}) at ${plan.collegeName} — Transfer Plan`;
  const description = `Every required course for the ${plan.program.title} ${plan.program.credential} at ${plan.collegeName}, with which transfer to your target university and which are offered this term.`;
  return {
    title,
    description,
    alternates: { canonical: `${siteUrl()}/${state}/college/${id}/program/${slug}` },
  };
}

export default async function MajorPlanPage(props: PageProps) {
  const { state, id, slug } = await props.params;
  if (!isValidState(state)) notFound();
  const config = requireStateConfig(state);

  const institution = loadInstitutions(state).find((i) => i.id === id);
  if (!institution) notFound();

  const plan = await buildMajorPlan(state, id, slug);
  if (!plan) notFound();

  const collegeHref = `/${state}/college/${id}`;
  const transferHref = `/${state}/transfer`;

  // College-wide outcomes (federal Scorecard) — context, NOT program-specific.
  const sc = getScorecard(state, id);
  const outcomeTiles: { label: string; value: string }[] = [];
  if (sc) {
    if (sc.cost.tuitionInState != null)
      outcomeTiles.push({ label: "In-state tuition / yr", value: formatDollar(sc.cost.tuitionInState) });
    if (sc.completion.completionRate150nt != null)
      outcomeTiles.push({ label: "Graduate on time", value: formatPercent(sc.completion.completionRate150nt) });
    const earn = sc.earnings.median1YrAfterCompletion ?? sc.earnings.median10YrsAfterEntry;
    if (earn != null)
      outcomeTiles.push({ label: "Median earnings after", value: formatDollar(earn) });
    if (sc.earnings.shareEarningAboveHsGrad != null)
      outcomeTiles.push({ label: "Earn above HS-grad wage", value: formatPercent(sc.earnings.shareEarningAboveHsGrad) });
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Breadcrumbs
        siteUrl={siteUrl()}
        items={[
          { name: "Home", href: "/" },
          { name: config.name, href: `/${state}` },
          { name: plan.collegeName, href: collegeHref },
          {
            name: `${plan.program.title} plan`,
            href: `/${state}/college/${id}/program/${slug}`,
          },
        ]}
      />

      <header className="mb-6 mt-4">
        <p className="text-sm font-medium uppercase tracking-wide text-blue-600 dark:text-blue-400">
          Transfer plan
        </p>
        <h1 className="mt-1 text-2xl font-bold text-gray-900 dark:text-slate-100 sm:text-3xl">
          {plan.program.title}{" "}
          <span className="text-gray-400 dark:text-slate-500">({plan.program.credential})</span>
        </h1>
        <p className="mt-1 text-gray-600 dark:text-slate-300">
          at{" "}
          <a href={collegeHref} className="text-blue-600 dark:text-blue-400 underline">
            {plan.collegeName}
          </a>
          {plan.program.totalCredits ? ` · ${plan.program.totalCredits} credits` : ""}
          {plan.term ? ` · sections shown for ${termLabel(plan.term)}` : ""}
        </p>
        {plan.program.catalogUrl && (
          <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">
            <a href={plan.program.catalogUrl} className="underline" rel="nofollow">
              Official catalog →
            </a>
          </p>
        )}
      </header>

      {outcomeTiles.length > 0 && (
        <section className="mb-6 rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50 p-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {outcomeTiles.map((t) => (
              <div key={t.label}>
                <div className="text-lg font-bold text-gray-900 dark:text-slate-100">{t.value}</div>
                <div className="text-xs text-gray-500 dark:text-slate-400">{t.label}</div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-gray-400 dark:text-slate-500">
            College-wide figures for {plan.collegeName} from the federal College
            Scorecard — not specific to this program.
          </p>
        </section>
      )}

      <PlanClient plan={plan} transferHref={transferHref} />
    </main>
  );
}

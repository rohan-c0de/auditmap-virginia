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

import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { isValidState } from "@/lib/states/registry";
import { requireStateConfig } from "@/lib/states/route-helpers";
import { loadInstitutions } from "@/lib/institutions";
import { buildMajorPlan, resolveCanonicalProgramSlug } from "@/lib/programs/planner";
import { getScorecard, formatDollar, formatPercent } from "@/lib/scorecard";
import { termLabel } from "@/lib/terms";
import Breadcrumbs from "@/components/Breadcrumbs";
import PlanClient from "./PlanClient";

export const revalidate = 86400; // 1 day

// Plain-English, jargon-free description of what each credential is. Coarse on
// purpose (robust to AA/AS/AAS catalog quirks) — the goal is a first-gen
// student understanding "what am I looking at", not a precise taxonomy.
const CREDENTIAL_BLURB: Record<string, string> = {
  AS: "An associate degree — designed to transfer to a 4-year school. About 2 years full-time.",
  AA: "An associate degree — designed to transfer to a 4-year school. About 2 years full-time.",
  AAS: "An applied associate degree — built to start a career. About 2 years full-time.",
  certificate: "A certificate — a shorter, focused credential (less than a full degree).",
  diploma: "A diploma — a focused, career-oriented credential.",
};

/** Prefer the credential token embedded in the catalog title; fall back to the
 *  structured field. AAS is checked before AS so "...AAS" isn't read as "AS". */
function resolveCredential(title: string, credential: string): string {
  const t = title.toUpperCase();
  if (/\bAAS\b/.test(t)) return "AAS";
  if (/\bAS\b/.test(t)) return "AS";
  if (/\bAA\b/.test(t)) return "AA";
  if (/certificate/i.test(title)) return "certificate";
  if (/diploma/i.test(title)) return "diploma";
  return credential;
}
export const dynamicParams = true;

// REQUIRED for ISR. Next 16: "You must always return an array from
// generateStaticParams, even if it's empty. Otherwise, the route will be
// dynamically rendered." (node_modules/next/dist/docs/.../generate-static-params.md).
// Returning [] prerenders nothing at build but makes every program page
// statically render + edge-cache on first visit (revalidate above). Without
// this export the route is fully dynamic — uncached Supabase fetches inside
// buildMajorPlan force `cache-control: no-store` and ISR never engages, so
// every visitor pays the full render. The college page does the same thing.
// See issue #1137 (the unstable_cache wrap in #1098 caches the *data* but
// could not make the *route* static — only this can).
export function generateStaticParams() {
  return [];
}

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
  if (!plan) {
    // The exact slug didn't resolve. It may be a legacy URL minted before a
    // re-scrape reformatted the program title (which changes programSlug).
    // Recover SEO/bookmark equity by redirecting to the current canonical slug
    // when we can unambiguously identify the program; otherwise 404.
    const canonical = await resolveCanonicalProgramSlug(state, id, slug).catch(() => null);
    if (canonical) redirect(`/${state}/college/${id}/program/${canonical}`);
    notFound();
  }

  const collegeHref = `/${state}/college/${id}`;
  const transferHref = `/${state}/transfer`;

  // Plain-language credential help. The catalog title is the more reliable
  // signal (e.g. GA titles embed "...AAS" while the credential field may say
  // "AS"), so read the token from the title first, then fall back to the field.
  const credentialBlurb = CREDENTIAL_BLURB[resolveCredential(plan.program.title, plan.program.credential)] ?? "";

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

      <header className="mb-5 mt-4">
        <p className="text-sm font-medium uppercase tracking-wide text-blue-600 dark:text-blue-400">
          Your plan for this degree
        </p>
        <h1 className="mt-1 text-2xl font-bold text-gray-900 dark:text-slate-100 sm:text-3xl">
          {plan.program.title}
        </h1>
        <p className="mt-1 text-gray-600 dark:text-slate-300">
          at{" "}
          <a href={collegeHref} className="text-blue-600 dark:text-blue-400 underline">
            {plan.collegeName}
          </a>
          {plan.program.totalCredits ? ` · ${plan.program.totalCredits} credits` : ""}
        </p>
        {credentialBlurb && (
          <p className="mt-2 text-sm text-gray-500 dark:text-slate-400">{credentialBlurb}</p>
        )}
        <p className="mt-3 rounded-md bg-blue-50 dark:bg-blue-950/30 px-3 py-2 text-sm text-gray-700 dark:text-slate-300">
          Every course this degree needs — pick the school you want to transfer to and
          see which ones count there, plus what&apos;s open to register for now
          {plan.term ? ` (${termLabel(plan.term)})` : ""}.
        </p>
        {plan.program.catalogUrl && (
          <p className="mt-2 text-xs text-gray-400 dark:text-slate-500">
            <a href={plan.program.catalogUrl} className="underline" rel="nofollow">
              See the official catalog →
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
          <p className="mt-3 text-[10px] text-gray-400 dark:text-slate-500">
            Source: federal College Scorecard ({sc!.fetchedAt ? new Date(sc!.fetchedAt).getFullYear() : "recent"}).
            {" "}College-wide — not specific to this program.
          </p>
        </section>
      )}

      <PlanClient plan={plan} transferHref={transferHref} />
    </main>
  );
}

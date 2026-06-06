/**
 * Programs / majors hub page. e.g. `/va/program/nursing` lists every VCCS
 * college offering ≥5 sections in nursing-program prefixes (NUR, NURS, NSG,
 * RNS, ADN). Targets queries like "nursing programs Virginia community
 * college".
 *
 * Threshold-gated to avoid thin pSEO — see `qualifies()` in lib/programs.
 * ISR: 7 days, same as subject/course pages. Sitemap (programs partition)
 * lists only qualifying (state, program) pairs.
 */

import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getAllStates, isValidState } from "@/lib/states/registry";
import { requireStateConfig } from "@/lib/states/route-helpers";
import { getCurrentTerm, termLabel } from "@/lib/terms";
import {
  loadProgramData,
  qualifies,
  getProgramBySlug,
  PROGRAMS,
} from "@/lib/programs";
import { loadStateSummary } from "@/lib/state-summary";
import { loadProgramAcrossColleges, checkCourseAvailability } from "@/lib/programs/requirements";
import { countRealCourses, programSlug, PLAN_MIN_COURSES } from "@/lib/programs/plan-shared";
import { computeCourseAvailabilityProfile } from "@/lib/course-stats";
import SectionHeading from "@/components/SectionHeading";
import Breadcrumbs from "@/components/Breadcrumbs";
import ProgramRequirements from "@/components/ProgramRequirements";
import {
  getProgramLastUpdated,
  formatLastUpdated,
} from "@/lib/data-freshness";
import {
  getScorecardProgramForCips,
  formatDollar,
  type ScorecardProgramRecord,
} from "@/lib/scorecard";
import { PROGRAM_COPY } from "@/lib/programs/copy";
import {
  getStateSocStats,
  getApproxNationalMedian,
  getBlsReportingYear,
} from "@/lib/bls";

export const revalidate = 604800; // 7 days

type PageProps = {
  params: Promise<{ state: string; slug: string }>;
};

// Generate on-demand via ISR. Previously prerendered every (state,
// qualifying-program) pair, calling getQualifyingProgramSlugs() which runs
// multiple Supabase subject queries per state. As the courses table grew
// this work blew past Vercel's build memory ceiling (observed OOM during
// the 2026-05-26 deploy). Non-qualifying programs will still soft-404 at
// runtime via the page body's qualifies() guard.
export const dynamicParams = true;

export async function generateStaticParams() {
  return [];
}

function siteUrl() {
  return (
    process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com"
  );
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const { state, slug } = await props.params;
  if (!isValidState(state)) return { title: "Not Found" };
  const program = getProgramBySlug(slug);
  if (!program) return { title: "Not Found" };

  const config = requireStateConfig(state);
  const data = await loadProgramData(state, slug);
  if (!data || !qualifies(data)) return { title: "Not Found" };

  const term = await getCurrentTerm(state);
  const title = `${program.name} Programs at ${config.name} Community Colleges`;
  const description = `${data.totalColleges} ${config.systemName} colleges offer ${program.name.toLowerCase()} coursework — ${data.totalSections} sections across ${data.totalUniqueCourses} courses for ${termLabel(term)}. Compare colleges and transfer options.`;
  const canonical = `${siteUrl()}/${state}/program/${slug}`;

  return {
    title,
    description,
    keywords: [
      `${program.name.toLowerCase()} programs ${config.name}`,
      `${program.name.toLowerCase()} community college ${config.name}`,
      `${config.systemName} ${program.name.toLowerCase()}`,
      `${program.name.toLowerCase()} degree ${config.name}`,
      ...config.branding.metaKeywords,
    ],
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

export default async function ProgramPage(props: PageProps) {
  const { state, slug } = await props.params;
  if (!isValidState(state)) notFound();
  const program = getProgramBySlug(slug);
  if (!program) notFound();

  const data = await loadProgramData(state, slug);
  if (!data || !qualifies(data)) notFound();

  const config = requireStateConfig(state);
  const [term, requirementEntries] = await Promise.all([
    getCurrentTerm(state),
    loadProgramAcrossColleges(state, slug),
  ]);

  const availabilityByCollege: Record<string, Record<string, number>> = {};
  if (requirementEntries.length > 0) {
    const results = await Promise.all(
      requirementEntries.map(async ({ college, programs }) => {
        const avMap = await checkCourseAvailability(state, college.college_slug, term, programs);
        return [college.college_slug, Object.fromEntries(avMap)] as const;
      }),
    );
    for (const [slug, av] of results) {
      availabilityByCollege[slug] = av;
    }
  }

  // Map each college (by institution id) to the slug of its best plannable
  // program for this category, so the table can link straight to a real plan.
  // Prefer a transfer-oriented degree (AS/AA/AAS) over a certificate.
  const planSlugByCollegeId = new Map<string, string>();
  for (const { college, programs } of requirementEntries) {
    const plannable = programs.filter((p) => countRealCourses(p) >= PLAN_MIN_COURSES);
    if (plannable.length === 0) continue;
    const best =
      plannable.find((p) => ["AS", "AA", "AAS"].includes(p.credential)) ?? plannable[0];
    planSlugByCollegeId.set(college.id, programSlug(best));
  }

  const url = siteUrl();
  const lastUpdated = getProgramLastUpdated(state);

  // Per-college Scorecard program outcomes for the CIP codes this program
  // maps to. Many entries will be null (no Scorecard data, or unitid not
  // mapped, or all relevant CIPs suppressed at that school).
  const outcomesByCollege: Record<string, ScorecardProgramRecord | null> = {};
  if (program.cips.length > 0) {
    for (const c of data.colleges) {
      outcomesByCollege[c.collegeCode] = getScorecardProgramForCips(
        state,
        c.collegeId,
        program.cips,
      );
    }
  }
  // National benchmark — same for every college, so grab the first
  // non-null we see. Used as a fallback in the summary when no college
  // has school-specific earnings populated.
  const nationalBenchmark: ScorecardProgramRecord | null = (() => {
    for (const c of data.colleges) {
      const r = outcomesByCollege[c.collegeCode];
      if (r?.earnings4YrMedianNational != null) return r;
    }
    return null;
  })();
  const collegesWithEarnings = data.colleges
    .map((c) => ({ college: c, outcomes: outcomesByCollege[c.collegeCode] }))
    .filter(
      (x): x is { college: typeof data.colleges[number]; outcomes: ScorecardProgramRecord } =>
        x.outcomes != null &&
        (x.outcomes.earnings5YrMedian != null ||
          x.outcomes.earnings1YrMedian != null),
    );

  // A program only has outcomes worth a table column if at least one college
  // actually reports awards or earnings. Transfer-academic programs (Psychology,
  // Liberal Arts…) have CIP codes but community colleges don't award the degree
  // (students transfer first), so every Awards/Earnings cell is "—". Gate the
  // columns on real data and reframe to the transfer pathway instead of showing
  // a wall of dashes that reads as "broken" / "this major earns nothing".
  const hasOutcomes = data.colleges.some((c) => {
    const o = outcomesByCollege[c.collegeCode];
    return (
      (o?.awardsLevel1 ?? 0) + (o?.awardsLevel2 ?? 0) > 0 ||
      o?.earnings5YrMedian != null ||
      o?.earnings1YrMedian != null
    );
  });

  const itemListLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "@id": `${url}/${state}/program/${slug}#itemlist`,
    name: `${program.name} programs at ${config.name} community colleges`,
    description: data.program.description,
    numberOfItems: data.colleges.length,
    url: `${url}/${state}/program/${slug}`,
    // Connect to the site-wide WebSite/Organization graph from the root
    // layout so Google sees this program list as part of the site.
    isPartOf: { "@id": `${url}/#website` },
    ...(lastUpdated && { dateModified: lastUpdated.toISOString() }),
    itemListElement: data.colleges.slice(0, 25).map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "CollegeOrUniversity",
        name: c.collegeName,
        url: `${url}/${state}/college/${c.collegeId}`,
      },
    })),
  };

  // Program Availability Snapshot — server-rendered substantive content
  // pulled from the same flatSections that loadProgramData has already
  // aggregated. Same helper used by /[state]/course/[code] for consistency.
  const programProfile = computeCourseAvailabilityProfile(data.flatSections);

  // Other programs offered in this state (for cross-linking footer)
  const otherProgramSlugs = PROGRAMS.filter((p) => p.slug !== slug).map(
    (p) => p.slug
  );

  // Per-program content depth: intro paragraphs + FAQ (issue #413 #6).
  // Template tokens {stateName}, {systemName}, {totalColleges},
  // {totalSections} get interpolated. Programs without copy entries
  // (none currently, but defensive) skip the intro/FAQ sections.
  const copy = PROGRAM_COPY[slug];
  const renderTemplate = (s: string): string =>
    s
      .replace(/\{stateName\}/g, config.name)
      .replace(/\{systemName\}/g, config.systemName)
      .replace(/\{totalColleges\}/g, String(data.totalColleges))
      .replace(/\{totalSections\}/g, String(data.totalSections));

  // BLS career-outlook data: state-level median wage + a derived national
  // benchmark. Both can be null (no BLS file, suppressed cohort, or
  // transfer-track program with no `primarySoc`). The Career Outlook
  // section renders only when at least one of them populates.
  const blsStats = program.primarySoc
    ? getStateSocStats(state, program.primarySoc)
    : null;
  const blsNationalMedian = program.primarySoc
    ? getApproxNationalMedian(program.primarySoc)
    : null;
  const blsYear = getBlsReportingYear();

  // Cross-state nav (#413): same program in every other state where it
  // qualifies. Builds a topic cluster — both for student comparison
  // (\"how does nursing in NC stack up vs VA, SC, GA?\") and for SEO
  // link equity flowing through topically-related pages.
  //
  // Read each state's qualifying-program list from its precomputed summary
  // manifest (#946) — a synchronous file read — rather than calling
  // getQualifyingProgramSlugs() live for all ~48 other states. The live path
  // ran paginated `courses` subject queries for every program in every state
  // on each render; on a cold serverless instance (empty in-memory cache)
  // that fan-out blew past the function timeout and 504'd the whole page.
  // States without a manifest yet are simply omitted from this footer.
  const otherStatesWithThisProgram = getAllStates()
    .filter((s) => s.slug !== state)
    .filter((s) => loadStateSummary(s.slug)?.programSlugs.includes(slug))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListLd) }}
      />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Breadcrumbs
          siteUrl={url}
          items={[
            { name: "Home", href: "/" },
            { name: config.name, href: `/${state}` },
            { name: "Programs", href: `/${state}` },
            {
              name: program.name,
              href: `/${state}/program/${slug}`,
            },
          ]}
        />

        <header className="mb-8">
          <p className="text-sm font-medium text-teal-600 dark:text-teal-400 mb-1">
            {config.name} Community Colleges
          </p>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-slate-100">
            {program.name} Programs
          </h1>
          <p className="text-gray-600 dark:text-slate-400 mt-3 leading-relaxed">
            {program.description}
          </p>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-3">
            {data.totalColleges}{" "}
            {data.totalColleges === 1 ? "college" : "colleges"} &middot;{" "}
            {data.totalSections} sections &middot; {data.totalUniqueCourses}{" "}
            unique courses &middot; {termLabel(term)}
            {lastUpdated && (
              <> &middot; {formatLastUpdated(lastUpdated)}</>
            )}
          </p>
        </header>

        {copy && (
          <section className="mb-10 prose prose-sm max-w-none dark:prose-invert prose-p:text-gray-700 dark:prose-p:text-slate-300">
            <p>{renderTemplate(copy.intro[0])}</p>
            <p>{renderTemplate(copy.intro[1])}</p>
          </section>
        )}

        {(collegesWithEarnings.length > 0 || nationalBenchmark != null) && (
          <section className="mb-10 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
            <SectionHeading
              id="outcomes"
              className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-1"
            >
              Earnings &amp; outcomes for {program.name} graduates
            </SectionHeading>
            <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
              Federal College Scorecard data on what graduates of this program
              actually earn after completion. Where a school&rsquo;s cohort is
              too small to publish, we show the national benchmark for the
              same field of study.
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {nationalBenchmark?.earnings4YrMedianNational != null && (
                <div className="rounded-lg border border-gray-200 dark:border-slate-700 p-4">
                  <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">
                    National median (4 yrs after completion)
                  </div>
                  <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-slate-100">
                    {formatDollar(nationalBenchmark.earnings4YrMedianNational)}
                  </div>
                  {nationalBenchmark.earnings4YrP25National != null &&
                    nationalBenchmark.earnings4YrP75National != null && (
                      <div className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">
                        Range:{" "}
                        {formatDollar(nationalBenchmark.earnings4YrP25National)}
                        &thinsp;–&thinsp;
                        {formatDollar(nationalBenchmark.earnings4YrP75National)}
                      </div>
                    )}
                </div>
              )}
              {collegesWithEarnings.slice(0, 5).map(({ college, outcomes }) => (
                <div
                  key={college.collegeCode}
                  className="rounded-lg border border-gray-200 dark:border-slate-700 p-4"
                >
                  <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">
                    {college.collegeName} graduates
                  </div>
                  <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-slate-100">
                    {formatDollar(
                      outcomes.earnings5YrMedian ?? outcomes.earnings1YrMedian,
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">
                    {outcomes.earnings5YrMedian != null
                      ? "median, 5 yrs after completion"
                      : "median, 1 yr after completion"}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-gray-500 dark:text-slate-400">
              Source: U.S. Department of Education College Scorecard,
              per-program (4-digit CIP) data.{" "}
              {nationalBenchmark != null &&
                `CIP ${nationalBenchmark.cipCode} — ${nationalBenchmark.cipTitle}.`}{" "}
              School cohorts are suppressed by the federal source when fewer
              than ~30 completers in the reporting cohort.
            </p>
          </section>
        )}

        <section className="mb-10">
          <SectionHeading id="colleges" className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-1">
            Colleges offering {program.name}
          </SectionHeading>
          {planSlugByCollegeId.size > 0 && (
            <p className="mb-4 text-sm text-gray-600 dark:text-slate-400">
              Pick a college to see its full plan — every required course, which
              ones transfer to the school you want, and what&rsquo;s open now.
            </p>
          )}
          {!hasOutcomes && (
            <p className="mb-4 rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-900/20 px-3 py-2 text-sm text-teal-800 dark:text-teal-300">
              {program.name} is a transfer program — community colleges offer the
              coursework; you earn the degree, and its earnings, at a four-year
              university.{" "}
              <Link
                href={`/${state}/transfer`}
                className="font-medium underline hover:no-underline"
              >
                See where it transfers &rarr;
              </Link>
            </p>
          )}
          <div className="rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-900">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 dark:bg-slate-800 text-xs uppercase tracking-wider text-gray-500 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2.5 font-medium">College</th>
                  <th className="px-4 py-2.5 font-medium text-right">
                    Sections
                  </th>
                  <th className="px-4 py-2.5 font-medium text-right">Courses</th>
                  <th className="px-4 py-2.5 font-medium text-right">Online</th>
                  {hasOutcomes && (
                    <>
                      <th
                        className="px-4 py-2.5 font-medium text-right"
                        title="Annual program awards reported to IPEDS — sum of certificate + associate awards in the most recent year. A higher number suggests the program is more established at that college."
                      >
                        Awards/yr
                      </th>
                      <th
                        className="px-4 py-2.5 font-medium text-right"
                        title="Median earnings of completers 5 years after completion (federal Scorecard). '—' means the cohort was too small to publish."
                      >
                        5-yr earnings
                      </th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                {data.colleges.map((c) => {
                  const o = outcomesByCollege[c.collegeCode];
                  const awards =
                    (o?.awardsLevel1 ?? 0) + (o?.awardsLevel2 ?? 0);
                  return (
                    <tr
                      key={c.collegeCode}
                      className="hover:bg-gray-50 dark:hover:bg-slate-800"
                    >
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/${state}/college/${c.collegeId}`}
                          className="font-medium text-teal-600 dark:text-teal-400 hover:underline"
                        >
                          {c.collegeName}
                        </Link>
                        {planSlugByCollegeId.has(c.collegeId) && (
                          <div className="mt-0.5">
                            <Link
                              href={`/${state}/college/${c.collegeId}/program/${planSlugByCollegeId.get(c.collegeId)}`}
                              className="text-xs font-medium text-gray-500 dark:text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 hover:underline"
                            >
                              See the full plan &rarr;
                            </Link>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-900 dark:text-slate-100">
                        {c.sectionCount}
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-600 dark:text-slate-400">
                        {c.uniqueCourses}
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-600 dark:text-slate-400">
                        {c.onlineCount > 0 ? c.onlineCount : "—"}
                      </td>
                      {hasOutcomes && (
                        <>
                          <td className="px-4 py-2.5 text-right text-gray-600 dark:text-slate-400">
                            {awards > 0 ? awards : "—"}
                          </td>
                          <td className="px-4 py-2.5 text-right text-gray-900 dark:text-slate-100">
                            {o?.earnings5YrMedian != null
                              ? formatDollar(o.earnings5YrMedian)
                              : "—"}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Program Availability Snapshot — server-rendered substantive
            content per term. Helps long-tail SEO ("[program] online
            community college [state]", "[program] evening sections").
            Computed inline from data.flatSections — no extra I/O. */}
        {programProfile && programProfile.totalSections > 0 && (
          <section className="mb-10 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
            <SectionHeading id="availability" className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-1">
              {program.name} Availability Snapshot
            </SectionHeading>
            <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
              How {program.name.toLowerCase()} sections are being offered
              across {programProfile.collegeCount}{" "}
              {programProfile.collegeCount === 1 ? "college" : "colleges"} in{" "}
              {config.name} this term ({programProfile.totalSections}{" "}
              {programProfile.totalSections === 1 ? "section" : "sections"}{" "}
              total).
            </p>

            <div className="grid sm:grid-cols-2 gap-6">
              <div>
                <h3 className="text-sm font-medium text-gray-900 dark:text-slate-100 mb-2">
                  Delivery format
                </h3>
                <ul className="text-sm text-gray-700 dark:text-slate-300 space-y-1">
                  {Object.entries(programProfile.modes.counts)
                    .sort((a, b) => b[1] - a[1])
                    .map(([mode, count]) => (
                      <li key={mode} className="flex justify-between">
                        <span className="capitalize">
                          {mode.replace("-", " ")}
                        </span>
                        <span>
                          <span className="font-medium text-gray-900 dark:text-slate-100">
                            {count}
                          </span>{" "}
                          <span className="text-xs text-gray-500 dark:text-slate-400">
                            ({programProfile.modes.pcts[mode].toFixed(0)}%)
                          </span>
                        </span>
                      </li>
                    ))}
                </ul>
              </div>

              <div>
                <h3 className="text-sm font-medium text-gray-900 dark:text-slate-100 mb-2">
                  When sections meet
                </h3>
                <ul className="text-sm text-gray-700 dark:text-slate-300 space-y-1">
                  {programProfile.timeOfDay.morning > 0 && (
                    <li className="flex justify-between">
                      <span>Morning (before noon)</span>
                      <span className="font-medium text-gray-900 dark:text-slate-100">
                        {programProfile.timeOfDay.morning}
                      </span>
                    </li>
                  )}
                  {programProfile.timeOfDay.afternoon > 0 && (
                    <li className="flex justify-between">
                      <span>Afternoon (noon&ndash;5 PM)</span>
                      <span className="font-medium text-gray-900 dark:text-slate-100">
                        {programProfile.timeOfDay.afternoon}
                      </span>
                    </li>
                  )}
                  {programProfile.timeOfDay.evening > 0 && (
                    <li className="flex justify-between">
                      <span>Evening (5 PM and after)</span>
                      <span className="font-medium text-gray-900 dark:text-slate-100">
                        {programProfile.timeOfDay.evening}
                      </span>
                    </li>
                  )}
                  {programProfile.timeOfDay.asynchronous > 0 && (
                    <li className="flex justify-between">
                      <span>Asynchronous / TBA</span>
                      <span className="font-medium text-gray-900 dark:text-slate-100">
                        {programProfile.timeOfDay.asynchronous}
                      </span>
                    </li>
                  )}
                </ul>
              </div>
            </div>

            {(programProfile.startDates.distinct > 0 ||
              programProfile.instructorCount > 0) && (
              <div className="mt-6 pt-4 border-t border-gray-100 dark:border-slate-700 grid sm:grid-cols-2 gap-6 text-sm">
                {programProfile.startDates.distinct > 0 && (
                  <div>
                    <h3 className="font-medium text-gray-900 dark:text-slate-100 mb-1">
                      Start dates
                    </h3>
                    <p className="text-gray-700 dark:text-slate-300">
                      Sections begin on{" "}
                      <span className="font-medium text-gray-900 dark:text-slate-100">
                        {programProfile.startDates.distinct}
                      </span>{" "}
                      distinct date
                      {programProfile.startDates.distinct === 1 ? "" : "s"}.
                      {programProfile.startDates.lateStartCount > 0 && (
                        <>
                          {" "}
                          <Link
                            href={`/${state}/starting-soon`}
                            className="font-medium text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300"
                          >
                            {programProfile.startDates.lateStartCount}{" "}
                            late-start
                          </Link>{" "}
                          more than two weeks after the term&apos;s earliest
                          start.
                        </>
                      )}
                    </p>
                  </div>
                )}
                {programProfile.instructorCount > 0 && (
                  <div>
                    <h3 className="font-medium text-gray-900 dark:text-slate-100 mb-1">
                      Instructor diversity
                    </h3>
                    <p className="text-gray-700 dark:text-slate-300">
                      Taught by{" "}
                      <span className="font-medium text-gray-900 dark:text-slate-100">
                        {programProfile.instructorCount}
                      </span>{" "}
                      distinct instructor
                      {programProfile.instructorCount === 1 ? "" : "s"} across{" "}
                      {programProfile.collegeCount}{" "}
                      {programProfile.collegeCount === 1
                        ? "college"
                        : "colleges"}
                      .
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        <ProgramRequirements
          state={state}
          entries={requirementEntries}
          availabilityByCollege={availabilityByCollege}
        />

        {data.sampleCourses.length > 0 && (
          <section className="mb-10">
            <SectionHeading id="common-courses" className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-4">
              Common {program.name} courses
            </SectionHeading>
            <ul className="grid sm:grid-cols-2 gap-2">
              {data.sampleCourses.map((c) => (
                <li key={`${c.prefix}-${c.number}`}>
                  <Link
                    href={`/${state}/course/${c.prefix.toLowerCase()}-${c.number.toLowerCase()}`}
                    className="block rounded-lg border border-gray-200 dark:border-slate-700 px-3 py-2 hover:border-teal-300 dark:hover:border-teal-600 transition"
                  >
                    <span className="font-mono text-sm font-medium text-teal-600 dark:text-teal-400">
                      {c.prefix} {c.number}
                    </span>
                    <span className="ml-2 text-sm text-gray-700 dark:text-slate-300">
                      {c.title}
                    </span>
                    <span className="ml-2 text-xs text-gray-500 dark:text-slate-400">
                      ({c.sectionCount}{" "}
                      {c.sectionCount === 1 ? "section" : "sections"})
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(blsStats?.medianAnnualWage != null ||
          blsNationalMedian != null) && (
          <section className="mb-10 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
            <h2
              id="career-outlook"
              className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-1"
            >
              Career outlook for {program.name} graduates
            </h2>
            <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
              Federal Bureau of Labor Statistics wage data for the primary
              career outcome of this program{blsYear ? ` (${blsYear} OEWS release)` : ""}.
              Compare {config.name}&rsquo;s typical pay to the national
              picture before choosing where to study.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {blsStats?.medianAnnualWage != null && (
                <div className="rounded-lg border border-gray-200 dark:border-slate-700 p-4">
                  <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">
                    {config.name} median wage
                  </div>
                  <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-slate-100">
                    {formatDollar(blsStats.medianAnnualWage)}
                  </div>
                  <div className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">
                    annual, all workers in occupation
                  </div>
                </div>
              )}
              {blsNationalMedian != null && (
                <div className="rounded-lg border border-gray-200 dark:border-slate-700 p-4">
                  <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">
                    Typical state median (national reference)
                  </div>
                  <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-slate-100">
                    {formatDollar(blsNationalMedian)}
                  </div>
                  <div className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">
                    median across covered states
                  </div>
                </div>
              )}
            </div>
            {blsStats?.medianAnnualWage != null &&
              blsNationalMedian != null && (
                <p className="mt-3 text-sm text-gray-600 dark:text-slate-300">
                  {(() => {
                    const diff =
                      blsStats.medianAnnualWage - blsNationalMedian;
                    const pct = Math.abs(
                      (diff / blsNationalMedian) * 100,
                    ).toFixed(0);
                    if (Math.abs(diff) < blsNationalMedian * 0.03)
                      return `${config.name}'s typical pay for this occupation is roughly in line with the national picture.`;
                    return diff > 0
                      ? `${config.name}'s typical pay is about ${pct}% above the typical state — a strong sign of healthy local demand.`
                      : `${config.name}'s typical pay is about ${pct}% below the typical state — common for lower cost-of-living states, but worth weighing against tuition savings.`;
                  })()}
                </p>
              )}
            <p className="mt-4 text-xs text-gray-500 dark:text-slate-400">
              Wage data reflects all workers in the occupation, not just
              recent CC graduates — entry-level pay is typically lower.
              Source: U.S. Bureau of Labor Statistics OEWS.
            </p>
          </section>
        )}

        {copy && copy.faq.length > 0 && (
          <section className="mb-10">
            <h2
              id="faq"
              className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-4"
            >
              Frequently asked questions
            </h2>
            <dl className="space-y-4">
              {copy.faq.map((qa, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5"
                >
                  <dt className="font-medium text-gray-900 dark:text-slate-100">
                    {renderTemplate(qa.q)}
                  </dt>
                  <dd className="mt-2 text-sm text-gray-700 dark:text-slate-300 leading-relaxed">
                    {renderTemplate(qa.a)}
                  </dd>
                </div>
              ))}
            </dl>
            <script
              type="application/ld+json"

              dangerouslySetInnerHTML={{
                __html: JSON.stringify({
                  "@context": "https://schema.org",
                  "@type": "FAQPage",
                  mainEntity: copy.faq.map((qa) => ({
                    "@type": "Question",
                    name: renderTemplate(qa.q),
                    acceptedAnswer: {
                      "@type": "Answer",
                      text: renderTemplate(qa.a),
                    },
                  })),
                }),
              }}
            />
          </section>
        )}

        {otherStatesWithThisProgram.length > 0 && (
          <section className="mb-10">
            <h2
              id="other-states"
              className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-1"
            >
              Compare {program.name} programs in other states
            </h2>
            <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
              Same comparison view, different state systems. Useful if
              you&rsquo;re considering an out-of-state community college or
              just want to see how {config.name}&rsquo;s {program.name.toLowerCase()}{" "}
              programs stack up.
            </p>
            <div className="flex flex-wrap gap-2">
              {otherStatesWithThisProgram.map((s) => (
                <Link
                  key={s.slug}
                  href={`/${s.slug}/program/${slug}`}
                  className="rounded-full border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1 text-sm text-gray-700 dark:text-slate-300 hover:border-teal-300 dark:hover:border-teal-600 hover:text-teal-700 dark:hover:text-teal-400 transition"
                >
                  {program.name} in {s.name}
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="mb-10">
          <SectionHeading id="other-programs" className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-4">
            Other programs in {config.name}
          </SectionHeading>
          <div className="flex flex-wrap gap-2">
            {otherProgramSlugs.map((s) => {
              const p = getProgramBySlug(s)!;
              return (
                <Link
                  key={s}
                  href={`/${state}/program/${s}`}
                  className="rounded-full border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1 text-sm text-gray-700 dark:text-slate-300 hover:border-teal-300 dark:hover:border-teal-600 transition"
                >
                  {p.name}
                </Link>
              );
            })}
          </div>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-2">
            Some programs may not be offered at every college — pages render
            only when the program meets a coverage threshold for the state.
          </p>
        </section>
      </div>
    </>
  );
}


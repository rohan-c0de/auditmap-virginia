import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import SearchForm from "@/components/SearchForm";
import StartingSoonCallout from "@/components/StartingSoonCallout";
import NotifyBanner from "@/components/NotifyBanner";
import AccountPromo from "@/components/auth/AccountPromo";
import StateContext from "@/components/StateContext";
import { getCurrentTerm, getNextTerm } from "@/lib/terms";
import { getAllStates, hasPrereqsCoverage, isValidState } from "@/lib/states/registry";
import { requireStateConfig } from "@/lib/states/route-helpers";
import { getArticlesByState, getStateTopicLinks, categoryLabel } from "@/lib/blog";
import { getQualifyingProgramSlugs, getProgramBySlug } from "@/lib/programs";
import { loadOnlineData, onlineQualifies } from "@/lib/online";
import { loadStateSummary } from "@/lib/state-summary";

type Props = {
  params: Promise<{ state: string }>;
};

// Skip build-time pre-rendering. Even after snapshotizing
// StartingSoonCallout, StateContext, getCourseCount, and the
// college-subjects sitemap rollup, the per-state page still tripped
// Vercel's 60s static-gen budget on big states (VA, ME, …) because of
// transitive Supabase calls inside the programs/online hubs that
// `loadStateSummary` falls back to. Rendering on-demand sidesteps the
// build-time pressure entirely — first hit after deploy renders the page
// fresh (~1–3 s), subsequent hits within the cache window are served
// from the CDN.
//
// Invalid state slugs fall through to the existing `notFound()` check
// below. With `force-dynamic` there's no ISR cache to convert that into
// a soft-404 (the previous `dynamicParams = false` workaround for issue
// #337 is no longer needed).
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { state } = await params;
  if (!isValidState(state)) return { title: "Not Found" };
  const config = requireStateConfig(state);
  const b = config.branding;
  return {
    title: `${config.name} Community College Course Finder`,
    description: `Search courses, check transfer equivalencies, find late-start sections, and compare ${config.collegeCount} ${config.name} community colleges. ${b.tagline}`,
    keywords: b.metaKeywords,
    alternates: { canonical: `/${state}` },
  };
}

export default async function HomePage({ params }: Props) {
  const { state } = await params;
  if (!isValidState(state)) notFound();
  const config = requireStateConfig(state);
  const nextTerm = await getNextTerm(state);
  // Used by <StateContext> to compute statewide insights against the current
  // term's data — safe to fail through to no insights, since the renderer
  // skips when fewer than 2 sentences qualify.
  const currentTerm = await getCurrentTerm(state).catch(() => null);
  const stateArticles = getArticlesByState(state);
  const topicLinks = getStateTopicLinks(state);
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com";

  // Phase 4 hub links — only surfaced when underlying pages would render.
  // #946: prefer the precomputed summary manifest so the build does no heavy
  // data loading. Fall back to the live loaders when the manifest is absent
  // (e.g. a brand-new state before the precompute step has run) so behavior is
  // never worse than before. Both loaders are non-fatal (section just hides).
  const summary = loadStateSummary(state);
  let programSlugs: string[];
  let showOnline: boolean;
  let onlineSections: number;
  let onlineColleges: number;
  if (summary) {
    programSlugs = summary.programSlugs;
    showOnline = summary.showOnline;
    onlineSections = summary.onlineSections;
    onlineColleges = summary.onlineColleges;
  } else {
    const [slugs, onlineData] = await Promise.all([
      getQualifyingProgramSlugs(state).catch(() => [] as string[]),
      loadOnlineData(state).catch(() => null),
    ]);
    programSlugs = slugs;
    showOnline = onlineQualifies(onlineData);
    onlineSections = onlineData?.totalSections ?? 0;
    onlineColleges = onlineData?.totalColleges ?? 0;
  }

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
      {
        "@type": "ListItem",
        position: 2,
        name: config.name,
        item: `${siteUrl}/${state}`,
      },
    ],
  };

  // WebPage + SearchAction. Tells Google that this state landing is a
  // searchable surface (the course-search hero is the entry point) and
  // ties it back to the site-wide WebSite/Organization entities declared
  // in the root layout via @id references.
  const webPageLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${siteUrl}/${state}#webpage`,
    url: `${siteUrl}/${state}`,
    name: `${config.name} Community College Course Finder`,
    description: config.branding.tagline,
    isPartOf: { "@id": `${siteUrl}/#website` },
    about: { "@id": `${siteUrl}/#organization` },
    breadcrumb: { "@id": `${siteUrl}/${state}#breadcrumb` },
    primaryImageOfPage: { "@type": "ImageObject", url: `${siteUrl}/${state}/opengraph-image` },
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${siteUrl}/${state}/courses?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };

  return (
    <div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageLd) }}
      />
      {/* Search section */}
      <section id="search" className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto text-center">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-slate-100 mb-4">
            Find {config.name} Community College Courses
          </h1>
          <p className="text-lg text-gray-600 dark:text-slate-400 mb-8">
            Search by zip code to find nearby {config.name} community colleges,
            browse courses, check transfer equivalencies, and build your
            schedule.
          </p>
          <SearchForm
            state={state}
            placeholder={`e.g. ${config.defaultZip} or ${config.defaultZipCity}`}
          />
          <StartingSoonCallout state={state} />
        </div>

        {/* "Help me choose" entry point — only when programs qualify (so the
            quiz always has content; same gate as Browse by Program below). */}
        {programSlugs.length > 0 && (
          <div className="max-w-2xl mx-auto mt-8">
            <Link
              href={`/${state}/choose`}
              className="group flex items-center gap-4 rounded-2xl border border-teal-200 dark:border-teal-800 bg-gradient-to-br from-teal-50 to-white dark:from-teal-900/30 dark:to-slate-900 px-5 py-4 transition-all hover:-translate-y-0.5 hover:shadow-md"
            >
              <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-teal-600 text-white">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z" />
                </svg>
              </span>
              <span className="min-w-0 text-left">
                <span className="block font-semibold text-gray-900 dark:text-slate-100">
                  Not sure what to study?
                </span>
                <span className="block text-sm text-gray-600 dark:text-slate-400">
                  Answer three quick questions and we&rsquo;ll point you to
                  programs that fit.
                </span>
              </span>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="ml-auto h-5 w-5 flex-shrink-0 text-teal-600 dark:text-teal-400 group-hover:translate-x-0.5 transition-transform"
                aria-hidden="true"
              >
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </Link>
          </div>
        )}
      </section>

      {/* How it works */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-gray-50 dark:bg-slate-800">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-slate-100 text-center mb-12">
            How It Works
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-12 h-12 bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300 rounded-full flex items-center justify-center mx-auto mb-4 text-xl font-bold">
                1
              </div>
              <h3 className="font-semibold text-gray-900 dark:text-slate-100 mb-2">
                Find a College
              </h3>
              <p className="text-gray-600 dark:text-slate-400 text-sm">
                Enter your zip code to find nearby community colleges. Browse
                courses, check transfer info, and compare schedules.
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300 rounded-full flex items-center justify-center mx-auto mb-4 text-xl font-bold">
                2
              </div>
              <h3 className="font-semibold text-gray-900 dark:text-slate-100 mb-2">
                Choose a Course
              </h3>
              <p className="text-gray-600 dark:text-slate-400 text-sm">
                Browse current course listings with schedules, locations, and
                delivery modes. Filter by subject, day, or format.
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300 rounded-full flex items-center justify-center mx-auto mb-4 text-xl font-bold">
                3
              </div>
              <h3 className="font-semibold text-gray-900 dark:text-slate-100 mb-2">
                Plan Your Path
              </h3>
              <p className="text-gray-600 dark:text-slate-400 text-sm">
                Check transfer equivalencies, build a weekly schedule, or find
                audit policies — all before you register.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Highlights — compact cards for key info */}
      <section className="py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto space-y-4">
          {/* Senior waiver — compact card */}
          {config.seniorWaiver && (
            <div className="flex items-start gap-4 rounded-xl border border-teal-200 dark:border-teal-800 bg-teal-50/50 dark:bg-teal-900/20 px-5 py-4">
              <div className="shrink-0 flex h-10 w-10 items-center justify-center rounded-full bg-teal-100 dark:bg-teal-900/50 text-teal-600 dark:text-teal-400 mt-0.5">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.438 60.438 0 00-.491 6.347A48.62 48.62 0 0112 20.904a48.62 48.62 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.636 50.636 0 00-2.658-.813A59.906 59.906 0 0112 3.493a59.903 59.903 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-teal-900 dark:text-teal-200">
                  {config.seniorWaiver.ageThreshold}+ in {config.name}? Tuition may be waived.
                </p>
                <p className="text-sm text-teal-800 dark:text-teal-300 mt-0.5">
                  {config.seniorWaiver.bannerDetail}
                </p>
                <Link
                  href={`/${state}/about`}
                  className="inline-block mt-1.5 text-xs font-medium text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 transition-colors"
                >
                  Learn more about the waiver &rarr;
                </Link>
              </div>
            </div>
          )}

          {/* Notify banner */}
          <NotifyBanner nextTerm={nextTerm.label} state={state} />

          {/* Logged-out growth CTA — browsing stays free; promotes saving only */}
          <AccountPromo className="mt-4" />
        </div>
      </section>

      {/* What you can do */}
      <section className="py-12 px-4 sm:px-6 lg:px-8 bg-gray-50 dark:bg-slate-800">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-slate-100 mb-8 text-center">
            What You Can Do
          </h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <Link
              href={`/${state}/courses`}
              className="group rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 transition hover:border-teal-300 dark:hover:border-teal-700 hover:shadow-sm"
            >
              <h3 className="font-semibold text-gray-900 dark:text-slate-100 group-hover:text-teal-600 transition-colors mb-1">
                Search All Courses
              </h3>
              <p className="text-sm text-gray-600 dark:text-slate-400">
                Search across all {config.collegeCount} {config.name} community colleges at once by subject, keyword, or course number.
              </p>
            </Link>
            {config.transferSupported && (
              <Link
                href={`/${state}/transfer`}
                className="group rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 transition hover:border-teal-300 dark:hover:border-teal-700 hover:shadow-sm"
              >
                <h3 className="font-semibold text-gray-900 dark:text-slate-100 group-hover:text-teal-600 transition-colors mb-1">
                  Transfer Lookup
                </h3>
                <p className="text-sm text-gray-600 dark:text-slate-400">
                  See how community college courses map to universities — direct match or elective credit — before you enroll.
                </p>
              </Link>
            )}
            <Link
              href={`/${state}/schedule`}
              className="group rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 transition hover:border-teal-300 dark:hover:border-teal-700 hover:shadow-sm"
            >
              <h3 className="font-semibold text-gray-900 dark:text-slate-100 group-hover:text-teal-600 transition-colors mb-1">
                Schedule Builder
              </h3>
              <p className="text-sm text-gray-600 dark:text-slate-400">
                Build a weekly schedule across multiple colleges and spot conflicts before you register.
              </p>
            </Link>
            {/* Degree-path planner card (PR after the sticky-loop sequence).
                Gated by prereq coverage — same condition as the header nav —
                so the link only appears when the planner has real data to
                map. Also acts as an internal link that helps the /[state]/plan
                page get indexed by Google. */}
            {hasPrereqsCoverage(state) && (
              <Link
                href={`/${state}/plan`}
                className="group rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 transition hover:border-teal-300 dark:hover:border-teal-700 hover:shadow-sm"
              >
                <h3 className="font-semibold text-gray-900 dark:text-slate-100 group-hover:text-teal-600 transition-colors mb-1">
                  Course Planner
                </h3>
                <p className="text-sm text-gray-600 dark:text-slate-400">
                  Pick courses you want to take and we&apos;ll sequence the prerequisites into semesters. Save your plan and we&apos;ll email you when seats open.
                </p>
              </Link>
            )}
            <Link
              href={`/${state}/colleges`}
              className="group rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 transition hover:border-teal-300 dark:hover:border-teal-700 hover:shadow-sm"
            >
              <h3 className="font-semibold text-gray-900 dark:text-slate-100 group-hover:text-teal-600 transition-colors mb-1">
                Browse All Colleges
              </h3>
              <p className="text-sm text-gray-600 dark:text-slate-400">
                View audit policies, senior waivers, course counts, and campus info for every {config.name} community college.
              </p>
            </Link>
            {showOnline && (
              <Link
                href={`/${state}/online`}
                className="group rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 transition hover:border-teal-300 dark:hover:border-teal-700 hover:shadow-sm"
              >
                <h3 className="font-semibold text-gray-900 dark:text-slate-100 group-hover:text-teal-600 transition-colors mb-1">
                  Online Courses
                </h3>
                <p className="text-sm text-gray-600 dark:text-slate-400">
                  {onlineSections} online sections across {onlineColleges} {config.name} community colleges this term.
                </p>
              </Link>
            )}
          </div>
          <p className="text-center text-sm text-gray-500 dark:text-slate-400 mt-6">
            Or{" "}
            <Link
              href="/colleges"
              className="text-teal-600 hover:text-teal-700 transition-colors"
            >
              browse colleges in all {getAllStates().length} states
            </Link>
          </p>
        </div>
      </section>

      {/* At-a-glance — data-grounded editorial paragraphs about the state's
          CC system. Renders nothing when fewer than 2 sentences qualify. */}
      <StateContext
        state={state}
        stateName={config.name}
        systemName={config.systemName}
        term={currentTerm}
        seniorWaiver={
          config.seniorWaiver
            ? {
                ageThreshold: config.seniorWaiver.ageThreshold,
                legalCitation: config.seniorWaiver.legalCitation,
                bannerDetail: config.seniorWaiver.bannerDetail,
              }
            : null
        }
      />

      {/* Browse by program — only when at least one program qualifies */}
      {programSlugs.length > 0 && (
        <section className="py-12 px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-slate-100 mb-2 text-center">
              Browse by Program
            </h2>
            <p className="text-center text-sm text-gray-600 dark:text-slate-400 mb-8">
              Compare {config.name} community colleges by major. Each page lists every college offering coursework in the program.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {programSlugs.map((slug) => {
                const program = getProgramBySlug(slug);
                if (!program) return null;
                return (
                  <Link
                    key={slug}
                    href={`/${state}/program/${slug}`}
                    className="rounded-full border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-1.5 text-sm text-gray-700 dark:text-slate-300 hover:border-teal-300 dark:hover:border-teal-600 hover:text-teal-700 dark:hover:text-teal-400 transition-colors"
                  >
                    {program.name}
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Topics hub — one card per state-level cluster spoke */}
      {topicLinks.length > 0 && (
        <section className="py-12 px-4 sm:px-6 lg:px-8 bg-gray-50 dark:bg-slate-800">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-slate-100 mb-2 text-center">
              What We Cover for {config.name}
            </h2>
            <p className="text-center text-sm text-gray-600 dark:text-slate-400 mb-8">
              Data-driven guides built from {config.systemName} course records.
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {topicLinks.map(({ cluster, title, blurb, article }) => (
                <Link
                  key={cluster}
                  href={`/blog/${article.slug}`}
                  className="group rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 transition hover:border-teal-300 dark:hover:border-teal-700 hover:shadow-sm"
                >
                  <h3 className="font-semibold text-gray-900 dark:text-slate-100 group-hover:text-teal-600 transition-colors">
                    {title}
                  </h3>
                  <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
                    {blurb}
                  </p>
                  <span className="mt-3 inline-block text-xs font-medium text-teal-600 dark:text-teal-400 group-hover:text-teal-700 dark:group-hover:text-teal-300 transition-colors">
                    Read the guide &rarr;
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Related guides — all blog posts tagged for this state */}
      {stateArticles.length > 0 && (
        <section className="py-12 px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-slate-100 mb-2 text-center">
              {config.name} Guides
            </h2>
            <p className="text-center text-sm text-gray-600 dark:text-slate-400 mb-8">
              Plain-English explainers for {config.name} students.
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              {stateArticles.map((article) => (
                <Link
                  key={article.slug}
                  href={`/blog/${article.slug}`}
                  className="group rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 transition hover:border-teal-300 dark:hover:border-teal-700 hover:shadow-sm"
                >
                  <span className="inline-block rounded-full bg-gray-100 dark:bg-slate-700 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:text-slate-400">
                    {categoryLabel(article.category)}
                  </span>
                  <h3 className="mt-2 font-semibold text-gray-900 dark:text-slate-100 group-hover:text-teal-600 transition-colors">
                    {article.title}
                  </h3>
                  <p className="mt-1 text-sm text-gray-600 dark:text-slate-400 line-clamp-2">
                    {article.description}
                  </p>
                </Link>
              ))}
            </div>
            <p className="text-center text-sm text-gray-500 dark:text-slate-400 mt-6">
              <Link
                href="/blog"
                className="text-teal-600 hover:text-teal-700 transition-colors"
              >
                Browse all guides &rarr;
              </Link>
            </p>
          </div>
        </section>
      )}

      {/* Explore other states */}
      <section className="py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-4 text-center">
            Explore Other States
          </h2>
          <div className="flex flex-wrap justify-center gap-2">
            {getAllStates()
              .filter((s) => s.slug !== state)
              .map((s) => (
                <Link
                  key={s.slug}
                  href={`/${s.slug}`}
                  className="rounded-md bg-gray-100 dark:bg-slate-700 px-3 py-1.5 text-sm text-gray-700 dark:text-slate-300 hover:bg-teal-100 dark:hover:bg-teal-900/40 hover:text-teal-700 dark:hover:text-teal-400 transition-colors"
                >
                  {s.name}
                </Link>
              ))}
          </div>
        </div>
      </section>
    </div>
  );
}

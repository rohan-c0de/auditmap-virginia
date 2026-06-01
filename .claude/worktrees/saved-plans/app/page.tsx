import Link from "next/link";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { getAllStates } from "@/lib/states/registry";
import ThemeToggle from "@/components/ThemeToggle";
import UserMenu from "@/components/auth/UserMenu";
import CourseSearchHero from "@/components/CourseSearchHero";
import USMap from "@/components/USMap";

const STATE_NAMES = getAllStates().map((s) => s.name);
const STATE_LIST_SENTENCE =
  STATE_NAMES.length <= 1
    ? STATE_NAMES.join("")
    : `${STATE_NAMES.slice(0, -1).join(", ")}, and ${STATE_NAMES[STATE_NAMES.length - 1]}`;
const META_DESCRIPTION = `Search community college courses, transfer credits, and schedules across ${STATE_NAMES.length} states. Free, no signup.`;

export const metadata: Metadata = {
  title: "Community College Path — Find any community college course in one search",
  description: META_DESCRIPTION,
  keywords: [
    "community college courses",
    "CC course finder",
    "community college transfer",
    "schedule builder",
    "senior tuition waiver",
    "community college near me",
  ],
  openGraph: {
    title: "Community College Path — Course Finder & Transfer Guide",
    description: META_DESCRIPTION,
    type: "website",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "Community College Path — Course Finder & Transfer Guide",
    description: META_DESCRIPTION,
  },
  alternates: {
    canonical: "/",
  },
};

const GRID_BG_STYLE = {
  backgroundImage:
    "linear-gradient(rgba(13,148,136,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(13,148,136,0.06) 1px, transparent 1px)",
  backgroundSize: "32px 32px",
};

export default async function LandingPage() {
  const states = getAllStates();
  const totalColleges = states.reduce((sum, s) => sum + s.collegeCount, 0);
  const stateOptions = states
    .map((s) => ({ slug: s.slug, name: s.name, abbr: s.slug.toUpperCase() }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Vercel populates x-vercel-ip-country-region with the US state code (e.g. "VA").
  // Fall through to null in local dev or when the header is missing.
  const h = await headers();
  const region = h.get("x-vercel-ip-country-region")?.toLowerCase() ?? null;
  const country = h.get("x-vercel-ip-country") ?? null;
  const geoState =
    country === "US" && region && states.some((s) => s.slug === region)
      ? region
      : null;

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com";
  const orgLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Community College Path",
    url: siteUrl,
    logo: `${siteUrl}/icon`,
    description: `A free national community college course finder, transfer guide, and schedule builder covering ${STATE_LIST_SENTENCE}.`,
  };
  const websiteLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Community College Path",
    url: siteUrl,
    ...(geoState && {
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: `${siteUrl}/${geoState}/courses?q={search_term_string}`,
        },
        "query-input": "required name=search_term_string",
      },
    }),
  };

  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-slate-900">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteLd) }}
      />
      {/* Header */}
      <header className="border-b border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-9 h-9 bg-teal-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-mono font-semibold text-xs">CCP</span>
            </div>
            <span className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Community College <span className="text-teal-600">Path</span>
            </span>
          </Link>
          <nav className="flex items-center gap-5">
            <Link
              href="/colleges"
              className="hidden sm:inline text-sm text-slate-600 dark:text-slate-400 hover:text-teal-600 transition-colors"
            >
              All colleges
            </Link>
            <Link
              href="/blog"
              className="hidden sm:inline text-sm text-slate-600 dark:text-slate-400 hover:text-teal-600 transition-colors"
            >
              Blog
            </Link>
            <UserMenu />
            <ThemeToggle />
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden" style={GRID_BG_STYLE}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-20 sm:pt-24 sm:pb-28">
          <div className="text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-100 dark:bg-teal-900/40 text-teal-800 dark:text-teal-200 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em]">
              ✓ {totalColleges} colleges · {states.length} states · always free
            </span>
            <h1 className="mt-6 text-4xl sm:text-6xl lg:text-[64px] font-semibold leading-[1.05] tracking-[-0.025em] text-slate-900 dark:text-slate-100">
              Find any community college course in{" "}
              <span className="text-teal-600 dark:text-teal-400">one search.</span>
            </h1>
            <p className="mt-6 text-lg text-slate-600 dark:text-slate-400 max-w-2xl mx-auto">
              Search courses, look up transfer credits, and build a schedule —
              without bouncing between five state websites.
            </p>
          </div>

          <div className="mt-10 relative">
            <CourseSearchHero states={stateOptions} geoState={geoState} />
          </div>
        </div>
      </section>

      {/* Three task cards */}
      <section className="bg-slate-50 dark:bg-slate-800/40 border-y border-slate-200 dark:border-slate-800">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 mb-8">
            what you can do
          </div>
          <div className="grid sm:grid-cols-3 gap-4">
            {[
              {
                num: "01",
                title: "Search any course",
                body: "One search across every college in your state — by code, subject, or what you're trying to learn.",
                href: "/colleges",
                cta: "Start searching",
                icon: (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
                  />
                ),
              },
              {
                num: "02",
                title: "Check what transfers",
                body: "Pick your CC and your target university. See which courses count, which don't, and what they map to.",
                href: geoState ? `/${geoState}/transfer` : "/colleges",
                cta: "Look up transfers",
                icon: (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"
                  />
                ),
              },
              {
                num: "03",
                title: "Build a schedule",
                body: "Drag classes onto a weekly grid, see conflicts immediately, and export when you're ready to register.",
                href: geoState ? `/${geoState}/schedule` : "/colleges",
                cta: "Open the planner",
                icon: (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"
                  />
                ),
              },
            ].map((card) => (
              <Link
                key={card.num}
                href={card.href}
                className="group rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 hover:border-teal-300 dark:hover:border-teal-700 hover:shadow-md transition-all"
              >
                <div className="flex items-center justify-between">
                  <div className="w-11 h-11 rounded-xl bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 flex items-center justify-center">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                      {card.icon}
                    </svg>
                  </div>
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                    {card.num}
                  </span>
                </div>
                <h3 className="mt-5 text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {card.title}
                </h3>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                  {card.body}
                </p>
                <span className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-teal-700 dark:text-teal-400 group-hover:gap-2 transition-all">
                  {card.cta}
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                  </svg>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Browse by state — US map + pill fallback */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 w-full">
        <div className="flex items-center justify-between mb-6">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            browse by state
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-teal-500" />
              {states.length} live
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-slate-300 dark:bg-slate-700" />
              coming soon
            </span>
            <span className="text-slate-400 dark:text-slate-600">·</span>
            <span>{totalColleges} colleges total</span>
          </div>
        </div>

        <USMap />

        <details className="mt-6 group">
          <summary className="cursor-pointer text-sm text-slate-600 dark:text-slate-400 hover:text-teal-600 select-none inline-flex items-center gap-1">
            <span className="group-open:hidden">or see all {states.length} as a list</span>
            <span className="hidden group-open:inline">hide list</span>
            <svg className="w-3 h-3 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </summary>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
            {[...states]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((s) => (
                <Link
                  key={s.slug}
                  href={`/${s.slug}`}
                  className="group rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 hover:border-teal-300 dark:hover:border-teal-700 hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-all"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500 group-hover:text-teal-600">
                      {s.slug}
                    </span>
                    <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                      {s.name}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {s.collegeCount} colleges
                  </div>
                </Link>
              ))}
          </div>
        </details>
      </section>

      {/* Why this exists */}
      <section className="bg-slate-900 dark:bg-black text-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-16">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-teal-300 mb-5">
                why this exists
              </div>
              <h2 className="text-3xl sm:text-4xl font-semibold leading-tight tracking-[-0.02em]">
                The system wasn&apos;t built to be navigated.
              </h2>
            </div>
            <div className="space-y-5 text-slate-300 leading-relaxed">
              <p>
                Every college runs its own portal, with its own login, its own
                course numbers, and its own rules about what transfers to which
                four-year. If you&apos;re trying to compare colleges or figure
                out which classes will actually count toward a degree at the
                university you want to transfer to — you end up with five tabs
                open and a spreadsheet.
              </p>
              <p>
                Community College Path pulls all of it into one place. Free, no
                account required, refreshed weekly straight from each college&apos;s
                registrar.
              </p>
              <div className="grid grid-cols-3 gap-6 pt-6 border-t border-slate-800">
                <div>
                  <div className="text-3xl font-semibold text-teal-300">
                    {totalColleges}
                  </div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400 mt-1">
                    colleges
                  </div>
                </div>
                <div>
                  <div className="text-3xl font-semibold text-teal-300">
                    {states.length}
                  </div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400 mt-1">
                    states
                  </div>
                </div>
                <div>
                  <div className="text-3xl font-semibold text-teal-300">weekly</div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400 mt-1">
                    data refresh
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Header from "@/components/Header";
import { hasPrereqsCoverage, isValidState } from "@/lib/states/registry";
import { requireStateConfig } from "@/lib/states/route-helpers";
type Props = {
  children: React.ReactNode;
  params: Promise<{ state: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { state } = await params;
  if (!isValidState(state)) return {};
  const config = requireStateConfig(state);
  const b = config.branding;

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com";

  return {
    title: `${b.siteName} — Community College Course Finder`,
    description: b.tagline,
    keywords: b.metaKeywords,
    openGraph: {
      title: b.siteName,
      description: b.tagline,
      siteName: b.siteName,
      type: "website",
      locale: "en_US",
      url: `${baseUrl}/${state}`,
      images: [{
        url: `${baseUrl}/${state}/opengraph-image`,
        width: 1200,
        height: 630,
        alt: `${config.name} community college course finder — search ${config.collegeCount} ${config.systemName} colleges, transfer equivalencies, and schedules`,
      }],
    },
    twitter: {
      card: "summary_large_image",
      title: b.siteName,
      description: b.tagline,
    },
  };
}

export default async function StateLayout({ children, params }: Props) {
  const { state } = await params;
  if (!isValidState(state)) notFound();

  const config = requireStateConfig(state);
  const b = config.branding;
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com";

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: b.siteName,
            url: baseUrl,
            description: b.tagline,
            potentialAction: {
              "@type": "SearchAction",
              target: {
                "@type": "EntryPoint",
                urlTemplate: `${baseUrl}/${state}/courses?q={search_term_string}`,
              },
              "query-input": "required name=search_term_string",
            },
          }),
        }}
      />
      <Header
        state={state}
        stateName={config.name}
        transferSupported={config.transferSupported}
        prereqsAvailable={hasPrereqsCoverage(state)}
      />

      {/* Main content */}
      <main className="flex-1">{children}</main>

      {/* Footer — reorganized into 3-column layout (#374). Each topic-organized
          column is a sitewide internal-link surface that funnels link equity
          from every page on the site to the high-traffic guide clusters. */}
      <footer className="border-t border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8 mb-8">
            {/* Column 1: Tools (existing programmatic pages) */}
            <div>
              <p className="text-xs uppercase tracking-wide font-semibold text-gray-700 dark:text-slate-300 mb-3">
                Tools
              </p>
              <ul className="space-y-2 text-sm">
                <li>
                  <Link href={`/${state}/courses`} className="text-gray-600 dark:text-slate-400 hover:text-teal-600 transition-colors">
                    Find a Course
                  </Link>
                </li>
                <li>
                  <Link href={`/${state}/starting-soon`} className="text-gray-600 dark:text-slate-400 hover:text-teal-600 transition-colors">
                    Starting Soon
                  </Link>
                </li>
                <li>
                  <Link href={`/${state}/schedule`} className="text-gray-600 dark:text-slate-400 hover:text-teal-600 transition-colors">
                    Schedule Builder
                  </Link>
                </li>
                {config.transferSupported && (
                  <li>
                    <Link href={`/${state}/transfer`} className="text-gray-600 dark:text-slate-400 hover:text-teal-600 transition-colors">
                      Transfer Lookup
                    </Link>
                  </li>
                )}
                <li>
                  <Link href={`/${state}/colleges`} className="text-gray-600 dark:text-slate-400 hover:text-teal-600 transition-colors">
                    All {config.systemName} Colleges
                  </Link>
                </li>
              </ul>
            </div>

            {/* Column 2: Guides (high-traffic blog clusters) */}
            <div>
              <p className="text-xs uppercase tracking-wide font-semibold text-gray-700 dark:text-slate-300 mb-3">
                Guides
              </p>
              <ul className="space-y-2 text-sm">
                <li>
                  <Link href="/blog/free-community-college-classes-for-seniors" className="text-gray-600 dark:text-slate-400 hover:text-teal-600 transition-colors">
                    Senior Waivers
                  </Link>
                </li>
                <li>
                  <Link href="/blog/how-to-check-if-community-college-course-transfers" className="text-gray-600 dark:text-slate-400 hover:text-teal-600 transition-colors">
                    Transfer Guides
                  </Link>
                </li>
                <li>
                  <Link href="/blog/what-does-audit-a-class-mean" className="text-gray-600 dark:text-slate-400 hover:text-teal-600 transition-colors">
                    Auditing a Class
                  </Link>
                </li>
                <li>
                  <Link href="/blog/how-to-find-late-start-community-college-classes" className="text-gray-600 dark:text-slate-400 hover:text-teal-600 transition-colors">
                    Late-Start Classes
                  </Link>
                </li>
                <li>
                  <Link href="/blog/hybrid-community-college-classes-explained" className="text-gray-600 dark:text-slate-400 hover:text-teal-600 transition-colors">
                    Hybrid Classes
                  </Link>
                </li>
                <li>
                  <Link href="/blog" className="text-gray-600 dark:text-slate-400 hover:text-teal-600 transition-colors font-medium">
                    All articles →
                  </Link>
                </li>
              </ul>
            </div>

            {/* Column 3: About */}
            <div>
              <p className="text-xs uppercase tracking-wide font-semibold text-gray-700 dark:text-slate-300 mb-3">
                About
              </p>
              <ul className="space-y-2 text-sm">
                <li>
                  <Link href={`/${state}/about`} className="text-gray-600 dark:text-slate-400 hover:text-teal-600 transition-colors">
                    About this site
                  </Link>
                </li>
                <li>
                  <Link href="/privacy" className="text-gray-600 dark:text-slate-400 hover:text-teal-600 transition-colors">
                    Privacy Policy
                  </Link>
                </li>
                <li>
                  <a
                    href="https://buymeacoffee.com/voidseer"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md bg-amber-400 px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-500 transition-colors"
                  >
                    <span>&#9749;</span> Support this project
                  </a>
                </li>
              </ul>
            </div>
          </div>

          {/* Disclaimer row — kept at the bottom, full width */}
          <div className="pt-6 border-t border-gray-200 dark:border-slate-700">
            <p className="text-xs text-gray-500 dark:text-slate-400 mb-2">
              {b.footerText}
            </p>
            <p className="text-[11px] text-gray-400 dark:text-slate-500">
              Policy data is manually verified — always confirm with the
              college before enrolling. {b.disclaimer} For official information visit{" "}
              <a
                href={config.systemUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-gray-600 dark:hover:text-slate-300"
              >
                {config.systemUrl.replace("https://www.", "")}
              </a>
              .
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}

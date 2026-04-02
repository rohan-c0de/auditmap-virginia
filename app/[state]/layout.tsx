import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Header from "@/components/Header";
import { getStateConfig, isValidState } from "@/lib/states/registry";

type Props = {
  children: React.ReactNode;
  params: Promise<{ state: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { state } = await params;
  if (!isValidState(state)) return {};
  const config = getStateConfig(state);
  const b = config.branding;

  return {
    title: `${b.siteName} — Find Community College Courses to Audit`,
    description: b.tagline,
    keywords: b.metaKeywords,
    openGraph: {
      title: b.siteName,
      description: b.tagline,
      siteName: b.siteName,
      type: "website",
      locale: "en_US",
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

  const config = getStateConfig(state);
  const b = config.branding;
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://www.auditmap.com";

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
      <Header state={state} stateName={config.name} transferSupported={config.transferSupported} />

      {/* Main content */}
      <main className="flex-1">{children}</main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <p className="text-sm text-gray-500">{b.footerText}</p>
            <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400">
              <a
                href="/privacy"
                className="underline hover:text-gray-600"
              >
                Privacy Policy
              </a>
              <span>|</span>
              <p>
                Policy data is manually verified. Always confirm with the
                college before enrolling.
              </p>
              <span>|</span>
              <a
                href="https://buymeacoffee.com/auditmap"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md bg-amber-400 px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-500 transition-colors"
              >
                <span>&#9749;</span> Support this project
              </a>
            </div>
          </div>
          <p className="mt-4 text-center text-[11px] text-gray-400">
            {b.disclaimer} For official information visit{" "}
            <a
              href={config.systemUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-gray-600"
            >
              {config.systemUrl.replace("https://www.", "")}
            </a>
            .
          </p>
        </div>
      </footer>
    </>
  );
}

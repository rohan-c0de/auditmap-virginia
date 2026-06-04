import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import GoogleAnalytics from "@/components/GoogleAnalytics";
import AdSenseScript from "@/components/AdSenseScript";
import ThemeProvider from "@/components/ThemeProvider";
import AuthProvider from "@/components/AuthProvider";
import LoginModal from "@/components/auth/LoginModal";
import ConsentPrompt from "@/components/auth/ConsentPrompt";
import JsonLd from "@/components/JsonLd";
import Footer from "@/components/Footer";
import { getAllStates } from "@/lib/states/registry";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const _states = getAllStates();
const _totalColleges = _states.reduce((sum, s) => sum + s.collegeCount, 0);

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com"
  ),
  title: {
    default: "Community College Path — Course Finder & Transfer Guide",
    template: "%s | Community College Path",
  },
  description: `Search courses, plan transfers, and build schedules across ${_totalColleges}+ community colleges in ${_states.length} states. Free course finder for community college students.`,
  openGraph: {
    type: "website",
    siteName: "Community College Path",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-snippet": -1,
      "max-image-preview": "large",
      "max-video-preview": -1,
    },
  },
};

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com";

// Site-wide JSON-LD: WebSite (with sitelink search action), and an
// EducationalOrganization that aggregates the state systems we cover.
// Lives in the root layout so it appears on every page; per-route pages
// can layer additional structured data on top (CollegeOrUniversity,
// ItemList, BreadcrumbList, etc.).
const siteJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: "Community College Path",
      description: `Search courses, plan transfers, and build schedules across ${_totalColleges}+ community colleges in ${_states.length} states.`,
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: `${SITE_URL}/colleges?q={search_term_string}`,
        },
        "query-input": "required name=search_term_string",
      },
    },
    {
      "@type": "EducationalOrganization",
      "@id": `${SITE_URL}/#organization`,
      url: SITE_URL,
      name: "Community College Path",
      description: `An independent guide to ${_totalColleges}+ community colleges across ${_states.length} U.S. states. Free course finder, transfer lookup, and schedule planning tools for community college students.`,
      sameAs: [],
    },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100">
        {/* No-flash sidebar restore: on a hard reload of a pinned desktop
            state page, set data-nav-open before first paint so the sidebar is
            already open and the content already pushed — no slide-in. Runs only
            for a 2-letter state slug (the only routes that render the sidebar),
            so non-state pages are never shifted. Mirrors lib/nav/sidebar.ts
            (PIN_KEY + 1024px breakpoint). */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var s=location.pathname.split('/')[1]||'';if(localStorage.getItem('ccp-nav-pinned')==='1'&&window.matchMedia('(min-width: 1024px)').matches&&/^[a-z][a-z]$/.test(s)){document.documentElement.setAttribute('data-nav-open','1');}}catch(e){}})();",
          }}
        />
        <JsonLd data={siteJsonLd} />
        <ThemeProvider>
          <AuthProvider>
            <GoogleAnalytics />
            <AdSenseScript />
            {children}
            <Footer />
            <LoginModal />
            <ConsentPrompt />
          </AuthProvider>
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}

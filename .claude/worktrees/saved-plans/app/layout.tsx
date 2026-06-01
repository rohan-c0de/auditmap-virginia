import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import GoogleAnalytics from "@/components/GoogleAnalytics";
import AdSenseScript from "@/components/AdSenseScript";
import ThemeProvider from "@/components/ThemeProvider";
import AuthProvider from "@/components/AuthProvider";
import LoginModal from "@/components/auth/LoginModal";
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
        <JsonLd data={siteJsonLd} />
        <ThemeProvider>
          <AuthProvider>
            <GoogleAnalytics />
            <AdSenseScript />
            {children}
            <Footer />
            <LoginModal />
          </AuthProvider>
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}

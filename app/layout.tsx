import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import GoogleAnalytics from "@/components/GoogleAnalytics";
import AdSenseScript from "@/components/AdSenseScript";
import ThemeProvider from "@/components/ThemeProvider";
import AuthProvider from "@/components/AuthProvider";
import LoginModal from "@/components/auth/LoginModal";
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
        <ThemeProvider>
          <AuthProvider>
            <GoogleAnalytics />
            <AdSenseScript />
            {children}
            <LoginModal />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

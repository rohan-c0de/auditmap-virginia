import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AuditMap Virginia — Find Community College Courses to Audit",
  description:
    "Discover which Virginia community colleges allow course auditing, what it costs, and how to apply. Free for Virginia residents 60+.",
  keywords: [
    "Virginia community college audit",
    "VCCS audit course",
    "audit college class Virginia",
    "free college courses seniors Virginia",
    "Virginia 60+ tuition waiver",
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
    >
      <body className="min-h-full flex flex-col bg-white text-gray-900">
        {/* Header */}
        <header className="border-b border-gray-200 bg-white sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-teal-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">AM</span>
              </div>
              <span className="text-xl font-semibold text-gray-900">
                AuditMap <span className="text-teal-600">Virginia</span>
              </span>
            </Link>
            <nav className="hidden sm:flex items-center gap-6 text-sm text-gray-600">
              <Link href="/" className="hover:text-teal-600 transition-colors">
                Search
              </Link>
              <Link
                href="/courses"
                className="hover:text-teal-600 transition-colors"
              >
                Find a Course
              </Link>
              <Link
                href="/colleges"
                className="hover:text-teal-600 transition-colors"
              >
                All Colleges
              </Link>
              <Link
                href="/about"
                className="hover:text-teal-600 transition-colors"
              >
                About Auditing
              </Link>
            </nav>
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1">{children}</main>

        {/* Footer */}
        <footer className="border-t border-gray-200 bg-gray-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
              <p className="text-sm text-gray-500">
                AuditMap Virginia — Helping Virginians discover course auditing
                opportunities.
              </p>
              <p className="text-xs text-gray-400">
                Policy data is manually verified. Always confirm with the
                college before enrolling.
              </p>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}

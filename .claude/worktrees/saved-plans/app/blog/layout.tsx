import Link from "next/link";
import type { Metadata } from "next";
import ThemeToggle from "@/components/ThemeToggle";
import UserMenu from "@/components/auth/UserMenu";

export const metadata: Metadata = {
  alternates: {
    types: {
      "application/rss+xml": "/blog/feed.xml",
    },
  },
};

export default function BlogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-slate-900">
      {/* Blog header */}
      <header className="border-b border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 sticky top-0 z-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-teal-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-xs">CCP</span>
              </div>
              <span className="text-xl font-semibold text-gray-900 dark:text-slate-100">
                Community College <span className="text-teal-600">Path</span>
              </span>
            </Link>
            <span className="text-gray-300 dark:text-slate-600">/</span>
            <Link
              href="/blog"
              className="text-sm font-medium text-gray-600 dark:text-slate-400 hover:text-teal-600 transition-colors"
            >
              Blog
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-sm text-gray-500 dark:text-slate-400 hover:text-teal-600 transition-colors"
            >
              Find Courses
            </Link>
            <UserMenu />
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1">{children}</main>

      {/* Blog footer */}
      <footer className="border-t border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
          <div className="flex flex-wrap items-center justify-between gap-4 text-sm text-gray-500 dark:text-slate-400">
            <p>Community College Path — Community college course finder.</p>
            <div className="flex items-center gap-4">
              <Link
                href="/blog/feed.xml"
                className="hover:text-teal-600 transition-colors"
              >
                RSS
              </Link>
              <Link
                href="/privacy"
                className="hover:text-teal-600 transition-colors"
              >
                Privacy
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

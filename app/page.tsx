import Link from "next/link";
import type { Metadata } from "next";
import { getAllStates } from "@/lib/states/registry";
import ThemeToggle from "@/components/ThemeToggle";

const STATE_NAMES = getAllStates().map((s) => s.name);
const STATE_LIST_SENTENCE =
  STATE_NAMES.length <= 1
    ? STATE_NAMES.join("")
    : `${STATE_NAMES.slice(0, -1).join(", ")}, and ${STATE_NAMES[STATE_NAMES.length - 1]}`;

export const metadata: Metadata = {
  title: "Community College Path — Your Community College Course Finder",
  description: `Search courses, plan transfers, and build schedules across community colleges in ${STATE_LIST_SENTENCE}.`,
  keywords: [
    "community college courses",
    "CC course finder",
    "community college transfer",
    "schedule builder",
    "senior tuition waiver",
    "community college near me",
  ],
};

export default function LandingPage() {
  const states = getAllStates();
  const totalColleges = states.reduce((sum, s) => sum + s.collegeCount, 0);

  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-slate-900">
      {/* Minimal header */}
      <header className="border-b border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-teal-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-xs">CCM</span>
            </div>
            <span className="text-xl font-semibold text-gray-900 dark:text-slate-100">
              CC <span className="text-teal-600">CourseMap</span>
            </span>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/blog"
              className="text-sm text-gray-600 dark:text-slate-400 hover:text-teal-600 transition-colors"
            >
              Blog
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-teal-50 to-white dark:from-teal-950/50 dark:to-slate-900">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 dark:text-slate-100 mb-4">
            Your Community College Course Finder
          </h1>
          <p className="text-lg text-gray-600 dark:text-slate-400 max-w-2xl mx-auto">
            Search courses, plan transfers, and build schedules — across{" "}
            <span className="font-semibold text-gray-900 dark:text-slate-100">
              {totalColleges} colleges
            </span>{" "}
            in{" "}
            <span className="font-semibold text-gray-900 dark:text-slate-100">
              {states.length} states
            </span>
            .
          </p>
        </div>
      </section>

      {/* State cards */}
      <section className="py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-sm font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider text-center mb-8">
            Choose your state
          </h2>
          <div className="grid md:grid-cols-3 gap-6">
            {states.map((config) => (
              <Link
                key={config.slug}
                href={`/${config.slug}`}
                className="group rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm hover:shadow-md hover:border-teal-300 transition-all"
              >
                <h3 className="text-2xl font-bold text-gray-900 dark:text-slate-100 group-hover:text-teal-600 transition-colors">
                  {config.name}
                </h3>
                <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                  {config.systemName} &mdash; {config.collegeCount} colleges
                </p>

                <div className="flex flex-wrap gap-2 mt-4">
                  {config.seniorWaiver && (
                    <span className="inline-flex items-center rounded-full bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 px-2.5 py-0.5 text-xs font-medium text-green-700">
                      Free for {config.seniorWaiver.ageThreshold}+
                    </span>
                  )}
                  {config.transferSupported && (
                    <span className="inline-flex items-center rounded-full bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                      Transfer Data
                    </span>
                  )}
                </div>

                <div className="mt-6 text-sm font-medium text-teal-600 group-hover:text-teal-700">
                  Explore {config.name} &rarr;
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-gray-50 dark:bg-slate-800">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-slate-100 text-center mb-12">
            What You Can Do
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
            <div className="text-center">
              <div className="w-12 h-12 bg-teal-100 dark:bg-teal-900/30 text-teal-700 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
              </div>
              <h3 className="font-semibold text-gray-900 dark:text-slate-100 mb-1">
                Search Courses
              </h3>
              <p className="text-sm text-gray-600 dark:text-slate-400">
                Search across all colleges at once by subject, keyword, or
                course number.
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 text-blue-700 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                </svg>
              </div>
              <h3 className="font-semibold text-gray-900 dark:text-slate-100 mb-1">
                Transfer Lookup
              </h3>
              <p className="text-sm text-gray-600 dark:text-slate-400">
                See which courses transfer to your target university before you
                enroll.
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 text-purple-700 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                </svg>
              </div>
              <h3 className="font-semibold text-gray-900 dark:text-slate-100 mb-1">
                Schedule Builder
              </h3>
              <p className="text-sm text-gray-600 dark:text-slate-400">
                Build a weekly schedule across multiple colleges and courses.
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 text-green-700 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="font-semibold text-gray-900 dark:text-slate-100 mb-1">
                Starting Soon
              </h3>
              <p className="text-sm text-gray-600 dark:text-slate-400">
                Find late-start and mini-session courses still open for
                registration.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t border-gray-200 dark:border-slate-700 py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-gray-500 dark:text-slate-400">
          <p>&copy; {new Date().getFullYear()} Community College Path</p>
          <div className="flex gap-4">
            <Link href="/blog" className="hover:text-teal-600 transition-colors">
              Blog
            </Link>
            <Link href="/privacy" className="hover:text-teal-600 transition-colors">
              Privacy Policy
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

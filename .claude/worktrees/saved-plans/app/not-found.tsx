import Link from "next/link";
import type { Metadata } from "next";
import { getAllStates } from "@/lib/states/registry";

export const metadata: Metadata = {
  title: "Page not found — Community College Path",
  description:
    "We couldn't find that page. Browse community colleges, courses, and transfer guides across the states we cover.",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  const states = getAllStates()
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900">
      <header className="border-b border-gray-200 dark:border-slate-800">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <Link
            href="/"
            className="text-lg font-semibold text-teal-700 dark:text-teal-400 hover:text-teal-800"
          >
            Community College Path
          </Link>
          <nav className="flex gap-4 text-sm">
            <Link
              href="/colleges"
              className="text-gray-600 dark:text-slate-400 hover:text-gray-900"
            >
              Colleges
            </Link>
            <Link
              href="/blog"
              className="text-gray-600 dark:text-slate-400 hover:text-gray-900"
            >
              Blog
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-16">
        <p className="text-sm font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-400">
          404 — Page not found
        </p>
        <h1 className="mt-2 text-3xl font-bold text-gray-900 dark:text-slate-100 sm:text-4xl">
          We couldn&apos;t find that page.
        </h1>
        <p className="mt-3 max-w-xl text-base text-gray-600 dark:text-slate-400">
          The page may have moved or never existed. Here are a few ways to find
          what you&apos;re looking for.
        </p>

        <section className="mt-10">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">
            Popular destinations
          </h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            <li>
              <Link
                href="/colleges"
                className="block rounded-lg border border-gray-200 dark:border-slate-700 px-4 py-3 hover:border-teal-400 hover:bg-teal-50/40 dark:hover:bg-slate-800"
              >
                <span className="font-medium text-gray-900 dark:text-slate-100">
                  Browse all colleges
                </span>
                <span className="block text-sm text-gray-500 dark:text-slate-400">
                  Every community college we cover, by state.
                </span>
              </Link>
            </li>
            <li>
              <Link
                href="/blog"
                className="block rounded-lg border border-gray-200 dark:border-slate-700 px-4 py-3 hover:border-teal-400 hover:bg-teal-50/40 dark:hover:bg-slate-800"
              >
                <span className="font-medium text-gray-900 dark:text-slate-100">
                  Guides & articles
                </span>
                <span className="block text-sm text-gray-500 dark:text-slate-400">
                  How to find courses, transfer credit, and pay less.
                </span>
              </Link>
            </li>
            <li>
              <Link
                href="/va"
                className="block rounded-lg border border-gray-200 dark:border-slate-700 px-4 py-3 hover:border-teal-400 hover:bg-teal-50/40 dark:hover:bg-slate-800"
              >
                <span className="font-medium text-gray-900 dark:text-slate-100">
                  Search courses
                </span>
                <span className="block text-sm text-gray-500 dark:text-slate-400">
                  Find a specific course offered this term.
                </span>
              </Link>
            </li>
            <li>
              <Link
                href="/"
                className="block rounded-lg border border-gray-200 dark:border-slate-700 px-4 py-3 hover:border-teal-400 hover:bg-teal-50/40 dark:hover:bg-slate-800"
              >
                <span className="font-medium text-gray-900 dark:text-slate-100">
                  Start from the home page
                </span>
                <span className="block text-sm text-gray-500 dark:text-slate-400">
                  Pick your state and search from there.
                </span>
              </Link>
            </li>
          </ul>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">
            Pick a state
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
            We cover {states.length} states. Jump straight to one.
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {states.map((s) => (
              <li key={s.slug}>
                <Link
                  href={`/${s.slug}`}
                  className="inline-block rounded-full border border-gray-200 dark:border-slate-700 px-3 py-1 text-sm text-gray-700 dark:text-slate-300 hover:border-teal-400 hover:bg-teal-50 dark:hover:bg-slate-800"
                >
                  {s.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}

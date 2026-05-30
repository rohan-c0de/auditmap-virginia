import type { Metadata } from "next";
import Link from "next/link";
import { getAllStates } from "@/lib/states/registry";

export const metadata: Metadata = {
  title: "About — Community College Path",
  description:
    "Community College Path is a free course finder and transfer guide for community college students. Search courses, check transfers, plan schedules — across 26 states in one place.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  const states = getAllStates();
  const totalColleges = states.reduce((sum, s) => sum + s.collegeCount, 0);

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <Link
        href="/"
        className="text-sm text-teal-600 hover:text-teal-700 mb-6 inline-block"
      >
        &larr; Back to home
      </Link>

      <h1 className="text-3xl font-bold text-gray-900 dark:text-slate-100 mb-8">
        About Community College Path
      </h1>

      <div className="space-y-8 text-gray-600 dark:text-slate-400">
        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-3">
            What It Is
          </h2>
          <p className="mb-3">
            Community College Path is a free course navigator covering {totalColleges}+ community
            colleges across {states.length} states. Search for courses, compare sections across
            campuses, check transfer credit, and plan your schedule — without bouncing between
            a dozen different college websites.
          </p>
          <p>
            No account required. No paywall. Everything is free.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-3">
            What You Can Do Here
          </h2>
          <ul className="space-y-3">
            <li className="flex gap-3">
              <span className="text-teal-600 font-bold shrink-0 mt-0.5">—</span>
              <span>
                <strong className="text-gray-700 dark:text-slate-300">Search courses</strong> —
                find sections by subject, keyword, or course code across every college in a state.
                Filter by delivery mode, days, or time of day.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-teal-600 font-bold shrink-0 mt-0.5">—</span>
              <span>
                <strong className="text-gray-700 dark:text-slate-300">Check transfer credit</strong> —
                see exactly which community college courses count toward a degree at in-state
                universities, sourced from official state articulation agreements.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-teal-600 font-bold shrink-0 mt-0.5">—</span>
              <span>
                <strong className="text-gray-700 dark:text-slate-300">Look up prerequisites</strong> —
                understand what you need before enrolling, shown as a plain-English chain so
                there are no surprises at registration.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-teal-600 font-bold shrink-0 mt-0.5">—</span>
              <span>
                <strong className="text-gray-700 dark:text-slate-300">Build a schedule</strong> —
                drag courses into a weekly calendar to find combinations that actually fit your life.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-teal-600 font-bold shrink-0 mt-0.5">—</span>
              <span>
                <strong className="text-gray-700 dark:text-slate-300">Find late-start classes</strong> —
                browse sections that begin after the main semester start date and are still open
                for enrollment.
              </span>
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-3">
            Why We Built It
          </h2>
          <p className="mb-3">
            Navigating community college is harder than it should be. Registration portals
            are difficult to search, each campus has its own website, and there&apos;s rarely
            a clear answer to the most important questions: Will this course transfer? Do I
            have the prerequisites? Can I find a section that fits my schedule?
          </p>
          <p>
            Community College Path puts all of that information in one place. We built it
            especially with first-generation students in mind — people who don&apos;t have
            a parent, advisor, or older sibling who has already figured this out.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-3">
            Who We Are
          </h2>
          <p className="mb-3">
            Community College Path is an independent project, not affiliated with any college
            or college system. Course data is pulled directly from each college&apos;s
            registration system and updated regularly throughout the semester.
          </p>
          <p>
            We are expanding state by state. If you notice missing data, a college that
            should be here, or anything that looks wrong, please{" "}
            <a
              href="https://github.com/rohan-c0de/cc-coursemap/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="text-teal-600 underline hover:text-teal-800 dark:hover:text-teal-300"
            >
              open an issue on GitHub
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-3">
            A Note on Accuracy
          </h2>
          <p>
            Course schedules and transfer policies change every semester. We update data as
            frequently as possible, but always confirm details directly with the college
            before enrolling. Every college page includes a link to the official
            registration portal.
          </p>
        </section>
      </div>

      <div className="mt-12 flex flex-col sm:flex-row gap-4">
        <Link
          href="/"
          className="inline-flex items-center justify-center px-6 py-3 bg-teal-600 text-white rounded-lg font-semibold hover:bg-teal-700 transition-colors"
        >
          Find Courses
        </Link>
        <Link
          href="/contact"
          className="inline-flex items-center justify-center px-6 py-3 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-300 rounded-lg font-semibold hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
        >
          Contact Us
        </Link>
      </div>
    </div>
  );
}

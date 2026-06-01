import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Contact — Community College Path",
  description:
    "Get in touch with Community College Path. Report missing data, suggest a college, or ask a question.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <Link
        href="/"
        className="text-sm text-teal-600 hover:text-teal-700 mb-6 inline-block"
      >
        &larr; Back to home
      </Link>

      <h1 className="text-3xl font-bold text-gray-900 dark:text-slate-100 mb-8">
        Contact Us
      </h1>

      <div className="space-y-8 text-gray-600 dark:text-slate-400">
        <section>
          <p className="mb-6">
            Have a question, found something wrong, or want to suggest a college? We read
            every message and do our best to respond quickly.
          </p>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="bg-teal-50 dark:bg-teal-900/30 border border-teal-200 dark:border-teal-800 rounded-lg p-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-2">
                Email
              </h2>
              <p className="mb-3">For general questions or private inquiries:</p>
              <a
                href="mailto:hello@communitycollegepath.com"
                className="text-teal-600 underline hover:text-teal-800 dark:hover:text-teal-300 font-medium"
              >
                hello@communitycollegepath.com
              </a>
            </div>

            <div className="bg-teal-50 dark:bg-teal-900/30 border border-teal-200 dark:border-teal-800 rounded-lg p-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-2">
                GitHub Issues
              </h2>
              <p className="mb-3">
                For bug reports, missing data, or feature requests — keeps the
                conversation public so others can add context:
              </p>
              <a
                href="https://github.com/rohan-c0de/cc-coursemap/issues"
                target="_blank"
                rel="noopener noreferrer"
                className="text-teal-600 underline hover:text-teal-800 dark:hover:text-teal-300 font-medium"
              >
                github.com/rohan-c0de/cc-coursemap/issues →
              </a>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-3">
            Common Reasons to Reach Out
          </h2>
          <ul className="space-y-2 list-disc list-inside">
            <li>A college or course is missing from our data</li>
            <li>Course information looks incorrect or out of date</li>
            <li>Transfer equivalency data needs a correction</li>
            <li>You want to suggest a feature or improvement</li>
            <li>You have a question about how the site works</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-3">
            Privacy
          </h2>
          <p>
            We only use your email to respond to your message. We never share it
            with third parties. See our{" "}
            <Link
              href="/privacy"
              className="text-teal-600 underline hover:text-teal-800 dark:hover:text-teal-300"
            >
              privacy policy
            </Link>{" "}
            for full details.
          </p>
        </section>
      </div>
    </div>
  );
}

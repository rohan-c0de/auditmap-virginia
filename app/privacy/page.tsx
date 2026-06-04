import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — Community College Path",
  description:
    "What Community College Path collects, why, who processes it, and the choices you have — including our pledge never to sell your personal or student-planning data.",
};

export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <h1 className="text-3xl font-bold mb-8">Privacy Policy</h1>
      <p className="text-sm text-gray-500 dark:text-slate-400 mb-8">Last updated: June 4, 2026</p>

      <div className="prose prose-gray dark:prose-invert max-w-none space-y-6 text-gray-700 dark:text-slate-300">
        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mt-8 mb-3">Overview</h2>
          <p>
            Community College Path is a free course navigator for public community colleges across
            the United States. You can browse courses, transfers, programs, and college pages without
            an account. We collect as little as we can to run the service, and this page explains
            exactly what we collect, why, who helps us process it, and the choices you have. Your use
            of the site is also governed by our{" "}
            <Link href="/terms" className="text-teal-600 underline">Terms of Service</Link>.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mt-8 mb-3">Accounts and sign-in</h2>
          <p>
            Accounts are optional — you only need one to save your work or set up alerts. We use
            Supabase Authentication, and you can sign in with Google or with a one-time email
            &ldquo;magic link&rdquo; (no password). When you create an account we store your email
            address, which sign-in method you used, and any display name or avatar your provider
            shares, plus a record that you confirmed you are 13 or older and agreed to our Terms and
            this Policy (a timestamp and version). You must be at least 13 to create an account.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mt-8 mb-3">What you save to your account</h2>
          <p>
            If you sign in, you can save degree plans and weekly schedules, bookmark courses, track
            transfer destinations, and turn on alerts for when a seat opens in a course on one of your
            plans. This information is stored in our database (Supabase) and tied to your account.
            Access is restricted so that only you can read or change your own saved data. You can
            delete any of it from your account page at any time.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mt-8 mb-3">Email notifications</h2>
          <p>
            If you ask to be notified (for example, when new semester schedules are posted, or when a
            seat opens), we collect your email address for that purpose. New-schedule subscriptions
            use double opt-in: after you sign up you&apos;ll get a confirmation email and must click a
            verification link before we send anything. We send email through Resend. We use your email
            only for the notifications you asked for, and every notification includes an unsubscribe
            link.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mt-8 mb-3">Search questions</h2>
          <p>
            When you type a plain-language question into the search bar (for example, &ldquo;does ENG
            111 transfer to GMU?&rdquo;), we cache the result on our servers so the same question is
            fast and free to answer next time. That cache stores the normalized question text and the
            computed answer, keyed by a one-way hash of the question; it is <strong>not</strong> linked
            to your account or identity. Ordinary course filters, such as a zip code used to sort by
            distance, are used to return results and are not stored with your identity.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mt-8 mb-3">Analytics</h2>
          <p>
            We use Google Analytics and Vercel Analytics to understand how the site is used in
            aggregate — pages visited, device type, general region. This helps us improve the site. We
            do not use analytics data to target ads.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mt-8 mb-3">Advertising</h2>
          <p>
            We show ads through Google AdSense on our public pages to help cover the cost of running
            the site. Google may use cookies to serve ads, including ads based on your visits to this
            and other sites. We do <strong>not</strong> show ads on signed-in account or saved-plan
            pages. You can manage or turn off personalized advertising in your{" "}
            <a
              href="https://www.google.com/settings/ads"
              target="_blank"
              rel="noopener noreferrer"
              className="text-teal-600 underline hover:text-teal-800 dark:hover:text-teal-300"
            >
              Google Ads Settings
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mt-8 mb-3">Service providers we share data with</h2>
          <p>To run the service we rely on a small set of processors:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Supabase</strong> — database and authentication (your account and saved data).</li>
            <li><strong>Resend</strong> — sending notification and verification emails.</li>
            <li><strong>Google</strong> — Analytics (usage measurement) and AdSense (ads on public pages).</li>
            <li><strong>Vercel</strong> — hosting and aggregate performance analytics.</li>
          </ul>
          <p>
            We do not sell your personal information, and we share it with these providers only so they
            can perform their service for us.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mt-8 mb-3">Cookies</h2>
          <p>
            When you sign in, Supabase sets a session cookie so you stay logged in. Google Analytics
            and AdSense also set cookies, as described above. You can opt out of Google Analytics with
            the{" "}
            <a
              href="https://tools.google.com/dlpage/gaoptout"
              target="_blank"
              rel="noopener noreferrer"
              className="text-teal-600 underline hover:text-teal-800 dark:hover:text-teal-300"
            >
              Google Analytics Opt-out Browser Add-on
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mt-8 mb-3">Our promises about your data</h2>
          <p>
            We build this for students. We will not sell your personal information, and we will not
            package or sell student-intent data — the courses, plans, or programs you save or track —
            to advertisers, colleges, or universities. We hold student-entered planning data (the
            courses and plans you choose), <strong>not</strong> official transcripts or education
            records from a school, so this is not a FERPA &ldquo;education record.&rdquo;
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mt-8 mb-3">Data retention</h2>
          <p>
            Account data and the items you save are kept until you delete them or delete your account.
            Email addresses for notifications are kept until you unsubscribe; unconfirmed subscriptions
            may be removed periodically. Cached search questions (described above) are retained on our
            servers to keep answers fast; they are not tied to you, and we intend to add automatic
            expiry of older entries. Analytics data follows Google&apos;s and Vercel&apos;s default
            retention.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mt-8 mb-3">Your choices and rights</h2>
          <p>
            You can delete your account at any time from your account page; deleting it removes your
            profile and the plans, schedules, bookmarks, and transfer tracking saved to it. Email
            notifications are separate — use the unsubscribe link in any email to stop those. You can
            also{" "}
            <Link href="/contact" className="text-teal-600 underline">contact us</Link>{" "}
            to ask for a copy of the data we hold about you or to request deletion, and we&apos;ll help.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mt-8 mb-3">Children</h2>
          <p>
            You must be at least 13 to create an account. We do not knowingly collect personal
            information from children under 13. If you believe a child under 13 has created an account,
            please{" "}
            <Link href="/contact" className="text-teal-600 underline">contact us</Link>{" "}
            and we will delete it.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mt-8 mb-3">Third-party links</h2>
          <p>
            Our site links to external websites, including community college sites and course
            registration systems. We are not responsible for the privacy practices of those sites.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mt-8 mb-3">Changes to this policy</h2>
          <p>
            We may update this policy from time to time. Changes will be reflected here with an updated
            date above.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mt-8 mb-3">Contact</h2>
          <p>
            Questions about this policy? Email us at{" "}
            <a
              href="mailto:hello@communitycollegepath.com"
              className="text-teal-600 underline hover:text-teal-800 dark:hover:text-teal-300"
            >
              hello@communitycollegepath.com
            </a>
            {" "}or open an issue on our{" "}
            <a
              href="https://github.com/rohan-c0de/cc-coursemap"
              target="_blank"
              rel="noopener noreferrer"
              className="text-teal-600 underline hover:text-teal-800 dark:hover:text-teal-300"
            >
              GitHub repository
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}

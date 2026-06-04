import type { Metadata } from "next";
import Link from "next/link";

// DRAFT — pending legal review before launch. This is reasonable, specific
// boilerplate written to ship a real (non-empty) Terms page and back the
// signup consent gate; have counsel vet/replace the copy before relying on it.
// Bump lib/consent.ts TOS_VERSION when the substance changes materially.

export const metadata: Metadata = {
  title: "Terms of Service — Community College Path",
  description:
    "The terms that govern your use of Community College Path, including eligibility (13+), acceptable use, and our promises about your data.",
};

export default function TermsPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <h1 className="text-3xl font-bold mb-8">Terms of Service</h1>
      <p className="text-sm text-gray-500 dark:text-slate-400 mb-8">
        Effective date: June 4, 2026
      </p>

      <div className="prose prose-gray dark:prose-invert max-w-none space-y-6 text-gray-700 dark:text-slate-300">
        <section>
          <p>
            Welcome to Community College Path (&ldquo;we,&rdquo; &ldquo;us&rdquo;). These Terms of
            Service (&ldquo;Terms&rdquo;) govern your use of communitycollegepath.com (the
            &ldquo;Service&rdquo;). By using the Service or creating an account, you agree to
            these Terms and to our{" "}
            <Link href="/privacy" className="text-teal-600 underline">Privacy Policy</Link>. If you
            do not agree, please do not use the Service.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mt-8 mb-3">1. Who can use the Service</h2>
          <p>
            Anyone may browse the Service. To <strong>create an account</strong> you must be at
            least <strong>13 years old</strong>. If you are under 18, please review these Terms with
            a parent or guardian. We do not knowingly collect personal information from children
            under 13; if you believe a child under 13 has created an account, please{" "}
            <Link href="/contact" className="text-teal-600 underline">contact us</Link> and we will
            delete it.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mt-8 mb-3">2. What the Service is</h2>
          <p>
            Community College Path helps students find courses, plan schedules, and understand
            transfer equivalencies across public community-college systems. Course, transfer, and
            program information is gathered from public sources and provided for planning purposes.
            It may be incomplete or out of date &mdash; always confirm details (registration,
            prerequisites, transferability, cost) directly with the college or university before
            making decisions. We are not affiliated with, or endorsed by, any college, university,
            or government agency.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mt-8 mb-3">3. Your account</h2>
          <p>
            You are responsible for activity under your account, and for keeping your sign-in method
            secure. You can delete your account at any time from your account page.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mt-8 mb-3">4. Acceptable use</h2>
          <p>
            Please do not misuse the Service. Do not attempt to breach security or access other
            users&apos; data, scrape at a scale that burdens our systems, or use the Service for
            unlawful, harmful, or deceptive purposes. Automated access must respect our robots.txt.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mt-8 mb-3">5. Our promises about your data</h2>
          <p>
            We build this for students. <strong>We will not sell your personal information</strong>,
            and we will not package or sell student-intent data &mdash; the courses, plans, or
            programs you save or track &mdash; to advertisers, colleges, or universities. We hold
            student-entered planning data (the courses and plans you choose), <strong>not</strong>{" "}
            official transcripts or education records from a school, so this is not a FERPA
            &ldquo;education record.&rdquo; See our{" "}
            <Link href="/privacy" className="text-teal-600 underline">Privacy Policy</Link> for what
            we collect and why.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mt-8 mb-3">6. Content and intellectual property</h2>
          <p>
            The Service, its design, and original content are ours or our licensors&apos;. Public
            course and transfer data is presented for your personal, non-commercial planning use.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mt-8 mb-3">7. Disclaimers</h2>
          <p>
            The Service is provided &ldquo;as is&rdquo; and &ldquo;as available,&rdquo; without
            warranties of any kind. We do not guarantee the accuracy, completeness, or availability
            of any information, including course schedules, open seats, prerequisites, or transfer
            outcomes.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mt-8 mb-3">8. Limitation of liability</h2>
          <p>
            To the fullest extent permitted by law, Community College Path is not liable for any
            indirect, incidental, or consequential damages, or for decisions you make based on
            information from the Service. Always confirm anything important with the school.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mt-8 mb-3">9. Changes to these Terms</h2>
          <p>
            We may update these Terms. If we make material changes, we will update the effective
            date above and, where appropriate, ask you to re-accept. Continued use after a change
            means you accept the updated Terms.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mt-8 mb-3">10. Contact</h2>
          <p>
            Questions about these Terms? <Link href="/contact" className="text-teal-600 underline">Contact us</Link>.
          </p>
        </section>
      </div>
    </div>
  );
}

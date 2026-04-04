import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — CC CourseMap",
  description: "Privacy policy for CC CourseMap.",
};

export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <h1 className="text-3xl font-bold mb-8">Privacy Policy</h1>
      <p className="text-sm text-gray-500 mb-8">Last updated: April 3, 2026</p>

      <div className="prose prose-gray max-w-none space-y-6 text-gray-700">
        <section>
          <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-3">Overview</h2>
          <p>
            CC CourseMap is a free tool that helps people find community college
            courses available for auditing across the Virginia Community College System
            (VCCS). We are committed to protecting your privacy and being transparent
            about the data we collect.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-3">Information We Collect</h2>
          <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">Analytics Data</h3>
          <p>
            We use Google Analytics to understand how visitors use our site. This
            collects anonymous data such as pages visited, time spent on site, device
            type, and general geographic region. This information helps us improve the
            site. We do not use this data for advertising purposes.
          </p>
          <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">Email Addresses</h3>
          <p>
            If you sign up for notifications (e.g., to be alerted when new semester
            schedules are posted), we collect your email address. We use a
            double opt-in process: after signing up, you&apos;ll receive a
            confirmation email and must click a verification link before
            receiving any notifications. We will only use your email for the
            specific purpose you signed up for. We do not sell or share your
            email with third parties. Every notification email includes an
            unsubscribe link so you can opt out at any time.
          </p>
          <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">Search Data</h3>
          <p>
            When you search for courses or enter a zip code, this data is processed
            on our servers to return results. We do not permanently store your search
            queries or zip codes.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-3">Cookies</h2>
          <p>
            Google Analytics uses cookies to distinguish unique visitors and track
            sessions. These are first-party cookies set by Google. You can opt out of
            Google Analytics by installing the{" "}
            <a
              href="https://tools.google.com/dlpage/gaoptout"
              target="_blank"
              rel="noopener noreferrer"
              className="text-teal-600 underline hover:text-teal-800"
            >
              Google Analytics Opt-out Browser Add-on
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-3">Advertising</h2>
          <p>
            We may display ads through Google AdSense or similar networks to help
            cover the costs of running this site. These ad networks may use cookies
            to serve ads based on your prior visits to this or other websites. You can
            opt out of personalized advertising by visiting{" "}
            <a
              href="https://www.google.com/settings/ads"
              target="_blank"
              rel="noopener noreferrer"
              className="text-teal-600 underline hover:text-teal-800"
            >
              Google Ads Settings
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-3">Third-Party Links</h2>
          <p>
            Our site contains links to external websites, including VCCS college
            websites and courses.vccs.edu. We are not responsible for the privacy
            practices of these external sites.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-3">Data Retention</h2>
          <p>
            Analytics data is retained according to Google Analytics default retention
            settings. Email addresses collected for notifications are retained until
            you unsubscribe or request deletion. Unverified email subscriptions that
            are never confirmed may be periodically removed.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-3">Your Rights</h2>
          <p>
            You may request deletion of any personal data we hold (such as your email
            address) by contacting us. You may also unsubscribe from notifications at
            any time.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-3">Changes to This Policy</h2>
          <p>
            We may update this privacy policy from time to time. Changes will be
            reflected on this page with an updated date.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-3">Contact</h2>
          <p>
            If you have questions about this privacy policy, please open an issue on
            our{" "}
            <a
              href="https://github.com/rohan-c0de/auditmap-virginia"
              target="_blank"
              rel="noopener noreferrer"
              className="text-teal-600 underline hover:text-teal-800"
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

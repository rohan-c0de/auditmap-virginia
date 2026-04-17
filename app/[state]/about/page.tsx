import Link from "next/link";
import type { Metadata } from "next";
import { getStateConfig, getAllStates } from "@/lib/states/registry";

type Props = {
  params: Promise<{ state: string }>;
};

export function generateStaticParams() {
  return getAllStates().map((s) => ({ state: s.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { state } = await params;
  const config = getStateConfig(state);
  return {
    title: `About — ${config.branding.siteName}`,
    description: `Learn about ${config.branding.siteName} — search courses, check transfer equivalencies, build schedules, and find auditing info for ${config.name} community colleges.`,
    alternates: { canonical: `/${state}/about` },
  };
}

export default async function AboutPage({ params }: Props) {
  const { state } = await params;
  const config = getStateConfig(state);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com";

  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "What is Community College Path?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Community College Path is a free course finder for community colleges. Search courses across all colleges, check transfer equivalencies, build schedules, and find auditing info.",
        },
      },
      {
        "@type": "Question",
        name: "What is course auditing?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Auditing a college course means attending classes without receiving a grade or academic credit. You participate in lectures and follow the material alongside enrolled students, but without exams, graded assignments, or GPA impact.",
        },
      },
      {
        "@type": "Question",
        name: "Who audits courses?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Career explorers testing a field before committing, lifelong learners pursuing interests, professionals brushing up on skills, students previewing challenging courses, and retirees or seniors who may qualify for free tuition.",
        },
      },
      {
        "@type": "Question",
        name: `How does course auditing work at ${config.name} community colleges?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: "Apply for admission at the college, browse available courses, submit a Course Audit Request form during add/drop, get instructor approval, then attend classes and participate without exams or grades.",
        },
      },
      {
        "@type": "Question",
        name: "What does auditing a course cost?",
        acceptedAnswer: {
          "@type": "Answer",
          text: `At most ${config.systemName} colleges, audit students pay the same tuition and fees as credit students.${config.seniorWaiver ? ` ${config.name} residents aged ${config.seniorWaiver.ageThreshold}+ may qualify for free tuition under state law.` : ""}`,
        },
      },
    ],
  };

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${siteUrl}/${state}` },
      { "@type": "ListItem", position: 2, name: "About Course Auditing", item: `${siteUrl}/${state}/about` },
    ],
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      <Link
        href={`/${state}`}
        className="text-sm text-teal-600 hover:text-teal-700 mb-6 inline-block"
      >
        &larr; Back to search
      </Link>

      <h1 className="text-3xl font-bold text-gray-900 dark:text-slate-100 mb-8">
        About Community College Path
      </h1>

      <div className="space-y-8">
        {/* What is Community College Path */}
        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-3">
            What is Community College Path?
          </h2>
          <p className="text-gray-600 dark:text-slate-400">
            Community College Path is a free tool for finding and comparing community
            college courses across {config.name}. Search by subject or keyword,
            check which courses transfer to your target university, build a
            weekly schedule, and find late-start classes still open for
            registration.
          </p>
        </section>

        {/* What is auditing */}
        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-3">
            What is Course Auditing?
          </h2>
          <p className="text-gray-600 dark:text-slate-400 mb-3">
            Auditing a college course means attending classes without receiving a
            grade or academic credit. You participate in lectures, follow the
            material, and learn alongside enrolled students — but without exams,
            graded assignments, or GPA impact.
          </p>
          <p className="text-gray-600 dark:text-slate-400">
            It&apos;s a way to explore subjects you&apos;re curious about, build
            skills for a career change, preview a program before committing, or
            simply learn something new.
          </p>
        </section>

        {/* Who is it for */}
        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-3">
            Who Audits Courses?
          </h2>
          <ul className="text-gray-600 dark:text-slate-400 space-y-2">
            <li className="flex gap-2">
              <span className="text-teal-600 font-bold shrink-0">-</span>
              <span>
                <strong>Career explorers</strong> — testing a field before
                committing to a degree or certificate
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-teal-600 font-bold shrink-0">-</span>
              <span>
                <strong>Lifelong learners</strong> — pursuing interests in
                history, art, science, or any subject
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-teal-600 font-bold shrink-0">-</span>
              <span>
                <strong>Professionals</strong> — brushing up on skills or
                learning adjacent topics without needing credits
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-teal-600 font-bold shrink-0">-</span>
              <span>
                <strong>Students</strong> — previewing a challenging course
                before taking it for credit
              </span>
            </li>
            {config.seniorWaiver && (
              <li className="flex gap-2">
                <span className="text-teal-600 font-bold shrink-0">-</span>
                <span>
                  <strong>Retirees and seniors</strong> — {config.name} residents{" "}
                  {config.seniorWaiver.ageThreshold}+ may qualify for free
                  tuition under state law
                </span>
              </li>
            )}
          </ul>
        </section>

        {/* How it works */}
        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-3">
            How It Works at {config.name} Community Colleges
          </h2>
          <p className="text-gray-600 dark:text-slate-400 mb-4">
            {config.name}&apos;s {config.collegeCount} community colleges (the{" "}
            {config.systemName} system) generally allow course auditing, though
            policies vary by college. The typical process:
          </p>
          <ol className="space-y-3">
            {[
              "Apply for admission at the college (even auditors need to be in the system)",
              "Browse available courses and pick the one you want to audit",
              "Submit a Course Audit Request form during the add/drop period",
              "Get instructor approval — some courses require a signature or email confirmation",
              "Attend classes and participate (no exams or grades)",
            ].map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-100 dark:bg-teal-900/30 text-xs font-bold text-teal-700 dark:text-teal-400">
                  {i + 1}
                </span>
                <span className="text-gray-600 dark:text-slate-400 pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
        </section>

        {/* Cost */}
        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-3">
            What Does It Cost?
          </h2>
          <p className="text-gray-600 dark:text-slate-400 mb-3">
            {`At most ${config.systemName} colleges, audit students pay the same tuition and fees as credit students. Check each college's page for specific cost details.`}
          </p>
          {config.seniorWaiver && (
            <div className="bg-teal-50 dark:bg-teal-900/30 border border-teal-200 dark:border-teal-800 rounded-lg p-4">
              <h3 className="font-semibold text-teal-900 dark:text-teal-200 mb-1">
                {config.name} {config.seniorWaiver.ageThreshold}+ Tuition Waiver
              </h3>
              <p className="text-teal-800 dark:text-teal-300 text-sm">
                {config.seniorWaiver.description} We flag this on every college
                page with links to verify.
              </p>
            </div>
          )}
        </section>

        {/* Important notes */}
        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-3">
            Things to Know
          </h2>
          <ul className="text-gray-600 dark:text-slate-400 space-y-2 list-disc list-inside">
            <li>
              Audited courses do not count toward a degree or appear on your
              transcript with a grade (you may receive an &quot;AU&quot; notation)
            </li>
            <li>
              Financial aid typically cannot be applied to audited courses
            </li>
            <li>
              Some courses (labs, clinicals, studios) may not be available for
              auditing
            </li>
            <li>
              You usually cannot switch from audit to credit (or vice versa)
              after the add/drop period
            </li>
            <li>
              Audit seats are subject to availability — credit-seeking students
              get priority
            </li>
          </ul>
        </section>

        {/* About this site */}
        <section className="border-t border-gray-200 dark:border-slate-700 pt-8">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-3">
            About {config.branding.siteName}
          </h2>
          <p className="text-gray-600 dark:text-slate-400 mb-3">
            {config.branding.siteName} is a free tool that helps you search,
            compare, and plan community college courses across {config.name}. We
            aggregate course listings from the {config.systemName} system and
            pair them with transfer equivalency data and manually researched
            audit policies.
          </p>
          <p className="text-gray-600 dark:text-slate-400 mb-3">
            Every audit policy on this site includes a &quot;last verified&quot;
            date and a link to the source. Policies can change, so always
            confirm directly with the college before enrolling.
          </p>
          <p className="text-sm text-gray-400 dark:text-slate-500">
            {config.branding.disclaimer}
          </p>
        </section>
      </div>

      {/* CTA */}
      <div className="mt-12 text-center">
        <Link
          href={`/${state}`}
          className="inline-flex items-center px-6 py-3 bg-teal-600 text-white rounded-lg font-semibold hover:bg-teal-700 transition-colors"
        >
          Find Colleges Near You
        </Link>
      </div>
    </div>
  );
}

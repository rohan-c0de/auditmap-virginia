import type { Metadata } from "next";
import Link from "next/link";
import SearchForm from "@/components/SearchForm";
import StartingSoonCallout from "@/components/StartingSoonCallout";
import NotifyBanner from "@/components/NotifyBanner";
import { getNextTerm } from "@/lib/terms";
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
  const b = config.branding;
  return {
    title: `${b.siteName} — Community College Course Finder`,
    description: b.tagline,
    keywords: b.metaKeywords,
  };
}

export default async function HomePage({ params }: Props) {
  const { state } = await params;
  const config = getStateConfig(state);
  const nextTerm = await getNextTerm(state);

  return (
    <div>
      {/* Search section */}
      <section id="search" className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto text-center">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-slate-100 mb-4">
            Find {config.name} Community College Courses
          </h1>
          <p className="text-lg text-gray-600 dark:text-slate-400 mb-8">
            Search by zip code to find nearby {config.systemName} colleges,
            browse courses, check transfer equivalencies, and build your
            schedule.
          </p>
          <SearchForm
            state={state}
            placeholder={`e.g. ${config.defaultZip} or ${config.defaultZipCity}`}
          />
          <StartingSoonCallout state={state} />
        </div>
      </section>

      {/* How it works */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-gray-50 dark:bg-slate-800">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-slate-100 text-center mb-12">
            How It Works
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-12 h-12 bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300 rounded-full flex items-center justify-center mx-auto mb-4 text-xl font-bold">
                1
              </div>
              <h3 className="font-semibold text-gray-900 dark:text-slate-100 mb-2">
                Find a College
              </h3>
              <p className="text-gray-600 dark:text-slate-400 text-sm">
                Enter your zip code to find nearby community colleges. Browse
                courses, check transfer info, and compare schedules.
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300 rounded-full flex items-center justify-center mx-auto mb-4 text-xl font-bold">
                2
              </div>
              <h3 className="font-semibold text-gray-900 dark:text-slate-100 mb-2">
                Choose a Course
              </h3>
              <p className="text-gray-600 dark:text-slate-400 text-sm">
                Browse current course listings with schedules, locations, and
                delivery modes. Filter by subject, day, or format.
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300 rounded-full flex items-center justify-center mx-auto mb-4 text-xl font-bold">
                3
              </div>
              <h3 className="font-semibold text-gray-900 dark:text-slate-100 mb-2">
                Plan Your Path
              </h3>
              <p className="text-gray-600 dark:text-slate-400 text-sm">
                Check transfer equivalencies, build a weekly schedule, or find
                audit policies — all before you register.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Highlights — compact cards for key info */}
      <section className="py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto space-y-4">
          {/* Senior waiver — compact card */}
          {config.seniorWaiver && (
            <div className="flex items-start gap-4 rounded-xl border border-teal-200 dark:border-teal-800 bg-teal-50/50 dark:bg-teal-900/20 px-5 py-4">
              <div className="shrink-0 flex h-10 w-10 items-center justify-center rounded-full bg-teal-100 dark:bg-teal-900/50 text-teal-600 dark:text-teal-400 mt-0.5">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.438 60.438 0 00-.491 6.347A48.62 48.62 0 0112 20.904a48.62 48.62 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.636 50.636 0 00-2.658-.813A59.906 59.906 0 0112 3.493a59.903 59.903 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-teal-900 dark:text-teal-200">
                  {config.seniorWaiver.ageThreshold}+ in {config.name}? Tuition may be waived.
                </p>
                <p className="text-sm text-teal-800 dark:text-teal-300 mt-0.5">
                  {config.seniorWaiver.bannerDetail}
                </p>
                <Link
                  href={`/${state}/about`}
                  className="inline-block mt-1.5 text-xs font-medium text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 transition-colors"
                >
                  Learn more about the waiver &rarr;
                </Link>
              </div>
            </div>
          )}

          {/* Notify banner */}
          <NotifyBanner nextTerm={nextTerm.label} state={state} />
        </div>
      </section>

      {/* What you can do */}
      <section className="py-12 px-4 sm:px-6 lg:px-8 bg-gray-50 dark:bg-slate-800">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-slate-100 mb-8 text-center">
            What You Can Do
          </h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <Link
              href={`/${state}/courses`}
              className="group rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 transition hover:border-teal-300 dark:hover:border-teal-700 hover:shadow-sm"
            >
              <h3 className="font-semibold text-gray-900 dark:text-slate-100 group-hover:text-teal-600 transition-colors mb-1">
                Search All Courses
              </h3>
              <p className="text-sm text-gray-600 dark:text-slate-400">
                Search across all {config.collegeCount} {config.systemName} colleges at once by subject, keyword, or course number.
              </p>
            </Link>
            {config.transferSupported && (
              <Link
                href={`/${state}/transfer`}
                className="group rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 transition hover:border-teal-300 dark:hover:border-teal-700 hover:shadow-sm"
              >
                <h3 className="font-semibold text-gray-900 dark:text-slate-100 group-hover:text-teal-600 transition-colors mb-1">
                  Transfer Lookup
                </h3>
                <p className="text-sm text-gray-600 dark:text-slate-400">
                  See how community college courses map to universities — direct match or elective credit — before you enroll.
                </p>
              </Link>
            )}
            <Link
              href={`/${state}/schedule`}
              className="group rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 transition hover:border-teal-300 dark:hover:border-teal-700 hover:shadow-sm"
            >
              <h3 className="font-semibold text-gray-900 dark:text-slate-100 group-hover:text-teal-600 transition-colors mb-1">
                Schedule Builder
              </h3>
              <p className="text-sm text-gray-600 dark:text-slate-400">
                Build a weekly schedule across multiple colleges and spot conflicts before you register.
              </p>
            </Link>
            <Link
              href={`/${state}/colleges`}
              className="group rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 transition hover:border-teal-300 dark:hover:border-teal-700 hover:shadow-sm"
            >
              <h3 className="font-semibold text-gray-900 dark:text-slate-100 group-hover:text-teal-600 transition-colors mb-1">
                Browse All Colleges
              </h3>
              <p className="text-sm text-gray-600 dark:text-slate-400">
                View audit policies, senior waivers, course counts, and campus info for every {config.systemName} college.
              </p>
            </Link>
          </div>
          <p className="text-center text-sm text-gray-500 dark:text-slate-400 mt-6">
            Or{" "}
            <Link
              href="/colleges"
              className="text-teal-600 hover:text-teal-700 transition-colors"
            >
              browse colleges in all {getAllStates().length} states
            </Link>
          </p>
        </div>
      </section>

      {/* Explore other states */}
      <section className="py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-4 text-center">
            Explore Other States
          </h2>
          <div className="flex flex-wrap justify-center gap-2">
            {getAllStates()
              .filter((s) => s.slug !== state)
              .map((s) => (
                <Link
                  key={s.slug}
                  href={`/${s.slug}`}
                  className="rounded-md bg-gray-100 dark:bg-slate-700 px-3 py-1.5 text-sm text-gray-700 dark:text-slate-300 hover:bg-teal-100 dark:hover:bg-teal-900/40 hover:text-teal-700 dark:hover:text-teal-400 transition-colors"
                >
                  {s.name}
                </Link>
              ))}
          </div>
        </div>
      </section>
    </div>
  );
}

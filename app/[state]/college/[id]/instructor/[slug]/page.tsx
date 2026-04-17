/**
 * Instructor detail pSEO page.
 *
 * Lists every section taught by an instructor at a specific college.
 * Route: /[state]/college/[id]/instructor/[slug]
 *
 * Uses ISR (revalidate = 604800). Pages are rendered on-demand and cached
 * for 7 days, same pattern as course/subject pSEO pages.
 */

import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { loadInstitutions } from "@/lib/institutions";
import { getCurrentTerm, termLabel } from "@/lib/terms";
import { getAvailableTerms } from "@/lib/courses";
import { getStateConfig, isValidState } from "@/lib/states/registry";
import { getInstructorBySlug, getTopInstructors, type InstructorProfile } from "@/lib/instructors";
import { subjectName } from "@/lib/subjects";
import type { CourseSection } from "@/lib/types";
import AdUnit from "@/components/AdUnit";
import TrackView from "@/components/TrackView";

export const revalidate = 604800; // 7 days — pSEO content rarely changes

type PageProps = {
  params: Promise<{ state: string; id: string; slug: string }>;
};

// All pages generated on-demand via ISR
export async function generateStaticParams() {
  return [];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find the instructor across terms — try current term first, fall back to
 * earlier terms that have data for this college. Same pattern the college
 * detail page uses for course data.
 */
async function findInstructor(
  collegeSlug: string,
  state: string,
  slug: string
): Promise<{ profile: InstructorProfile; term: string } | null> {
  const currentTerm = await getCurrentTerm(state);
  const profile = await getInstructorBySlug(collegeSlug, currentTerm, state, slug);
  if (profile) return { profile, term: currentTerm };

  // Fall back to earlier terms
  const allTerms = await getAvailableTerms(state);
  for (const t of [...allTerms].reverse()) {
    if (t === currentTerm) continue;
    const p = await getInstructorBySlug(collegeSlug, t, state, slug);
    if (p) return { profile: p, term: t };
  }
  return null;
}

const MODE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  "in-person": { bg: "bg-emerald-50 dark:bg-emerald-900/30", text: "text-emerald-700 dark:text-emerald-400", label: "In-Person" },
  online: { bg: "bg-blue-50 dark:bg-blue-900/30", text: "text-blue-700 dark:text-blue-400", label: "Online" },
  hybrid: { bg: "bg-purple-50 dark:bg-purple-900/30", text: "text-purple-700 dark:text-purple-400", label: "Hybrid" },
  zoom: { bg: "bg-sky-50 dark:bg-sky-900/30", text: "text-sky-700 dark:text-sky-400", label: "Zoom" },
};

function isValidTime(t: string): boolean {
  return !!t && t !== "TBA" && t !== "0:00 AM" && t !== "0:00 PM";
}

function expandDays(days: string): string {
  if (!days || !days.trim()) return "";
  const DAY_MAP: Record<string, string> = {
    M: "Mon", Tu: "Tue", W: "Wed", Th: "Thu", F: "Fri", Sa: "Sat", Su: "Sun",
    TH: "Thu", SU: "Sun", TU: "Tue", SA: "Sat",
  };
  const result: string[] = [];
  let i = 0;
  const cleaned = days.replace(/[,\s]+/g, "").trim();
  while (i < cleaned.length) {
    if (i + 1 < cleaned.length) {
      const two = cleaned.substring(i, i + 2);
      if (DAY_MAP[two]) { result.push(DAY_MAP[two]); i += 2; continue; }
    }
    const one = cleaned[i];
    if (DAY_MAP[one]) result.push(DAY_MAP[one]);
    i++;
  }
  return result.join(" ");
}

function formatSchedule(s: CourseSection): string {
  const hasTime = isValidTime(s.start_time) && isValidTime(s.end_time);
  if (!s.days && !hasTime) return "Asynchronous / Online";
  const days = s.days ? expandDays(s.days) : "";
  const time = hasTime ? `${s.start_time}\u2013${s.end_time}` : "";
  if (days && time) return `${days} ${time}`;
  return days || time || "Asynchronous / Online";
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const { state, id, slug } = await props.params;
  if (!isValidState(state)) return { title: "Not Found" };

  const institutions = loadInstitutions(state);
  const institution = institutions.find((i) => i.id === id);
  if (!institution) return { title: "Not Found" };

  const config = getStateConfig(state);
  const result = await findInstructor(institution.college_slug, state, slug);
  if (!result) return { title: "Not Found" };
  const { profile, term: resolvedTerm } = result;

  const subjects = Array.from(
    new Set(profile.sections.map((s) => s.course_prefix))
  ).sort();
  const subjectLabels = subjects.map((p) => subjectName(p)).join(", ");
  const term = termLabel(resolvedTerm);

  const title = `${profile.displayName} — ${institution.name} Instructor`;
  const description = `Browse ${profile.sections.length} sections taught by ${profile.displayName} at ${institution.name} for ${term}. Subjects: ${subjectLabels}. Compare schedules and availability.`;

  const canonical = `${process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com"}/${state}/college/${id}/instructor/${slug}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      type: "profile",
      siteName: config.branding.siteName,
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function InstructorPage(props: PageProps) {
  const { state, id, slug } = await props.params;
  if (!isValidState(state)) notFound();

  const institutions = loadInstitutions(state);
  const institution = institutions.find((i) => i.id === id);
  if (!institution) notFound();

  const config = getStateConfig(state);
  const result = await findInstructor(institution.college_slug, state, slug);
  if (!result) notFound();
  const { profile, term: resolvedTerm } = result;

  const { sections } = profile;
  const term = termLabel(resolvedTerm);

  // Subjects taught
  const subjectCounts = new Map<string, number>();
  for (const s of sections) {
    subjectCounts.set(
      s.course_prefix,
      (subjectCounts.get(s.course_prefix) || 0) + 1
    );
  }
  const subjects = Array.from(subjectCounts.entries()).sort(
    (a, b) => b[1] - a[1]
  );

  // Unique courses
  const uniqueCourses = new Set(
    sections.map((s) => `${s.course_prefix} ${s.course_number}`)
  ).size;

  // Mode breakdown
  const modeBreakdown: Record<string, number> = {};
  for (const s of sections) {
    modeBreakdown[s.mode] = (modeBreakdown[s.mode] || 0) + 1;
  }

  // Sort sections: by prefix, then number, then start_time
  const sortedSections = [...sections].sort((a, b) => {
    const prefixCmp = a.course_prefix.localeCompare(b.course_prefix);
    if (prefixCmp !== 0) return prefixCmp;
    const numCmp = a.course_number.localeCompare(b.course_number);
    if (numCmp !== 0) return numCmp;
    return (a.start_time || "").localeCompare(b.start_time || "");
  });

  // Other instructors at this college (top 20, excluding current)
  const topInstructors = await getTopInstructors(
    institution.college_slug,
    resolvedTerm,
    state,
    21
  );
  const otherInstructors = topInstructors
    .filter((i) => i.slug !== slug)
    .slice(0, 20);

  // Seats summary
  const totalSeats = sections.reduce(
    (sum, s) => sum + (s.seats_open ?? 0),
    0
  );
  const sectionsWithSeats = sections.filter(
    (s) => s.seats_open !== null && s.seats_open > 0
  ).length;

  // JSON-LD
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: profile.displayName,
    jobTitle: "Instructor",
    worksFor: {
      "@type": "EducationalOrganization",
      name: institution.name,
      url: `${siteUrl}/${state}/college/${id}`,
    },
    teaches: subjects.slice(0, 10).map(([prefix, count]) => ({
      "@type": "Course",
      name: subjectName(prefix),
      courseCode: prefix,
      description: `${count} sections`,
    })),
  };

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: config.name,
        item: `${siteUrl}/${state}`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: institution.name,
        item: `${siteUrl}/${state}/college/${id}`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: profile.displayName,
        item: `${siteUrl}/${state}/college/${id}/instructor/${slug}`,
      },
    ],
  };

  // RMP search link
  const rmpUrl = `https://www.ratemyprofessors.com/search/professors?q=${encodeURIComponent(profile.displayName)}`;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />

      <TrackView
        event="instructor_page_view"
        params={{
          state,
          college: id,
          instructor: profile.displayName,
          sections: sections.length,
          subjects: subjects.length,
        }}
      />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-slate-400 mb-6">
          <Link
            href={`/${state}`}
            className="hover:text-teal-600 dark:hover:text-teal-400"
          >
            {config.name}
          </Link>
          <span>/</span>
          <Link
            href={`/${state}/college/${id}`}
            className="hover:text-teal-600 dark:hover:text-teal-400"
          >
            {institution.name}
          </Link>
          <span>/</span>
          <span className="text-gray-900 dark:text-slate-100 font-medium">
            {profile.displayName}
          </span>
        </nav>

        {/* Header */}
        <div className="mb-8">
          <p className="text-sm font-medium text-teal-600 dark:text-teal-400 mb-1">
            Instructor
          </p>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-slate-100">
            {profile.displayName}
          </h1>
          <p className="text-gray-600 dark:text-slate-400 mt-1.5">
            <Link
              href={`/${state}/college/${id}`}
              className="text-teal-600 dark:text-teal-400 hover:underline"
            >
              {institution.name}
            </Link>
            {" "}&middot;{" "}
            <span className="font-semibold text-gray-900 dark:text-slate-100">
              {sections.length}
            </span>{" "}
            {sections.length === 1 ? "section" : "sections"} &middot;{" "}
            <span className="font-semibold text-gray-900 dark:text-slate-100">
              {uniqueCourses}
            </span>{" "}
            {uniqueCourses === 1 ? "course" : "courses"} &middot;{" "}
            <span className="text-gray-400 dark:text-slate-500">{term}</span>
          </p>
          {sectionsWithSeats > 0 && (
            <p className="text-emerald-600 dark:text-emerald-400 text-sm mt-1">
              {totalSeats} {totalSeats === 1 ? "seat" : "seats"} open across{" "}
              {sectionsWithSeats}{" "}
              {sectionsWithSeats === 1 ? "section" : "sections"}
            </p>
          )}
        </div>

        {/* Subjects taught */}
        <div className="flex flex-wrap gap-2 mb-6">
          {subjects.map(([prefix, count]) => (
            <Link
              key={prefix}
              href={`/${state}/college/${id}/courses/${prefix.toLowerCase()}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-slate-300 hover:bg-teal-100 dark:hover:bg-teal-900/40 hover:text-teal-700 dark:hover:text-teal-400 transition-colors"
            >
              <span>{subjectName(prefix)}</span>
              <span className="text-gray-400 dark:text-slate-500">
                ({prefix})
              </span>
              <span className="rounded-full bg-gray-200 dark:bg-slate-700 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600 dark:text-slate-400">
                {count}
              </span>
            </Link>
          ))}
        </div>

        {/* Mode breakdown */}
        <div className="flex flex-wrap gap-1.5 mb-8">
          {Object.entries(modeBreakdown).map(([mode, count]) => {
            const style = MODE_STYLES[mode] || MODE_STYLES["in-person"];
            return (
              <span
                key={mode}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${style.bg} ${style.text}`}
              >
                {style.label}: {count}
              </span>
            );
          })}
        </div>

        {/* Sections table */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-3">
            Sections Taught
          </h2>
          <div className="rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-900">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 dark:bg-slate-800 text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-medium">CRN</th>
                  <th className="px-3 py-2 font-medium">Course</th>
                  <th className="px-3 py-2 font-medium">Title</th>
                  <th className="px-3 py-2 font-medium">Schedule</th>
                  <th className="px-3 py-2 font-medium">Campus</th>
                  <th className="px-3 py-2 font-medium">Mode</th>
                  <th className="px-3 py-2 font-medium">Seats</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-slate-700">
                {sortedSections.map((s) => {
                  const style =
                    MODE_STYLES[s.mode] || MODE_STYLES["in-person"];
                  return (
                    <tr
                      key={`${s.crn}-${s.start_time}`}
                      className="hover:bg-gray-50 dark:hover:bg-slate-800"
                    >
                      <td className="px-3 py-2 font-mono text-gray-600 dark:text-slate-400">
                        {s.crn}
                      </td>
                      <td className="px-3 py-2 font-mono font-medium">
                        <Link
                          href={`/${state}/course/${s.course_prefix.toLowerCase()}-${s.course_number.toLowerCase()}`}
                          className="text-teal-600 dark:text-teal-400 hover:underline"
                        >
                          {s.course_prefix} {s.course_number}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-gray-700 dark:text-slate-300 max-w-[200px] truncate">
                        {s.course_title}
                      </td>
                      <td className="px-3 py-2 text-gray-700 dark:text-slate-300">
                        {formatSchedule(s)}
                      </td>
                      <td className="px-3 py-2 text-gray-600 dark:text-slate-400">
                        {s.campus || "---"}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${style.bg} ${style.text}`}
                        >
                          {style.label}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {s.seats_open !== null && s.seats_open !== undefined ? (
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              s.seats_open > 10
                                ? "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400"
                                : s.seats_open > 0
                                  ? "bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400"
                                  : "bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                            }`}
                          >
                            {s.seats_open}
                            {s.seats_total ? `/${s.seats_total}` : ""}
                          </span>
                        ) : (
                          <span className="text-[10px] text-gray-400 dark:text-slate-500">
                            &mdash;
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* In-content ad */}
        <div className="mb-8">
          <AdUnit slot="7261548390" format="auto" className="min-h-[100px]" />
        </div>

        {/* Rate My Professors link */}
        <div className="mb-8 rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 px-4 py-3">
          <p className="text-sm text-gray-600 dark:text-slate-400">
            Looking for reviews?{" "}
            <a
              href={rmpUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-teal-600 dark:text-teal-400 hover:underline font-medium"
            >
              Search for {profile.displayName} on Rate My Professors &rarr;
            </a>
          </p>
        </div>

        {/* Other instructors at this college */}
        {otherInstructors.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-3">
              Other Instructors at {institution.name}
            </h2>
            <div className="flex flex-wrap gap-2">
              {otherInstructors.map((inst) => (
                <Link
                  key={inst.slug}
                  href={`/${state}/college/${id}/instructor/${inst.slug}`}
                  className="rounded-full border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-slate-300 hover:border-teal-300 dark:hover:border-teal-700 hover:text-teal-700 dark:hover:text-teal-400 transition"
                >
                  {inst.displayName}
                  <span className="text-gray-400 dark:text-slate-500 ml-1">
                    ({inst.sectionCount})
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Quick links */}
        <div className="flex flex-wrap gap-3 pt-4 border-t border-gray-100 dark:border-slate-800 text-sm">
          <Link
            href={`/${state}/college/${id}`}
            className="text-teal-600 dark:text-teal-400 hover:underline"
          >
            &larr; Back to {institution.name}
          </Link>
          <Link
            href={`/${state}/courses`}
            className="text-teal-600 dark:text-teal-400 hover:underline"
          >
            Search courses
          </Link>
          <Link
            href={`/${state}/schedule`}
            className="text-teal-600 dark:text-teal-400 hover:underline"
          >
            Schedule Builder
          </Link>
        </div>
      </div>
    </>
  );
}

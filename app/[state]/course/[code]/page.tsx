import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { loadInstitutions } from "@/lib/institutions";
import { loadCourseByCode, loadCoursesBySubject } from "@/lib/courses";
import { getCurrentTerm, termLabel } from "@/lib/terms";
import { getStateConfig, getAllStates, isValidState } from "@/lib/states/registry";
import { getTransferInfo, getUniversities } from "@/lib/transfer";
import { subjectName } from "@/lib/subjects";
import type { CourseSection } from "@/lib/types";
import AdUnit from "@/components/AdUnit";
import TrackView from "@/components/TrackView";

export const revalidate = 604800; // 7 days — pSEO content rarely changes

type PageProps = {
  params: Promise<{ state: string; code: string }>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseCode(code: string): { prefix: string; number: string } | null {
  // Loose match so every real course number in the dataset round-trips:
  //   - VA/NC/SC/GA/TN/ME 3-5 digit, optional 1-3 letter suffix (`MTH-263`,
  //     `BIO-101L`)
  //   - NY (CUNY) 2-digit (`ESE-11`)
  //   - DE letter-first (`IDT-G01`)
  //   - DC law-school style (`LAW-L204`)
  //   - MD alpha-only (`MATH-A`, `ESOL-LA`)
  //   - VT hyphenated (`EDU-GTEW1`)
  // The prior strict `/^([A-Z]{2,5})-(\d{3,5}[A-Z]{0,3})$/` regex rejected
  // 455 valid course codes, causing `notFound()` to fire on URLs that
  // Google had indexed — a Soft 404 flood in Search Console.
  const match = code.toUpperCase().match(/^([A-Z]{2,5})-([A-Z0-9-]{1,10})$/);
  if (!match) return null;
  return { prefix: match[1], number: match[2] };
}

interface CollegeOffering {
  slug: string;
  name: string;
  auditAllowed: boolean | null;
  sections: CourseSection[];
  modeBreakdown: Record<string, number>;
}

function groupByCollege(
  sections: CourseSection[],
  institutions: ReturnType<typeof loadInstitutions>
): CollegeOffering[] {
  const map = new Map<string, CourseSection[]>();
  for (const s of sections) {
    if (!map.has(s.college_code)) map.set(s.college_code, []);
    map.get(s.college_code)!.push(s);
  }

  const result: CollegeOffering[] = [];
  for (const [code, secs] of map) {
    const inst = institutions.find((i) => i.college_slug === code || i.id === code);
    const modeBreakdown: Record<string, number> = {};
    for (const s of secs) {
      modeBreakdown[s.mode] = (modeBreakdown[s.mode] || 0) + 1;
    }
    result.push({
      slug: inst?.id || code,
      name: inst?.name || code,
      auditAllowed: inst?.audit_policy?.allowed ?? null,
      sections: secs,
      modeBreakdown,
    });
  }

  // Sort by section count descending
  result.sort((a, b) => b.sections.length - a.sections.length);
  return result;
}

function isValidTime(t: string): boolean {
  return !!t && t !== "TBA" && t !== "0:00 AM" && t !== "0:00 PM";
}

function expandDays(days: string): string {
  if (!days || !days.trim()) return "";
  const DAY_MAP: Record<string, string> = {
    M: "Mon", Tu: "Tue", W: "Wed", Th: "Thu", F: "Fri", Sa: "Sat", Su: "Sun",
    TH: "Thu", SU: "Sun", TU: "Tue", SA: "Sat",
  };
  // Parse two-char abbreviations first, then single-char
  const result: string[] = [];
  let i = 0;
  // Normalize: strip commas, extra whitespace
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
// Static params — generate one page per (state, unique course)
// ---------------------------------------------------------------------------

// Return empty — all 25k+ course pages are generated on-demand via ISR
// (revalidate = 604800). The sitemap still lists every URL so Google finds them.
export async function generateStaticParams() {
  return [];
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const { state, code } = await props.params;
  if (!isValidState(state)) return { title: "Not Found" };

  const parsed = parseCode(code);
  if (!parsed) return { title: "Not Found" };

  const config = getStateConfig(state);
  const currentTerm = await getCurrentTerm(state);
  const sections = await loadCourseByCode(parsed.prefix, parsed.number, currentTerm, state);

  if (sections.length === 0) return { title: "Not Found" };

  const title = sections[0].course_title;
  const credits = sections[0].credits;
  const collegeCount = new Set(sections.map((s) => s.college_code)).size;
  const onlineCount = sections.filter((s) => s.mode === "online" || s.mode === "zoom").length;
  const term = termLabel(currentTerm);

  const pageTitle = `${parsed.prefix} ${parsed.number}: ${title} — ${config.name} Community Colleges`;
  const description = `Find ${parsed.prefix} ${parsed.number} (${title}, ${credits} credits) at ${collegeCount} ${config.systemName} colleges for ${term}. ${sections.length} sections available${onlineCount > 0 ? `, ${onlineCount} online` : ""}. Compare schedules, check seats, and see transfer equivalencies.`;

  const canonical = `${process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com"}/${state}/course/${code}`;

  return {
    title: pageTitle,
    description,
    alternates: { canonical },
    openGraph: {
      title: pageTitle,
      description,
      url: canonical,
      type: "website",
      siteName: config.branding.siteName,
    },
    twitter: {
      card: "summary_large_image",
      title: pageTitle,
      description,
    },
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const MODE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  "in-person": { bg: "bg-emerald-50 dark:bg-emerald-900/30", text: "text-emerald-700 dark:text-emerald-400", label: "In-Person" },
  online: { bg: "bg-blue-50 dark:bg-blue-900/30", text: "text-blue-700 dark:text-blue-400", label: "Online" },
  hybrid: { bg: "bg-purple-50 dark:bg-purple-900/30", text: "text-purple-700 dark:text-purple-400", label: "Hybrid" },
  zoom: { bg: "bg-sky-50 dark:bg-sky-900/30", text: "text-sky-700 dark:text-sky-400", label: "Zoom" },
};

const TRANSFER_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  direct: { bg: "bg-green-50 dark:bg-green-900/30", text: "text-green-700 dark:text-green-400", label: "Direct Match" },
  elective: { bg: "bg-amber-50 dark:bg-amber-900/30", text: "text-amber-700 dark:text-amber-400", label: "Elective Credit" },
  "no-credit": { bg: "bg-red-50 dark:bg-red-900/30", text: "text-red-700 dark:text-red-400", label: "No Credit" },
};

export default async function CoursePage(props: PageProps) {
  const { state, code } = await props.params;
  if (!isValidState(state)) notFound();

  const parsed = parseCode(code);
  if (!parsed) notFound();

  const { prefix, number } = parsed;
  const config = getStateConfig(state);
  const institutions = loadInstitutions(state);
  const currentTerm = await getCurrentTerm(state);

  // Pull only this subject's rows once and split — used for both the target
  // course's sections and the "Related courses" sidebar (same prefix).
  const subjectSections = await loadCoursesBySubject(prefix, currentTerm, state);
  const sections = subjectSections.filter((c) => c.course_number === number);

  if (sections.length === 0) notFound();

  const courseTitle = sections[0].course_title;
  const credits = sections[0].credits;
  const prereqText = sections[0].prerequisite_text;
  const prereqCourses = sections[0].prerequisite_courses || [];
  const term = termLabel(currentTerm);

  // Group by college
  const colleges = groupByCollege(sections, institutions);

  // Mode breakdown across all sections
  const modeBreakdown: Record<string, number> = {};
  for (const s of sections) {
    modeBreakdown[s.mode] = (modeBreakdown[s.mode] || 0) + 1;
  }

  // Transfer data
  const transferInfo = config.transferSupported
    ? await getTransferInfo(prefix, number, state)
    : [];
  const universities = config.transferSupported
    ? await getUniversities(state)
    : [];
  const uniNameMap = new Map(universities.map((u) => [u.slug, u.name]));

  // Related courses — same prefix, different number
  const relatedCourses = new Map<string, string>();
  for (const c of subjectSections) {
    if (c.course_number !== number) {
      const key = `${c.course_prefix}-${c.course_number}`;
      if (!relatedCourses.has(key)) {
        relatedCourses.set(key, c.course_title);
      }
    }
  }
  const related = Array.from(relatedCourses.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 12);

  // Seats summary
  const totalSeats = sections.reduce((sum, s) => sum + (s.seats_open ?? 0), 0);
  const sectionsWithSeats = sections.filter((s) => s.seats_open !== null && s.seats_open > 0).length;

  // JSON-LD
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Course",
    name: `${prefix} ${number}: ${courseTitle}`,
    description: `${courseTitle} (${credits} credits) offered at ${colleges.length} ${config.systemName} community colleges.`,
    provider: {
      "@type": "Organization",
      name: config.systemFullName,
    },
    numberOfCredits: credits,
    educationalLevel: "Community College",
    isAccessibleForFree: false,
    inLanguage: "en",
    hasCourseInstance: colleges.slice(0, 10).map((c) => ({
      "@type": "CourseInstance",
      name: `${prefix} ${number} at ${c.name}`,
      courseMode: c.sections.some((s) => s.mode === "online") ? "online" : "onsite",
      location: {
        "@type": "Place",
        name: c.name,
      },
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
        name: "Courses",
        item: `${siteUrl}/${state}/courses`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: `${prefix} ${number}`,
        item: `${siteUrl}/${state}/course/${code}`,
      },
    ],
  };

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
        event="course_detail_view"
        params={{
          state,
          course: `${prefix} ${number}`,
          prefix,
          sections: sections.length,
          colleges: colleges.length,
        }}
      />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-slate-400 mb-6">
          <Link href={`/${state}`} className="hover:text-teal-600 dark:hover:text-teal-400">
            {config.name}
          </Link>
          <span>/</span>
          <Link href={`/${state}/courses`} className="hover:text-teal-600 dark:hover:text-teal-400">
            Courses
          </Link>
          <span>/</span>
          <span className="text-gray-900 dark:text-slate-100 font-medium">
            {prefix} {number}
          </span>
        </nav>

        {/* Header */}
        <div className="mb-8">
          <p className="text-sm font-medium text-teal-600 dark:text-teal-400 mb-1">
            {subjectName(prefix)}
          </p>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-slate-100">
            {prefix} {number}
            <span className="font-normal text-gray-500 dark:text-slate-400 text-2xl ml-2">
              {courseTitle}
            </span>
          </h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-sm text-gray-600 dark:text-slate-400">
            <span className="font-medium text-gray-900 dark:text-slate-100">
              {credits} {credits === 1 ? "credit" : "credits"}
            </span>
            <span>
              <span className="font-semibold text-gray-900 dark:text-slate-100">{sections.length}</span>{" "}
              {sections.length === 1 ? "section" : "sections"} at{" "}
              <span className="font-semibold text-gray-900 dark:text-slate-100">{colleges.length}</span>{" "}
              {colleges.length === 1 ? "college" : "colleges"}
            </span>
            <span className="text-gray-400 dark:text-slate-500">{term}</span>
            {sectionsWithSeats > 0 && (
              <span className="text-emerald-600 dark:text-emerald-400">
                {totalSeats} {totalSeats === 1 ? "seat" : "seats"} open
              </span>
            )}
          </div>
        </div>

        {/* Mode breakdown + prereqs */}
        <div className="flex flex-wrap gap-4 mb-8">
          {/* Mode pills */}
          <div className="flex flex-wrap gap-1.5">
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

          {/* Prerequisites */}
          {prereqText && (
            <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 px-3 py-1.5 text-xs text-amber-800 dark:text-amber-300">
              <span className="font-medium">Prerequisite:</span> {prereqText}
              {prereqCourses.length > 0 && (
                <span className="ml-1">
                  (
                  {prereqCourses.map((pc, i) => {
                    const [pPrefix, pNumber] = pc.split(" ");
                    if (!pPrefix || !pNumber) return <span key={i}>{pc}</span>;
                    return (
                      <span key={i}>
                        {i > 0 && ", "}
                        <Link
                          href={`/${state}/course/${pPrefix.toLowerCase()}-${pNumber.toLowerCase()}`}
                          className="underline hover:text-amber-900 dark:hover:text-amber-200"
                        >
                          {pc}
                        </Link>
                      </span>
                    );
                  })}
                  )
                </span>
              )}
            </div>
          )}
        </div>

        {/* Transfer equivalencies */}
        {transferInfo.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-3">
              Transfer Equivalencies
            </h2>
            <div className="rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 dark:bg-slate-800 text-xs uppercase tracking-wider text-gray-500 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">University</th>
                    <th className="px-4 py-2.5 font-medium">Equivalent Course</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                  {transferInfo.map((t) => {
                    const type = t.no_credit
                      ? "no-credit"
                      : t.is_elective
                        ? "elective"
                        : "direct";
                    const badge = TRANSFER_BADGE[type];
                    return (
                      <tr key={t.university} className="hover:bg-gray-50 dark:hover:bg-slate-800">
                        <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-slate-100">
                          {t.no_credit ? (
                            uniNameMap.get(t.university) || t.university_name || t.university
                          ) : (
                            <Link
                              href={`/${state}/transfer/to/${t.university}`}
                              className="text-teal-700 dark:text-teal-400 hover:underline"
                            >
                              {uniNameMap.get(t.university) || t.university_name || t.university}
                            </Link>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-gray-600 dark:text-slate-400">
                          {t.no_credit ? (
                            <span className="text-gray-400 dark:text-slate-500">&mdash;</span>
                          ) : (
                            <>
                              <span className="font-medium text-gray-900 dark:text-slate-100">{t.univ_course}</span>
                              {t.univ_title && (
                                <span className="text-gray-500 dark:text-slate-400 ml-1">
                                  {t.univ_title}
                                </span>
                              )}
                            </>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${badge.bg} ${badge.text}`}>
                            {badge.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Availability by college */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-3">
            Available at {colleges.length} {colleges.length === 1 ? "college" : "colleges"}
          </h2>
          <div className="space-y-3">
            {colleges.map((college) => (
              <CollegeBlock key={college.slug} college={college} state={state} config={config} />
            ))}
          </div>
        </section>

        {/* In-content ad (after high-value college availability table) */}
        <div className="mb-8">
          <AdUnit slot="7261548390" format="auto" className="min-h-[100px]" />
        </div>

        {/* Related courses */}
        {related.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-3">
              More {subjectName(prefix)} Courses
            </h2>
            <div className="flex flex-wrap gap-2">
              {related.map(([key, title]) => (
                <Link
                  key={key}
                  href={`/${state}/course/${key.toLowerCase()}`}
                  className="rounded-full border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-slate-300 hover:border-teal-300 dark:hover:border-teal-700 hover:text-teal-700 dark:hover:text-teal-400 transition"
                  title={title}
                >
                  {key.replace("-", " ")}
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Quick links */}
        <div className="flex flex-wrap gap-3 pt-4 border-t border-gray-100 dark:border-slate-800 text-sm">
          <Link
            href={`/${state}/courses?q=${encodeURIComponent(`${prefix} ${number}`)}`}
            className="text-teal-600 dark:text-teal-400 hover:underline"
          >
            Search for this course
          </Link>
          <Link
            href={`/${state}/schedule?subjects=${prefix}+${number}`}
            className="text-teal-600 dark:text-teal-400 hover:underline"
          >
            Add to Schedule Builder
          </Link>
          {config.transferSupported && (
            <Link
              href={`/${state}/transfer?courses=${prefix}+${number}`}
              className="text-teal-600 dark:text-teal-400 hover:underline"
            >
              Check transfer options
            </Link>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// College block — expandable section for each college offering the course
// ---------------------------------------------------------------------------

function CollegeBlock({
  college,
  state,
  config,
}: {
  college: CollegeOffering;
  state: string;
  config: ReturnType<typeof getStateConfig>;
}) {
  const { sections } = college;

  return (
    <details className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden group">
      <summary className="px-5 py-3 flex items-center justify-between cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800 transition list-none [&::-webkit-details-marker]:hidden">
        <div className="flex items-center gap-3">
          <svg
            className="h-4 w-4 text-gray-400 dark:text-slate-500 transition-transform group-open:rotate-90"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <div>
            <span className="font-medium text-gray-900 dark:text-slate-100 text-sm">
              {college.name}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {college.auditAllowed && (
            <span className="rounded-full bg-green-50 dark:bg-green-900/30 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:text-green-400">
              Audit OK
            </span>
          )}
          {Object.entries(college.modeBreakdown).map(([mode, count]) => {
            const style = MODE_STYLES[mode] || MODE_STYLES["in-person"];
            return (
              <span
                key={mode}
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${style.bg} ${style.text}`}
              >
                {count} {style.label}
              </span>
            );
          })}
          <span className="text-xs text-gray-500 dark:text-slate-400">
            {sections.length} {sections.length === 1 ? "section" : "sections"}
          </span>
        </div>
      </summary>

      <div className="px-5 pb-4">
        <div className="rounded-lg border border-gray-100 dark:border-slate-700 overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 dark:bg-slate-800 text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2 font-medium">CRN</th>
                <th className="px-3 py-2 font-medium">Schedule</th>
                <th className="px-3 py-2 font-medium">Instructor</th>
                <th className="px-3 py-2 font-medium">Campus</th>
                <th className="px-3 py-2 font-medium">Mode</th>
                <th className="px-3 py-2 font-medium">Seats</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-700">
              {sections.map((s) => {
                const style = MODE_STYLES[s.mode] || MODE_STYLES["in-person"];
                return (
                  <tr key={`${s.crn}-${s.start_time}`} className="hover:bg-gray-50 dark:hover:bg-slate-800">
                    <td className="px-3 py-2 font-mono text-gray-600 dark:text-slate-400">
                      {s.crn}
                    </td>
                    <td className="px-3 py-2 text-gray-700 dark:text-slate-300">
                      {formatSchedule(s)}
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-slate-400">
                      {s.instructor || "TBA"}
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-slate-400">
                      {s.campus || "---"}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${style.bg} ${style.text}`}>
                        {style.label}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {s.seats_open !== null && s.seats_open !== undefined ? (
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          s.seats_open > 10
                            ? "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400"
                            : s.seats_open > 0
                              ? "bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400"
                              : "bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                        }`}>
                          {s.seats_open}{s.seats_total ? `/${s.seats_total}` : ""}
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-400 dark:text-slate-500">&mdash;</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* College actions */}
        <div className="mt-2 flex gap-4">
          <Link
            href={`/${state}/college/${college.slug}`}
            className="text-xs font-medium text-teal-600 dark:text-teal-400 hover:underline"
          >
            College Details
          </Link>
          {config.courseDiscoveryUrl && (
            <a
              href={config.courseDiscoveryUrl(college.slug, sections[0].course_prefix, sections[0].course_number, sections[0].term)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300 hover:underline"
            >
              View on {config.systemName} &rarr;
            </a>
          )}
        </div>
      </div>
    </details>
  );
}

import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { loadInstitutions } from "@/lib/institutions";
import { loadCourseByCode, loadSubjectCourseList } from "@/lib/courses";
import { getCurrentTerm, termLabel } from "@/lib/terms";
import { getAllStates, isValidState, getStateConfig } from "@/lib/states/registry";
import { requireStateConfig } from "@/lib/states/route-helpers";
import { getTransferInfo, getUniversities } from "@/lib/transfer";
import { subjectName } from "@/lib/subjects";
import { getBestProgramForPrefix } from "@/lib/programs/registry";
import { getQualifyingProgramSlugs } from "@/lib/programs";
import { loadStateSummary } from "@/lib/state-summary";
import { computeCourseAvailabilityProfile } from "@/lib/course-stats";
import type { CourseSection } from "@/lib/types";
import SectionHeading from "@/components/SectionHeading";
import AdUnit from "@/components/AdUnit";
import TrackView from "@/components/TrackView";
import RelatedBlogPosts from "@/components/RelatedBlogPosts";
import { getBlogRecommendations } from "@/lib/blog-recommendations";
import {
  getCourseLastUpdated,
  formatLastUpdated,
} from "@/lib/data-freshness";
import SectionSeats from "@/components/SectionSeats";
import { aggregateSeats, aggregateLabel } from "@/lib/seats";
import { courseHasFullSection } from "@/lib/seat-alert";
import SeatAlertCTA from "@/components/SeatAlertCTA";
import { buildCollegeCompareRows } from "@/lib/compare-colleges";
import CourseCollegeCompare from "@/components/CourseCollegeCompare";

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
  // No valid meeting time = no real schedule, regardless of the `days` field
  // (async/online rows arrive with an all-days "M T W Th F Sa Su" placeholder).
  if (!hasTime) return "No set meeting time";
  const days = s.days ? expandDays(s.days) : "";
  const time = `${s.start_time}\u2013${s.end_time}`;
  return days ? `${days} ${time}` : time;
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

  const config = requireStateConfig(state);
  const currentTerm = await getCurrentTerm(state);
  const sections = await loadCourseByCode(parsed.prefix, parsed.number, currentTerm, state);

  if (sections.length === 0) {
    // Course code is well-formed but has no sections this term. We render a
    // real page (with helpful links) instead of calling notFound() — see the
    // page body for why. Tell Google not to index it via robots metadata.
    return {
      title: `${parsed.prefix} ${parsed.number} — Not offered ${termLabel(currentTerm)} | ${config.branding.siteName}`,
      robots: { index: false, follow: true },
      alternates: {
        canonical: `${process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com"}/${state}/course/${code}`,
      },
    };
  }

  const title = sections[0].course_title;
  const credits = sections[0].credits;
  const collegeCount = new Set(sections.map((s) => s.college_code)).size;
  const onlineCount = sections.filter((s) => s.mode === "online" || s.mode === "zoom").length;
  const term = termLabel(currentTerm);

  const pageTitle = `${parsed.prefix} ${parsed.number}: ${title} — ${config.name} Community Colleges`;
  const description = `${parsed.prefix} ${parsed.number} (${title}, ${credits} ${credits === 1 ? "credit" : "credits"}) — ${sections.length} sections at all ${collegeCount} ${config.name} community colleges for ${term}${onlineCount > 0 ? `, ${onlineCount} online` : ""}. See schedules, open seats, and transfer credit.`;

  const canonical = `${process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com"}/${state}/course/${code}`;

  // Thin-content guard. The prior rule (noindex unless ≥3 sections, or ≥5 at a
  // single college) was too aggressive: a GSC audit (2026-06) found it had
  // noindexed 169 course pages that were actively ranking and earning clicks
  // before they were suppressed on 2026-05-11. A course offered at even one or
  // two sections is still a real, searchable course with unique content here
  // (its live sections + transfer verdicts + prereq chain + related courses),
  // and Google already declines to index the genuinely-empty long tail on its
  // own. So we now noindex only the absolute-thinnest case — a single section
  // at a single college — and index everything with more substance.
  const isThin = sections.length < 2 && collegeCount < 2;

  return {
    title: pageTitle,
    description,
    alternates: { canonical },
    ...(isThin && { robots: { index: false, follow: true } }),
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
  const config = requireStateConfig(state);
  const institutions = loadInstitutions(state);
  const currentTerm = await getCurrentTerm(state);

  // Two cheap, indexed reads instead of pulling the whole subject's sections:
  //  • this course's own sections via the (state,term,prefix,number) index
  //    (loadCourseByCode — also already cached from generateMetadata above), and
  //  • a tiny DISTINCT course list for the "Related courses" sidebar.
  // A big subject in a big state (CA Fall ENGL = 9,120 wide rows) used to be
  // pulled in full here, which tripped Vercel's 15s FUNCTION_INVOCATION_TIMEOUT.
  const [sections, subjectCourses] = await Promise.all([
    loadCourseByCode(prefix, number, currentTerm, state),
    loadSubjectCourseList(prefix, currentTerm, state),
  ]);

  if (sections.length === 0) {
    // The course code is well-formed and the state is valid — but no sections
    // exist for this term. We deliberately do NOT call notFound() here:
    // Next.js ISR caches notFound() responses as successful prerenders and
    // Vercel's CDN re-serves them as HTTP 200, which Google treats as a soft
    // 404. Instead we render a real page with helpful next-steps links and
    // rely on the noindex meta in generateMetadata() to keep these out of
    // Google's index.
    const relatedSubjectCourses = [...subjectCourses]
      .sort((a, b) => a.course_number.localeCompare(b.course_number))
      .slice(0, 12);
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-slate-100 mb-2">
          {prefix} {number}
        </h1>
        <p className="text-gray-600 dark:text-slate-400 mb-8">
          No sections of {prefix} {number} are scheduled at {config.systemName}{" "}
          colleges for {termLabel(currentTerm)}. The course may run a different
          term, or the catalog code may have changed.
        </p>
        {relatedSubjectCourses.length > 0 && (
          <section className="mb-8">
            <SectionHeading id="related-courses" className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-3">
              Other {subjectName(prefix)} courses this term
            </SectionHeading>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {relatedSubjectCourses.map((c) => (
                <li key={c.course_number}>
                  <Link
                    href={`/${state}/course/${prefix.toLowerCase()}-${c.course_number.toLowerCase()}`}
                    className="text-teal-700 dark:text-teal-400 hover:underline"
                  >
                    {prefix} {c.course_number} — {c.course_title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className="flex flex-wrap gap-3 mt-8">
          <Link
            href={`/${state}/subject/${prefix.toLowerCase()}`}
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 transition"
          >
            Browse all {subjectName(prefix)} courses
          </Link>
          <Link
            href={`/${state}`}
            className="rounded-lg border border-gray-300 dark:border-slate-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition"
          >
            {config.name} home
          </Link>
        </div>
      </div>
    );
  }

  const courseTitle = sections[0].course_title;
  const credits = sections[0].credits;
  const prereqText = sections[0].prerequisite_text;
  const prereqCourses = sections[0].prerequisite_courses || [];
  const term = termLabel(currentTerm);

  // Group by college
  const colleges = groupByCollege(sections, institutions);

  // Compare-colleges matrix: one honest, sortable row per offering college,
  // plus the in-state colleges that don't offer it this term.
  const compareRows = buildCollegeCompareRows(colleges);
  const offeringSlugs = new Set(colleges.map((c) => c.slug));
  const notOfferedColleges = institutions
    .filter((i) => !offeringSlugs.has(i.id))
    .map((i) => i.name)
    .sort();

  // Mode breakdown across all sections (consumed by the existing pill row)
  const modeBreakdown: Record<string, number> = {};
  for (const s of sections) {
    modeBreakdown[s.mode] = (modeBreakdown[s.mode] || 0) + 1;
  }

  // Course Availability Profile — server-rendered summary that gives the
  // page substantive unique content per term beyond the section table
  // (rendered later in this file). Consumed by the JSX block below the
  // existing transfer-equivalency section.
  const availabilityProfile = computeCourseAvailabilityProfile(sections);

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
  for (const c of subjectCourses) {
    if (c.course_number !== number) {
      const key = `${prefix}-${c.course_number}`;
      if (!relatedCourses.has(key)) {
        relatedCourses.set(key, c.course_title);
      }
    }
  }
  const related = Array.from(relatedCourses.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 12);

  // Seats summary — aggregated honestly (negatives = waitlist, sentinels, and
  // 0/1 flag states never inflate the count). See lib/seats.ts.
  const seatSummaryLabel = aggregateLabel(aggregateSeats(sections));

  const lastUpdated = getCourseLastUpdated(state);

  // Program-pathway bridge (#413): when this course's subject prefix
  // maps to one of our curated programs and the program qualifies in
  // this state, surface a small "Part of {program}" link so the
  // course-detail visitor can step up to the program comparison view
  // with earnings + per-college data.
  const matchedProgram = getBestProgramForPrefix(prefix);
  // Use the precomputed summary manifest (the same source the state home uses
  // for its program chips) instead of the live getQualifyingProgramSlugs(),
  // which loops every program × per-college section aggregation — ~13s for a
  // big state like CA, the second-largest contributor to this page's 504s.
  // The manifest read is ~1ms; fall back to the live check only if it's absent.
  const qualifyingSlugs = matchedProgram
    ? (loadStateSummary(state)?.programSlugs ?? (await getQualifyingProgramSlugs(state)))
    : [];
  const programLink =
    matchedProgram && qualifyingSlugs.includes(matchedProgram.slug)
      ? matchedProgram
      : null;

  // JSON-LD
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Course",
    "@id": `${siteUrl}/${state}/course/${code}#course`,
    name: `${prefix} ${number}: ${courseTitle}`,
    description: `${courseTitle} (${credits} credits) offered at ${colleges.length} ${config.systemName} community colleges.`,
    // Connect to the site-wide WebSite/Organization graph from the root
    // layout so Google sees this Course as part of the site, not isolated.
    isPartOf: { "@id": `${siteUrl}/#website` },
    provider: {
      "@type": "Organization",
      name: config.systemFullName,
    },
    numberOfCredits: credits,
    educationalLevel: "Community College",
    isAccessibleForFree: false,
    inLanguage: "en",
    ...(lastUpdated && { dateModified: lastUpdated.toISOString() }),
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
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1 text-sm">
            <Link
              href={`/${state}/subject/${prefix.toLowerCase()}`}
              className="font-medium text-teal-600 dark:text-teal-400 hover:underline"
            >
              {subjectName(prefix)}
            </Link>
            {programLink && (
              <>
                <span className="text-gray-300 dark:text-slate-600">·</span>
                <Link
                  href={`/${state}/program/${programLink.slug}`}
                  className="text-gray-500 dark:text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 hover:underline"
                >
                  Part of the {programLink.name} pathway →
                </Link>
              </>
            )}
          </div>
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
            {seatSummaryLabel && (
              <span className="text-emerald-600 dark:text-emerald-400">
                {seatSummaryLabel}
              </span>
            )}
            {lastUpdated && (
              <span className="text-gray-400 dark:text-slate-500">
                {formatLastUpdated(lastUpdated)}
              </span>
            )}
          </div>
        </div>

        {/* Seat-open alert CTA — only when the course has full sections.
            Bridges to the existing plan-based seat-watch via the planner. */}
        {courseHasFullSection(sections) && (
          <SeatAlertCTA state={state} courseCode={`${prefix} ${number}`} />
        )}

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
            <SectionHeading id="transfer" className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-3">
              Transfer Equivalencies
            </SectionHeading>
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

        {/* Course Availability Profile — server-rendered substantive
            content per term. Helps long-tail SEO ("[course] online
            community college", "[course] evening class [state]") and
            gives users the at-a-glance shape of how this course is
            offered without having to scroll through every section. */}
        {availabilityProfile && availabilityProfile.totalSections > 0 && (
          <section className="mb-8 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6">
            <SectionHeading id="availability" className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-1">
              Availability Profile
            </SectionHeading>
            <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
              How {prefix} {number} is being offered across {availabilityProfile.collegeCount}{" "}
              {availabilityProfile.collegeCount === 1 ? "college" : "colleges"}{" "}
              this term ({availabilityProfile.totalSections}{" "}
              {availabilityProfile.totalSections === 1 ? "section" : "sections"} total).
            </p>

            <div className="grid sm:grid-cols-2 gap-6">
              {/* Format mix */}
              <div>
                <h3 className="text-sm font-medium text-gray-900 dark:text-slate-100 mb-2">
                  Delivery format
                </h3>
                <ul className="text-sm text-gray-700 dark:text-slate-300 space-y-1">
                  {Object.entries(availabilityProfile.modes.counts)
                    .sort((a, b) => b[1] - a[1])
                    .map(([mode, count]) => (
                      <li key={mode} className="flex justify-between">
                        <span className="capitalize">
                          {mode.replace("-", " ")}
                        </span>
                        <span>
                          <span className="font-medium text-gray-900 dark:text-slate-100">
                            {count}
                          </span>{" "}
                          <span className="text-xs text-gray-500 dark:text-slate-400">
                            ({availabilityProfile.modes.pcts[mode].toFixed(0)}%)
                          </span>
                        </span>
                      </li>
                    ))}
                </ul>
              </div>

              {/* Time of day */}
              <div>
                <h3 className="text-sm font-medium text-gray-900 dark:text-slate-100 mb-2">
                  When sections meet
                </h3>
                <ul className="text-sm text-gray-700 dark:text-slate-300 space-y-1">
                  {availabilityProfile.timeOfDay.morning > 0 && (
                    <li className="flex justify-between">
                      <span>Morning (before noon)</span>
                      <span className="font-medium text-gray-900 dark:text-slate-100">
                        {availabilityProfile.timeOfDay.morning}
                      </span>
                    </li>
                  )}
                  {availabilityProfile.timeOfDay.afternoon > 0 && (
                    <li className="flex justify-between">
                      <span>Afternoon (noon–5 PM)</span>
                      <span className="font-medium text-gray-900 dark:text-slate-100">
                        {availabilityProfile.timeOfDay.afternoon}
                      </span>
                    </li>
                  )}
                  {availabilityProfile.timeOfDay.evening > 0 && (
                    <li className="flex justify-between">
                      <span>Evening (5 PM and after)</span>
                      <span className="font-medium text-gray-900 dark:text-slate-100">
                        {availabilityProfile.timeOfDay.evening}
                      </span>
                    </li>
                  )}
                  {availabilityProfile.timeOfDay.asynchronous > 0 && (
                    <li className="flex justify-between">
                      <span>Asynchronous / TBA</span>
                      <span className="font-medium text-gray-900 dark:text-slate-100">
                        {availabilityProfile.timeOfDay.asynchronous}
                      </span>
                    </li>
                  )}
                </ul>
              </div>
            </div>

            {/* Start dates + instructor diversity footer */}
            <div className="mt-6 pt-4 border-t border-gray-100 dark:border-slate-700 grid sm:grid-cols-2 gap-6 text-sm">
              <div>
                <h3 className="font-medium text-gray-900 dark:text-slate-100 mb-1">
                  Start dates
                </h3>
                {availabilityProfile.startDates.distinct > 0 ? (
                  <p className="text-gray-700 dark:text-slate-300">
                    Sections begin on{" "}
                    <span className="font-medium text-gray-900 dark:text-slate-100">
                      {availabilityProfile.startDates.distinct}
                    </span>{" "}
                    distinct date
                    {availabilityProfile.startDates.distinct === 1 ? "" : "s"}.
                    {availabilityProfile.startDates.lateStartCount > 0 && (
                      <>
                        {" "}
                        <Link
                          href={`/${state}/starting-soon`}
                          className="font-medium text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300"
                        >
                          {availabilityProfile.startDates.lateStartCount}{" "}
                          late-start
                        </Link>{" "}
                        more than two weeks after the term&apos;s earliest start.
                      </>
                    )}
                  </p>
                ) : (
                  <p className="text-gray-500 dark:text-slate-400">
                    Start-date data not available for this term.
                  </p>
                )}
              </div>
              <div>
                <h3 className="font-medium text-gray-900 dark:text-slate-100 mb-1">
                  Instructor diversity
                </h3>
                {availabilityProfile.instructorCount > 0 ? (
                  <p className="text-gray-700 dark:text-slate-300">
                    Taught by{" "}
                    <span className="font-medium text-gray-900 dark:text-slate-100">
                      {availabilityProfile.instructorCount}
                    </span>{" "}
                    distinct instructor
                    {availabilityProfile.instructorCount === 1 ? "" : "s"}{" "}
                    across {availabilityProfile.collegeCount}{" "}
                    {availabilityProfile.collegeCount === 1 ? "college" : "colleges"}.
                  </p>
                ) : (
                  <p className="text-gray-500 dark:text-slate-400">
                    Instructor assignments not yet published for this term.
                  </p>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Compare colleges — side-by-side matrix (only worthwhile with ≥2). */}
        {colleges.length >= 2 && (
          <section className="mb-8">
            <SectionHeading id="compare" className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-1">
              Compare colleges
            </SectionHeading>
            <p className="text-sm text-gray-500 dark:text-slate-400 mb-3">
              Where to take {prefix} {number} — sort and filter by when it meets,
              open seats, and format.
            </p>
            <CourseCollegeCompare
              rows={compareRows}
              state={state}
              notOffered={notOfferedColleges}
            />
          </section>
        )}

        {/* Availability by college — full per-section detail */}
        <section className="mb-8">
          <SectionHeading id="colleges" className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-3">
            Available at {colleges.length} {colleges.length === 1 ? "college" : "colleges"}
          </SectionHeading>
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

        {/* Related blog posts — programmatic → editorial cross-pollination (#371) */}
        <RelatedBlogPosts
          articles={getBlogRecommendations({
            state,
            pageType: "course",
          })}
          heading={`Related ${config.name} guides`}
        />

        {/* Related courses */}
        {related.length > 0 && (
          <section className="mb-8">
            <SectionHeading id="more-courses" className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-3">
              More {subjectName(prefix)} Courses
            </SectionHeading>
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
                      <SectionSeats open={s.seats_open} total={s.seats_total} />
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

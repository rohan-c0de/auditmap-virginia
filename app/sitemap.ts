import type { MetadataRoute } from "next";
import { getAllStates } from "@/lib/states/registry";
import { loadInstitutions } from "@/lib/institutions";
import { getAllArticles } from "@/lib/blog";
import {
  loadCoursesForCollege,
  getUniqueSubjects,
  getSitemapCourseIndex,
} from "@/lib/courses";
import { getCurrentTerm } from "@/lib/terms";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    "https://communitycollegepath.com";

  const entries: MetadataRoute.Sitemap = [
    { url: baseUrl, changeFrequency: "weekly", priority: 1 },
    { url: `${baseUrl}/colleges`, changeFrequency: "weekly", priority: 0.9 },
  ];

  for (const state of getAllStates()) {
    const s = state.slug;
    entries.push(
      { url: `${baseUrl}/${s}`, changeFrequency: "weekly", priority: 1 },
      { url: `${baseUrl}/${s}/courses`, changeFrequency: "weekly", priority: 0.9 },
      { url: `${baseUrl}/${s}/colleges`, changeFrequency: "weekly", priority: 0.9 },
      { url: `${baseUrl}/${s}/starting-soon`, changeFrequency: "daily", priority: 0.85 },
      { url: `${baseUrl}/${s}/about`, changeFrequency: "monthly", priority: 0.6 },
      // /results and /schedule are noindexed (client-side interactive tools)
    );
    if (state.transferSupported) {
      entries.push({ url: `${baseUrl}/${s}/transfer`, changeFrequency: "weekly" as const, priority: 0.85 });
    }
  }

  // College detail pages + subject pages for all states
  const collegePages: MetadataRoute.Sitemap = [];
  const subjectPages: MetadataRoute.Sitemap = [];

  for (const state of getAllStates()) {
    const institutions = loadInstitutions(state.slug);
    const currentTerm = await getCurrentTerm(state.slug);

    for (const inst of institutions) {
      collegePages.push({
        url: `${baseUrl}/${state.slug}/college/${inst.id}`,
        changeFrequency: "weekly" as const,
        priority: 0.7,
      });

      // Subject pages (pSEO) — only include if ≥3 sections to avoid thin content
      try {
        const courses = await loadCoursesForCollege(
          inst.college_slug,
          currentTerm,
          state.slug
        );
        const subjects = getUniqueSubjects(courses);
        for (const prefix of subjects) {
          const sectionCount = courses.filter(
            (c) => c.course_prefix === prefix
          ).length;
          if (sectionCount >= 3) {
            subjectPages.push({
              url: `${baseUrl}/${state.slug}/college/${inst.id}/courses/${prefix.toLowerCase()}`,
              changeFrequency: "weekly" as const,
              priority: 0.6,
            });
          }
        }
      } catch {
        // Skip if course loading fails
      }
    }
  }

  // Course detail pages (pSEO) — one page per unique course per state
  const coursePages: MetadataRoute.Sitemap = [];
  // State-wide subject pages (pSEO) — e.g. /va/subject/eng (all ENG across state)
  const stateSubjectPages: MetadataRoute.Sitemap = [];

  for (const state of getAllStates()) {
    try {
      const currentTerm = await getCurrentTerm(state.slug);
      // Single 2-column scan instead of full row catalog (~9 MB → ~50 KB).
      const { codes, subjectSectionCounts } = await getSitemapCourseIndex(
        currentTerm,
        state.slug
      );

      for (const c of codes) {
        const key = `${c.prefix}-${c.number}`.toLowerCase();
        coursePages.push({
          url: `${baseUrl}/${state.slug}/course/${key}`,
          changeFrequency: "weekly" as const,
          priority: 0.7,
        });
      }

      // Only include state subject pages with ≥5 sections — avoids thin content
      for (const [prefix, count] of subjectSectionCounts) {
        if (count >= 5) {
          stateSubjectPages.push({
            url: `${baseUrl}/${state.slug}/subject/${prefix.toLowerCase()}`,
            changeFrequency: "weekly" as const,
            priority: 0.65,
          });
        }
      }
    } catch {
      // Skip state if data loading fails
    }
  }

  // Blog pages
  const blogPages: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/blog`, changeFrequency: "weekly" as const, priority: 0.7 },
    ...getAllArticles().map((article) => ({
      url: `${baseUrl}/blog/${article.slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.6,
      lastModified: new Date(article.date),
    })),
  ];

  return [
    ...entries,
    ...collegePages,
    ...subjectPages,
    ...stateSubjectPages,
    ...coursePages,
    ...blogPages,
  ];
}

import { getAllStates } from "@/lib/states/registry";
import { loadInstitutions } from "@/lib/institutions";
import { loadCoursesForCollege, getUniqueSubjects } from "@/lib/courses";
import { getCurrentTerm } from "@/lib/terms";
import {
  toSitemapXml,
  siteOrigin,
  xmlResponse,
  type SitemapEntry,
} from "@/lib/sitemap-xml";

export const revalidate = 86400;

export async function GET() {
  const url = siteOrigin();

  const results = await Promise.allSettled(
    getAllStates().map(async (state) => {
      const institutions = loadInstitutions(state.slug);
      const currentTerm = await getCurrentTerm(state.slug);

      const collegeResults = await Promise.allSettled(
        institutions.map(async (inst) => {
          const courses = await loadCoursesForCollege(
            inst.college_slug,
            currentTerm,
            state.slug
          );
          const entries: SitemapEntry[] = [];
          for (const prefix of getUniqueSubjects(courses)) {
            const count = courses.filter(
              (c) => c.course_prefix === prefix
            ).length;
            if (count >= 3) {
              entries.push({
                url: `${url}/${state.slug}/college/${inst.id}/courses/${prefix.toLowerCase()}`,
                changeFrequency: "weekly",
                priority: 0.5,
                lastModified: new Date(),
              });
            }
          }
          return entries;
        })
      );

      return collegeResults.flatMap((r) =>
        r.status === "fulfilled" ? r.value : []
      );
    })
  );

  const entries: SitemapEntry[] = results.flatMap((r) =>
    r.status === "fulfilled" ? r.value : []
  );

  return xmlResponse(toSitemapXml(entries));
}

import { getAllStates } from "@/lib/states/registry";
import { getSitemapCourseIndex } from "@/lib/courses";
import { getCurrentTerm } from "@/lib/terms";
import {
  toSitemapXml,
  siteOrigin,
  xmlResponse,
  type SitemapEntry,
} from "@/lib/sitemap-xml";
import { getSubjectLastUpdated } from "@/lib/data-freshness";

export const revalidate = 86400;

export async function GET() {
  const url = siteOrigin();

  const results = await Promise.allSettled(
    getAllStates().map(async (state) => {
      const currentTerm = await getCurrentTerm(state.slug);
      const { subjectSectionCounts } = await getSitemapCourseIndex(
        currentTerm,
        state.slug
      );
      const lastModified = getSubjectLastUpdated(state.slug) ?? undefined;
      const entries: SitemapEntry[] = [];
      for (const [prefix, count] of subjectSectionCounts) {
        if (count >= 5) {
          entries.push({
            url: `${url}/${state.slug}/subject/${prefix.toLowerCase()}`,
            changeFrequency: "weekly",
            priority: 0.6,
            lastModified,
          });
        }
      }
      return entries;
    })
  );

  const entries: SitemapEntry[] = results.flatMap((r) =>
    r.status === "fulfilled" ? r.value : []
  );

  return xmlResponse(toSitemapXml(entries));
}

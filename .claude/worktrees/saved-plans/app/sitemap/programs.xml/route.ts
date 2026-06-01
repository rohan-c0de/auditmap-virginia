import { getAllStates } from "@/lib/states/registry";
import { getQualifyingProgramSlugs } from "@/lib/programs";
import {
  toSitemapXml,
  siteOrigin,
  xmlResponse,
  type SitemapEntry,
} from "@/lib/sitemap-xml";
import { getProgramLastUpdated } from "@/lib/data-freshness";

export const revalidate = 86400;

export async function GET() {
  const url = siteOrigin();

  const results = await Promise.allSettled(
    getAllStates().map(async (state) => {
      const slugs = await getQualifyingProgramSlugs(state.slug);
      const lastModified = getProgramLastUpdated(state.slug) ?? undefined;
      return slugs.map((slug) => ({
        url: `${url}/${state.slug}/program/${slug}`,
        changeFrequency: "weekly" as const,
        priority: 0.6,
        lastModified,
      }));
    })
  );

  const entries: SitemapEntry[] = results.flatMap((r) =>
    r.status === "fulfilled" ? r.value : []
  );

  return xmlResponse(toSitemapXml(entries));
}

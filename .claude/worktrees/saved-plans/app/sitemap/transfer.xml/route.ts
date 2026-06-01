import { getAllStates } from "@/lib/states/registry";
import { getUniversitySlugsForSitemap } from "@/lib/transfer";
import {
  toSitemapXml,
  siteOrigin,
  xmlResponse,
  type SitemapEntry,
} from "@/lib/sitemap-xml";

export const revalidate = 86400;

const MIN_TRANSFER_HUB_COUNT = 10;

export async function GET() {
  const url = siteOrigin();

  const results = await Promise.allSettled(
    getAllStates()
      .filter((s) => s.transferSupported)
      .map(async (state) => {
        const universities = await getUniversitySlugsForSitemap(state.slug);
        return universities
          .filter((u) => u.totalCount >= MIN_TRANSFER_HUB_COUNT)
          .map((u) => ({
            url: `${url}/${state.slug}/transfer/to/${u.slug}`,
            changeFrequency: "weekly" as const,
            priority: 0.75,
            lastModified: new Date(),
          }));
      })
  );

  const entries: SitemapEntry[] = results.flatMap((r) =>
    r.status === "fulfilled" ? r.value : []
  );

  return xmlResponse(toSitemapXml(entries));
}

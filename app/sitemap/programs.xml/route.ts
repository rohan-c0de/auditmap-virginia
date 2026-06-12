import { getAllStates } from "@/lib/states/registry";
import { getQualifyingProgramSlugs } from "@/lib/programs";
import { loadStateSummary } from "@/lib/state-summary";
import {
  toSitemapXml,
  siteOrigin,
  xmlResponse,
  type SitemapEntry,
} from "@/lib/sitemap-xml";
import { getProgramLastUpdated } from "@/lib/data-freshness";

export const dynamic = "force-dynamic";

export async function GET() {
  const url = siteOrigin();

  const results = await Promise.allSettled(
    getAllStates().map(async (state) => {
      // Manifest-first: this force-dynamic sitemap is fetched by crawlers on
      // every request, and the live getQualifyingProgramSlugs aggregates every
      // program across colleges (~13s for a big state) — so the old code took
      // ~13s per crawl. The precomputed manifest makes it instant.
      const slugs =
        loadStateSummary(state.slug)?.programSlugs ??
        (await getQualifyingProgramSlugs(state.slug));
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

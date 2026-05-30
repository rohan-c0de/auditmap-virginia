import { getAllStates } from "@/lib/states/registry";
import { getSitemapCourseIndex } from "@/lib/courses";
import { getCurrentTerm } from "@/lib/terms";
import {
  toSitemapXml,
  siteOrigin,
  xmlResponse,
  type SitemapEntry,
} from "@/lib/sitemap-xml";
import { getCourseLastUpdated } from "@/lib/data-freshness";

export const revalidate = 86400;

export async function GET() {
  const url = siteOrigin();

  const results = await Promise.allSettled(
    getAllStates().map(async (state) => {
      const currentTerm = await getCurrentTerm(state.slug);
      const { codes } = await getSitemapCourseIndex(currentTerm, state.slug);
      const lastModified = getCourseLastUpdated(state.slug) ?? undefined;
      // Mirror the page-level thin-content guard in
      // app/[state]/course/[code]/page.tsx — only submit courses with real
      // breadth (≥3 sections at ≥2 colleges, or ≥5 sections at one).
      // Submitting courses we'd noindex anyway just wastes crawl budget;
      // GSC audit (2026-05) showed 26K such pages stuck in "Discovered –
      // not indexed".
      return codes
        .filter(
          (c) => c.sectionCount >= 3 && (c.collegeCount >= 2 || c.sectionCount >= 5)
        )
        .map((c) => ({
          url: `${url}/${state.slug}/course/${`${c.prefix}-${c.number}`.toLowerCase()}`,
          changeFrequency: "monthly" as const,
          priority: 0.5,
          lastModified,
        }));
    })
  );

  const entries: SitemapEntry[] = results.flatMap((r) =>
    r.status === "fulfilled" ? r.value : []
  );

  return xmlResponse(toSitemapXml(entries));
}

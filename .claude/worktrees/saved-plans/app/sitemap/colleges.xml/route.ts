import { getAllStates, hasProgramsCoverage } from "@/lib/states/registry";
import { loadInstitutions } from "@/lib/institutions";
import {
  toSitemapXml,
  siteOrigin,
  xmlResponse,
  type SitemapEntry,
} from "@/lib/sitemap-xml";
import {
  getCollegeLastUpdated,
  getProgramLastUpdated,
} from "@/lib/data-freshness";

export function GET() {
  const url = siteOrigin();
  const entries: SitemapEntry[] = [];

  for (const state of getAllStates()) {
    const hasPrograms = hasProgramsCoverage(state.slug);
    for (const inst of loadInstitutions(state.slug)) {
      entries.push({
        url: `${url}/${state.slug}/college/${inst.id}`,
        changeFrequency: "weekly",
        priority: 0.8,
        lastModified:
          getCollegeLastUpdated(state.slug, inst.college_slug) ?? undefined,
      });
      if (hasPrograms) {
        entries.push({
          url: `${url}/${state.slug}/college/${inst.id}/programs`,
          changeFrequency: "monthly",
          priority: 0.6,
          lastModified:
            getProgramLastUpdated(state.slug, inst.college_slug) ?? undefined,
        });
      }
    }
  }

  return xmlResponse(toSitemapXml(entries));
}

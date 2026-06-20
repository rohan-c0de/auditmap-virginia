import { getAllStates } from "@/lib/states/registry";
import { loadOnlineData, onlineQualifies } from "@/lib/online";
import {
  getCourseLastUpdated,
  getTransferLastUpdated,
} from "@/lib/data-freshness";
import {
  toSitemapXml,
  siteOrigin,
  xmlResponse,
  type SitemapEntry,
} from "@/lib/sitemap-xml";

export const dynamic = "force-dynamic";

export async function GET() {
  const url = siteOrigin();
  const entries: SitemapEntry[] = [
    { url, changeFrequency: "daily", priority: 1 },
    { url: `${url}/colleges`, changeFrequency: "weekly", priority: 0.9 },
  ];

  const states = getAllStates();

  for (const state of states) {
    const s = state.slug;
    const courseFreshness = getCourseLastUpdated(s) ?? undefined;
    entries.push(
      { url: `${url}/${s}`, changeFrequency: "weekly", priority: 1, lastModified: courseFreshness },
      { url: `${url}/${s}/courses`, changeFrequency: "weekly", priority: 0.85, lastModified: courseFreshness },
      { url: `${url}/${s}/colleges`, changeFrequency: "weekly", priority: 0.9, lastModified: courseFreshness },
      { url: `${url}/${s}/about`, changeFrequency: "yearly", priority: 0.5 }
    );
    if (state.transferSupported) {
      entries.push({
        url: `${url}/${s}/transfer`,
        changeFrequency: "weekly",
        priority: 0.9,
        lastModified: getTransferLastUpdated(s) ?? undefined,
      });
    }
  }

  const onlineResults = await Promise.allSettled(
    states.map(async (state) => {
      const od = await loadOnlineData(state.slug);
      if (od && onlineQualifies(od)) {
        return {
          url: `${url}/${state.slug}/online`,
          changeFrequency: "weekly" as const,
          priority: 0.85,
        };
      }
      return null;
    })
  );

  for (const r of onlineResults) {
    if (r.status === "fulfilled" && r.value) {
      entries.push(r.value);
    }
  }

  return xmlResponse(toSitemapXml(entries));
}

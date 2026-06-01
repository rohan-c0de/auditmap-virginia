import { getAllArticles } from "@/lib/blog";
import {
  toSitemapXml,
  siteOrigin,
  xmlResponse,
  type SitemapEntry,
} from "@/lib/sitemap-xml";

export function GET() {
  const url = siteOrigin();
  const entries: SitemapEntry[] = [
    { url: `${url}/blog`, changeFrequency: "weekly", priority: 0.9 },
    ...getAllArticles().map((article) => ({
      url: `${url}/blog/${article.slug}`,
      changeFrequency: "monthly" as const,
      priority: article.clusterRole === "hub" ? 0.7 : 0.6,
      lastModified: new Date(article.date),
    })),
  ];

  return xmlResponse(toSitemapXml(entries));
}

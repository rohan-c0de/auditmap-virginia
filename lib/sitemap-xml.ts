export interface SitemapEntry {
  url: string;
  lastModified?: Date;
  changeFrequency?:
    | "always"
    | "hourly"
    | "daily"
    | "weekly"
    | "monthly"
    | "yearly"
    | "never";
  priority?: number;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function toSitemapXml(entries: SitemapEntry[]): string {
  const urls = entries
    .map((e) => {
      let inner = `    <loc>${esc(e.url)}</loc>`;
      if (e.lastModified)
        inner += `\n    <lastmod>${e.lastModified.toISOString()}</lastmod>`;
      if (e.changeFrequency)
        inner += `\n    <changefreq>${e.changeFrequency}</changefreq>`;
      if (e.priority != null)
        inner += `\n    <priority>${e.priority}</priority>`;
      return `  <url>\n${inner}\n  </url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
}

export function toSitemapIndexXml(urls: string[]): string {
  const entries = urls
    .map((u) => `  <sitemap>\n    <loc>${esc(u)}</loc>\n  </sitemap>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</sitemapindex>`;
}

export function siteOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com"
  );
}

export function xmlResponse(xml: string): Response {
  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml",
      // Cache every sitemap at the Vercel CDN for a day so repeat crawls don't
      // re-run the per-request work behind the heavy sitemaps: courses.xml and
      // state-subjects.xml full-paginate the courses table across all states,
      // and core.xml does a live online-mode scan. Sitemap contents only change
      // after the daily scrape/import; stale-while-revalidate serves the cached
      // copy while one background request refreshes it. Deliberately a response
      // header rather than `export const revalidate`: those sitemaps are
      // `force-dynamic`, and converting them to ISR would pre-render the
      // multi-state scans at BUILD time and blow the 60s static-gen budget —
      // the exact failure the data/sitemap-college-subjects.json snapshot exists
      // to avoid.
      "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=43200",
    },
  });
}

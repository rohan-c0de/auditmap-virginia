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
    headers: { "Content-Type": "application/xml" },
  });
}

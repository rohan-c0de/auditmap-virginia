import { getAllArticles } from "@/lib/blog";

export function GET() {
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com";
  const articles = getAllArticles();

  const items = articles
    .map(
      (a) => `    <item>
      <title><![CDATA[${a.title}]]></title>
      <link>${siteUrl}/blog/${a.slug}</link>
      <guid isPermaLink="true">${siteUrl}/blog/${a.slug}</guid>
      <description><![CDATA[${a.description}]]></description>
      <pubDate>${new Date(a.date).toUTCString()}</pubDate>
      <category>${a.category}</category>
    </item>`
    )
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Community College Path Blog</title>
    <link>${siteUrl}/blog</link>
    <description>Practical guides for community college course planning, transfer credits, scheduling, and senior tuition waivers.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${siteUrl}/blog/feed.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}

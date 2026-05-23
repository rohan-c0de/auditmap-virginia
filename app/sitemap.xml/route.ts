import { toSitemapIndexXml, siteOrigin, xmlResponse } from "@/lib/sitemap-xml";

const SITEMAP_IDS = [
  "core",
  "colleges",
  "college-subjects",
  "courses",
  "state-subjects",
  "transfer",
  "programs",
  "blog",
];

export function GET() {
  const base = siteOrigin();
  return xmlResponse(
    toSitemapIndexXml(SITEMAP_IDS.map((id) => `${base}/sitemap/${id}.xml`))
  );
}

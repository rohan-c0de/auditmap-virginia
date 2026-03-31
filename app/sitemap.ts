import type { MetadataRoute } from "next";
import { getAllStates } from "@/lib/states/registry";
import { loadInstitutions } from "@/lib/institutions";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    "https://auditmap.virginia.example.com";

  const entries: MetadataRoute.Sitemap = [
    { url: baseUrl, changeFrequency: "weekly", priority: 1 },
  ];

  for (const state of getAllStates()) {
    const s = state.slug;
    entries.push(
      { url: `${baseUrl}/${s}`, changeFrequency: "weekly", priority: 1 },
      { url: `${baseUrl}/${s}/courses`, changeFrequency: "weekly", priority: 0.9 },
      { url: `${baseUrl}/${s}/schedule`, changeFrequency: "weekly", priority: 0.8 },
      { url: `${baseUrl}/${s}/colleges`, changeFrequency: "weekly", priority: 0.9 },
      { url: `${baseUrl}/${s}/starting-soon`, changeFrequency: "daily", priority: 0.85 },
      { url: `${baseUrl}/${s}/transfer`, changeFrequency: "weekly", priority: 0.85 },
      { url: `${baseUrl}/${s}/about`, changeFrequency: "monthly", priority: 0.6 },
    );
  }

  // College detail pages for all states
  const collegePages: MetadataRoute.Sitemap = [];
  for (const state of getAllStates()) {
    const institutions = loadInstitutions(state.slug);
    for (const inst of institutions) {
      collegePages.push({
        url: `${baseUrl}/${state.slug}/college/${inst.id}`,
        changeFrequency: "weekly" as const,
        priority: 0.7,
      });
    }
  }

  return [...entries, ...collegePages];
}

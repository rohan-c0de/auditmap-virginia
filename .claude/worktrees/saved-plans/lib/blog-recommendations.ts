/**
 * Pick 2-3 contextually relevant blog posts to surface on a programmatic
 * page. Each programmatic page type has a curated list of preferred
 * clusters; within each cluster we prefer the state-specific spoke, then
 * fall back to the cluster hub.
 *
 * Why this exists: programmatic pages (college, course, transfer, etc.)
 * historically had zero blog backlinks. Adding contextual blog
 * recommendations strengthens topical-depth signal to Google and gives
 * users a discovery path from data pages to explainer content. See
 * GitHub issue #371.
 */
import type { ArticleMeta } from "@/lib/blog";
import { getAllArticles, getClusterArticles } from "@/lib/blog";

export type ProgrammaticPageType =
  | "college"
  | "course"
  | "transfer"
  | "instructor"
  | "online"
  | "subject";

/**
 * Ordered preference of blog clusters per page type. The first cluster
 * in the list is the most topically aligned; later clusters are
 * fallbacks. Clusters listed here that don't yet exist are skipped
 * gracefully.
 */
const CLUSTERS_BY_PAGE_TYPE: Record<ProgrammaticPageType, string[]> = {
  college: [
    "senior-waivers-guide",
    "audit-at-college-guide",
    "transfer-credit-guide",
  ],
  course: [
    "late-start-by-state-guide",
    "prereq-chains-guide",
    "transfer-credit-guide",
    "course-availability-guide",
  ],
  transfer: [
    "transfer-credit-guide",
    "transfer-receiver-patterns-guide", // proposed, see issue #367
  ],
  instructor: [
    // No instructor-specific cluster exists yet (proposed in #371). Fall
    // back to general "how to navigate community college" content.
    "audit-at-college-guide",
  ],
  online: [
    "hybrid-course-density-guide",
    "session-timing-guide",
  ],
  subject: [
    "course-availability-guide",
    "prereq-chains-guide",
  ],
};

export interface BlogRecommendationOptions {
  state: string;
  pageType: ProgrammaticPageType;
  /** Optional: scope recommendations to a specific institution. */
  college?: string;
  /** Default 3. */
  limit?: number;
}

/**
 * Returns 0-N blog posts most relevant to the given programmatic page.
 *
 * Selection priority within each preferred cluster:
 *   1. State-specific spoke that matches `opts.state`
 *   2. College-specific spoke that matches `opts.college` (if provided)
 *   3. Cluster hub
 *   4. Most-recent spoke (last resort)
 *
 * The function returns an empty array if no clusters yield matches —
 * callers should handle the empty case (typically by not rendering
 * the recommendation block).
 */
export function getBlogRecommendations(
  opts: BlogRecommendationOptions
): ArticleMeta[] {
  const limit = opts.limit ?? 3;
  const preferredClusters = CLUSTERS_BY_PAGE_TYPE[opts.pageType] ?? [];
  const picked: ArticleMeta[] = [];
  const pickedSlugs = new Set<string>();

  function tryAdd(article: ArticleMeta | undefined) {
    if (!article) return;
    if (pickedSlugs.has(article.slug)) return;
    picked.push(article);
    pickedSlugs.add(article.slug);
  }

  for (const clusterId of preferredClusters) {
    if (picked.length >= limit) break;

    const articles = getClusterArticles(clusterId);
    if (articles.length === 0) continue;

    // College-specific spoke takes top priority if we have a college
    // and a matching post exists.
    if (opts.college) {
      const collegeMatch = articles.find(
        (a) => a.college === opts.college && a.state === opts.state
      );
      if (collegeMatch) {
        tryAdd(collegeMatch);
        continue; // one pick per cluster
      }
    }

    // Otherwise: state-specific spoke
    const stateMatch = articles.find(
      (a) => a.state === opts.state && a.clusterRole === "spoke"
    );
    if (stateMatch) {
      tryAdd(stateMatch);
      continue;
    }

    // Fall back to the cluster hub (national, no state)
    const hub = articles.find((a) => a.clusterRole === "hub");
    if (hub) {
      tryAdd(hub);
      continue;
    }

    // Last resort: any spoke
    tryAdd(articles[0]);
  }

  // If we still have fewer than `limit` recommendations, top up with
  // any remaining state-tagged blog posts (any cluster) so the
  // sidebar isn't half-empty.
  if (picked.length < limit) {
    const stateExtras = getAllArticles().filter(
      (a) => a.state === opts.state && !pickedSlugs.has(a.slug)
    );
    for (const a of stateExtras) {
      if (picked.length >= limit) break;
      tryAdd(a);
    }
  }

  return picked.slice(0, limit);
}

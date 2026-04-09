import { articles, CATEGORIES, type ArticleMeta } from "@/content/blog/index";
import { isValidState, getStateConfig } from "@/lib/states/registry";

export type { ArticleMeta };
export { CATEGORIES };

/** All articles sorted newest-first. */
export function getAllArticles(): ArticleMeta[] {
  return [...articles].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

/** Single article by slug. */
export function getArticleBySlug(slug: string): ArticleMeta | undefined {
  return articles.find((a) => a.slug === slug);
}

/** Articles in a given category. */
export function getArticlesByCategory(category: string): ArticleMeta[] {
  return getAllArticles().filter((a) => a.category === category);
}

/** Articles tied to a specific state. */
export function getArticlesByState(state: string): ArticleMeta[] {
  return getAllArticles().filter((a) => a.state === state);
}

/** Articles in the same hub/spoke cluster. */
export function getClusterArticles(clusterId: string): ArticleMeta[] {
  return getAllArticles().filter((a) => a.cluster === clusterId);
}

/** Human-readable category label. */
export function categoryLabel(category: string): string {
  return CATEGORIES[category] ?? category;
}

/** Human-readable state label for article badges. */
export function stateLabel(state: string): string {
  if (!isValidState(state)) return state.toUpperCase();
  return getStateConfig(state).name;
}

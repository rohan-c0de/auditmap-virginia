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

export type TopicLink = {
  cluster: string;
  title: string;
  blurb: string;
  article: ArticleMeta;
};

const CLUSTER_DISPLAY: Record<string, { title: string; blurb: string }> = {
  "course-availability-guide": {
    title: "Course Availability",
    blurb: "Which courses run at every campus vs. just one or two",
  },
  "transfer-credit-guide": {
    title: "Transfer Credits",
    blurb: "How courses map to 4-year university requirements",
  },
  "senior-waivers-guide": {
    title: "Senior Waivers",
    blurb: "Free or reduced tuition for qualifying older adults",
  },
  "late-start-by-state-guide": {
    title: "Late-Start Classes",
    blurb: "Sections that begin weeks after the standard start date",
  },
  "prereq-chains-guide": {
    title: "Prerequisite Chains",
    blurb: "Courses that gate transfer-ready sequences",
  },
  "hybrid-course-density-guide": {
    title: "Hybrid & Online",
    blurb: "How courses split between in-person, hybrid, and online",
  },
  "session-timing-guide": {
    title: "Session Timing",
    blurb: "Multiple start dates, mini-terms, and accelerated sessions",
  },
};

/**
 * State-level topic links for the pillar page.
 * Returns one entry per cluster where a state-level spoke exists (college
 * spokes are excluded — they link to a specific institution, not the state).
 */
export function getStateTopicLinks(state: string): TopicLink[] {
  const seen = new Set<string>();
  const results: TopicLink[] = [];
  for (const article of getAllArticles()) {
    if (
      article.state === state &&
      article.cluster &&
      article.clusterRole === "spoke" &&
      !article.college &&
      CLUSTER_DISPLAY[article.cluster] &&
      !seen.has(article.cluster)
    ) {
      seen.add(article.cluster);
      results.push({
        cluster: article.cluster,
        title: CLUSTER_DISPLAY[article.cluster].title,
        blurb: CLUSTER_DISPLAY[article.cluster].blurb,
        article,
      });
    }
  }
  return results;
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

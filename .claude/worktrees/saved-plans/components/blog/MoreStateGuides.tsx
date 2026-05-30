import Link from "next/link";
import { getArticlesByState, categoryLabel, stateLabel } from "@/lib/blog";

// Renders up to N other state-tagged guides on a state-tagged blog post.
// Excludes the current article and any articles already shown by the
// cluster-based RelatedArticles component (avoids duplicate cards).
export default function MoreStateGuides({
  state,
  currentSlug,
  excludeSlugs = [],
  limit = 4,
}: {
  state: string;
  currentSlug: string;
  excludeSlugs?: string[];
  limit?: number;
}) {
  const exclude = new Set([currentSlug, ...excludeSlugs]);
  const others = getArticlesByState(state)
    .filter((a) => !exclude.has(a.slug))
    .slice(0, limit);
  if (others.length === 0) return null;

  return (
    <div className="mt-12 border-t border-gray-200 dark:border-slate-700 pt-8">
      <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-slate-100">
        More {stateLabel(state)} guides
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {others.map((article) => (
          <Link
            key={article.slug}
            href={`/blog/${article.slug}`}
            className="group rounded-lg border border-gray-200 dark:border-slate-700 p-4 transition hover:border-teal-300 dark:hover:border-teal-600 hover:bg-teal-50/50 dark:hover:bg-teal-900/20"
          >
            <span className="mb-1 inline-block rounded-full bg-gray-100 dark:bg-slate-700 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:text-slate-400">
              {categoryLabel(article.category)}
            </span>
            <h3 className="mt-1 text-sm font-semibold text-gray-900 dark:text-slate-100 group-hover:text-teal-700 dark:group-hover:text-teal-400">
              {article.title}
            </h3>
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-400 line-clamp-2">
              {article.description}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}

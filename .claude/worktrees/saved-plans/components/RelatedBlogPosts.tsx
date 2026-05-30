/**
 * Sidebar component for programmatic pages (college, course, transfer,
 * instructor, online, subject) that surfaces 2-3 contextually relevant
 * blog posts. Visual mirror of components/blog/BlogProgrammaticLinks
 * but in the reverse direction (tools → blog).
 *
 * Renders nothing if `articles` is empty — callers fetch
 * recommendations via getBlogRecommendations() and pass the result.
 */
import Link from "next/link";
import type { ArticleMeta } from "@/lib/blog";
import { categoryLabel } from "@/lib/blog";

interface RelatedBlogPostsProps {
  articles: ArticleMeta[];
  /**
   * Heading shown above the link list. Defaults to "Related guides".
   * Pages may override for context, e.g. "Related Virginia guides".
   */
  heading?: string;
}

export default function RelatedBlogPosts({
  articles,
  heading = "Related guides",
}: RelatedBlogPostsProps) {
  if (articles.length === 0) return null;

  return (
    <aside className="mt-10 rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 px-5 py-4">
      <p className="text-sm font-semibold text-gray-900 dark:text-slate-100">
        {heading}
      </p>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
        Background reading from the Community College Path blog.
      </p>
      <ul className="mt-3 space-y-3">
        {articles.map((article) => (
          <li key={article.slug}>
            <Link
              href={`/blog/${article.slug}`}
              className="group block rounded-md transition hover:bg-white dark:hover:bg-slate-700 -mx-2 px-2 py-1.5"
            >
              <span className="inline-block rounded-full bg-gray-200 dark:bg-slate-700 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-600 dark:text-slate-400">
                {categoryLabel(article.category)}
              </span>
              <div className="mt-1 text-sm font-medium text-teal-700 dark:text-teal-300 group-hover:text-teal-900 dark:group-hover:text-teal-200">
                {article.title}
                <span aria-hidden="true" className="ml-1">→</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </aside>
  );
}

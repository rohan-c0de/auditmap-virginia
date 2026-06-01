/**
 * Blog content integrity check.
 *
 * For every article registered in `content/blog/index.ts`, verifies that
 * the matching `<slug>.mdx` file exists. Also flags orphan MDX files
 * present on disk but missing from the index.
 *
 * Why this matters: `app/blog/[slug]/page.tsx` calls
 * `generateStaticParams()` from the index, so every registered slug gets
 * a route + sitemap entry. The page body is then loaded via
 * `import('@/content/blog/${slug}.mdx')` — if the file is missing, the
 * import throws and the route falls into `catch { notFound() }`,
 * producing a 404 in prod that the build does not flag. PR #156 fixed
 * one such silent miss; this check prevents the next one.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { articles } from "../content/blog/index";

const ROOT = resolve(__dirname, "..");
const BLOG_DIR = resolve(ROOT, "content/blog");
const errors: string[] = [];

const registeredSlugs = new Set(articles.map((a) => a.slug));

for (const article of articles) {
  const path = resolve(BLOG_DIR, `${article.slug}.mdx`);
  if (!existsSync(path)) {
    errors.push(
      `Missing MDX for registered slug "${article.slug}" — expected at content/blog/${article.slug}.mdx`
    );
    continue;
  }
  // No leading H1 — the page template renders the article title from
  // ArticleMeta. A leading `# Title` in the MDX duplicates the title
  // on the rendered page (and creates two <h1>s, which is bad for SEO
  // and accessibility). See the PR that fixed this across 117 files.
  const firstLine = readFileSync(path, "utf-8").split("\n", 1)[0];
  if (firstLine.startsWith("# ")) {
    errors.push(
      `Leading H1 in content/blog/${article.slug}.mdx — the page template already renders the title from ArticleMeta. Remove the "# ..." line (and the blank line after it) from the MDX.`
    );
  }
}

const onDiskMdx = readdirSync(BLOG_DIR)
  .filter((f) => f.endsWith(".mdx"))
  .map((f) => f.replace(/\.mdx$/, ""));

for (const slug of onDiskMdx) {
  if (!registeredSlugs.has(slug)) {
    errors.push(
      `Orphan MDX at content/blog/${slug}.mdx — slug not registered in content/blog/index.ts`
    );
  }
}

if (errors.length > 0) {
  console.error("Blog integrity check failed:");
  for (const e of errors) console.error("  -", e);
  process.exit(1);
}

console.log(
  `OK: ${articles.length} registered slugs all match an MDX file; no orphans.`
);

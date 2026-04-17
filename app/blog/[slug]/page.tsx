import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  getAllArticles,
  getArticleBySlug,
  getClusterArticles,
  categoryLabel,
  stateLabel,
} from "@/lib/blog";
import RelatedArticles from "@/components/blog/RelatedArticles";
import AdUnit from "@/components/AdUnit";
import Link from "next/link";

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const meta = getArticleBySlug(slug);
  if (!meta) return { title: "Not Found" };

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com";

  return {
    title: meta.title,
    description: meta.description,
    openGraph: {
      title: meta.title,
      description: meta.description,
      type: "article",
      publishedTime: meta.date,
      url: `${siteUrl}/blog/${meta.slug}`,
      siteName: "Community College Path",
    },
    twitter: {
      card: "summary_large_image",
      title: meta.title,
      description: meta.description,
    },
  };
}

export function generateStaticParams() {
  return getAllArticles().map((a) => ({ slug: a.slug }));
}

export const dynamicParams = false;

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const meta = getArticleBySlug(slug);
  if (!meta) notFound();

  // Dynamic MDX import
  let Post: React.ComponentType;
  try {
    const mod = await import(`@/content/blog/${slug}.mdx`);
    Post = mod.default;
  } catch {
    notFound();
  }

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com";

  const articleLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: meta.title,
    description: meta.description,
    datePublished: meta.date,
    author: {
      "@type": "Organization",
      name: "Community College Path",
      url: siteUrl,
    },
    publisher: {
      "@type": "Organization",
      name: "Community College Path",
      url: siteUrl,
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `${siteUrl}/blog/${meta.slug}`,
    },
  };

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
      {
        "@type": "ListItem",
        position: 2,
        name: "Blog",
        item: `${siteUrl}/blog`,
      },
      { "@type": "ListItem", position: 3, name: meta.title, item: `${siteUrl}/blog/${meta.slug}` },
    ],
  };

  const related = meta.cluster ? getClusterArticles(meta.cluster) : [];

  return (
    <article className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />

      {/* Back link */}
      <Link
        href="/blog"
        className="text-sm text-teal-600 hover:text-teal-700 mb-6 inline-block"
      >
        &larr; All articles
      </Link>

      {/* Article header */}
      <header className="mb-8">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Link
            href={`/blog?category=${meta.category}`}
            className="rounded-full bg-gray-100 dark:bg-slate-700 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-600 transition"
          >
            {categoryLabel(meta.category)}
          </Link>
          {meta.state && (
            <span className="rounded-full bg-teal-50 dark:bg-teal-900/30 px-2.5 py-0.5 text-xs font-medium text-teal-700 dark:text-teal-400">
              {stateLabel(meta.state)}
            </span>
          )}
        </div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-slate-100 leading-tight">
          {meta.title}
        </h1>
        <p className="mt-3 text-gray-500 dark:text-slate-400 text-sm">
          {new Date(meta.date).toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
          {" · "}
          {meta.author}
        </p>
      </header>

      {/* MDX content */}
      <div className="prose prose-gray prose-lg max-w-none prose-headings:text-gray-900 dark:prose-headings:text-slate-100 prose-a:text-teal-600 dark:prose-a:text-teal-400 prose-a:no-underline hover:prose-a:underline prose-strong:text-gray-900 dark:prose-strong:text-slate-100">
        <Post />
      </div>

      {/* End-of-article ad */}
      <div className="my-10">
        <AdUnit slot="5837291604" format="auto" className="min-h-[100px]" />
      </div>

      {/* Related articles */}
      <RelatedArticles articles={related} currentSlug={slug} />
    </article>
  );
}

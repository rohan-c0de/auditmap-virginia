import Link from "next/link";

export type Crumb = { name: string; href: string };

// Visible breadcrumb trail + matching BreadcrumbList JSON-LD. Server component;
// no client JS. Last item in `items` is the current page (rendered as text,
// not a link).
export default function Breadcrumbs({
  items,
  siteUrl,
  className,
}: {
  items: Crumb[];
  siteUrl: string;
  className?: string;
}) {
  if (items.length === 0) return null;
  const ld = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: c.href.startsWith("http") ? c.href : `${siteUrl}${c.href}`,
    })),
  };
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }}
      />
      <nav
        aria-label="Breadcrumb"
        className={
          className ??
          "text-sm text-gray-500 dark:text-slate-400 mb-4"
        }
      >
        <ol className="flex flex-wrap items-center gap-1.5">
          {items.map((c, i) => {
            const isLast = i === items.length - 1;
            return (
              <li key={c.href} className="flex items-center gap-1.5">
                {i > 0 && (
                  <span aria-hidden="true" className="text-gray-300 dark:text-slate-600">
                    /
                  </span>
                )}
                {isLast ? (
                  <span
                    aria-current="page"
                    className="text-gray-700 dark:text-slate-300 truncate max-w-[40ch]"
                  >
                    {c.name}
                  </span>
                ) : (
                  <Link
                    href={c.href}
                    className="hover:text-teal-600 dark:hover:text-teal-400 transition-colors truncate max-w-[40ch]"
                  >
                    {c.name}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
    </>
  );
}

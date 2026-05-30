import type { MDXComponents } from "mdx/types";
import type { ReactNode } from "react";
import Link from "next/link";
import ProductCallout from "@/components/blog/ProductCallout";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function childrenToText(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(childrenToText).join("");
  if (children && typeof children === "object" && "props" in children) {
    return childrenToText((children as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

function AnchorHeading({
  as: Tag,
  children,
  ...props
}: { as: "h2" | "h3" | "h4"; children?: ReactNode } & Record<string, unknown>) {
  const text = childrenToText(children);
  const id = slugify(text);
  return (
    <Tag id={id} className="heading-anchor" {...props}>
      <a href={`#${id}`} aria-hidden="true" tabIndex={-1}>#</a>
      {children}
    </Tag>
  );
}

export function useMDXComponents(
  components: MDXComponents
): MDXComponents {
  return {
    // Use Next.js Link for internal links, external links open in new tab
    a: ({ href, children, ...props }) => {
      if (href?.startsWith("/")) {
        return (
          <Link href={href} {...props}>
            {children}
          </Link>
        );
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
          {children}
        </a>
      );
    },
    h2: (props) => <AnchorHeading as="h2" {...props} />,
    h3: (props) => <AnchorHeading as="h3" {...props} />,
    h4: (props) => <AnchorHeading as="h4" {...props} />,
    // Custom blog components available in MDX files
    ProductCallout,
    ...components,
  };
}

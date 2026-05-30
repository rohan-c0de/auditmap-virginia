/**
 * Heading with an anchor ID and a hover-visible "#" link, matching the
 * blog's `heading-anchor` pattern. Use for major sections on programmatic
 * pages so they support deep-linking.
 *
 * Issue #344.
 */

import type { ReactNode } from "react";

interface Props {
  as?: "h2" | "h3";
  id: string;
  className?: string;
  children: ReactNode;
}

export default function SectionHeading({
  as: Tag = "h2",
  id,
  className,
  children,
}: Props) {
  return (
    <Tag id={id} className={`heading-anchor ${className ?? ""}`}>
      <a href={`#${id}`} aria-hidden="true" tabIndex={-1}>
        #
      </a>
      {children}
    </Tag>
  );
}

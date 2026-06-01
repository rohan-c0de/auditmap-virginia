/**
 * Server component that emits a JSON-LD <script> tag with the given
 * structured-data payload. Centralises the pattern used across the app
 * so we serialize and stringify consistently.
 *
 * Usage:
 *   <JsonLd data={{ "@context": "https://schema.org", "@type": "WebSite", ... }} />
 *
 * Multiple JSON-LD blocks per page are fine (and recommended for
 * separating concerns — e.g. one for WebSite, one for ItemList).
 */
type JsonLdData = Record<string, unknown> | Record<string, unknown>[];

export default function JsonLd({ data }: { data: JsonLdData }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

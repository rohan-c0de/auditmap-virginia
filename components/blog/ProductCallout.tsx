import Link from "next/link";

const STATES = [
  { slug: "va", label: "Virginia" },
  { slug: "nc", label: "North Carolina" },
  { slug: "sc", label: "South Carolina" },
  { slug: "dc", label: "DC" },
];

interface ProductCalloutProps {
  text: string;
  label: string;
  /** Direct link (for non-state pages like /blog/...) */
  href?: string;
  /** Feature path segment (e.g. "schedule", "transfer", "courses") — renders links for all states */
  feature?: string;
}

export default function ProductCallout({
  text,
  label,
  href,
  feature,
}: ProductCalloutProps) {
  return (
    <div className="not-prose my-8 rounded-xl border border-teal-200 bg-teal-50 px-5 py-4">
      <p className="mb-3 text-sm text-teal-900">{text}</p>

      {feature ? (
        <div>
          <p className="mb-2 text-xs font-medium text-teal-700">{label}</p>
          <div className="flex flex-wrap gap-2">
            {STATES.map((s) => (
              <Link
                key={s.slug}
                href={`/${s.slug}/${feature}`}
                className="inline-flex items-center rounded-lg border border-teal-300 bg-white px-3 py-1.5 text-sm font-medium text-teal-700 transition hover:bg-teal-600 hover:text-white hover:border-teal-600"
              >
                {s.label}
              </Link>
            ))}
          </div>
        </div>
      ) : href ? (
        <Link
          href={href}
          className="inline-flex items-center rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700"
        >
          {label}
          <svg
            className="ml-2 h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
            />
          </svg>
        </Link>
      ) : null}
    </div>
  );
}

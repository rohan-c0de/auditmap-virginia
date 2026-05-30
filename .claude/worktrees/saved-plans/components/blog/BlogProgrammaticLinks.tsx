/**
 * Renders a curated set of programmatic-route links at the foot of a
 * state-tagged blog post. Picks 3-5 links based on the article's
 * category so a senior-waivers post points at audit-friendly tools,
 * a late-start post points at /starting-soon, etc.
 *
 * Why this exists: the existing StateToolsCTA only links to /{state}
 * and /{state}/transfer. Programmatic routes (per-college, per-course,
 * per-subject, per-program) get little crawl-discovery signal from
 * blog content. This component routes blog traffic to the broader
 * programmatic surface and helps Google find pages that need
 * indexing budget.
 */
import Link from "next/link";
import { getStateConfig } from "@/lib/states/registry";

interface BlogProgrammaticLinksProps {
  state: string;
  category: string;
}

type ProgrammaticLink = {
  label: string;
  href: string;
};

function linksForCategory(state: string, category: string, stateName: string, systemName: string): ProgrammaticLink[] {
  // Common base — every state-tagged post benefits from the colleges
  // directory (high-leverage page that lists all colleges in the state).
  const collegesLink: ProgrammaticLink = {
    label: `Browse all ${systemName} colleges`,
    href: `/${state}/colleges`,
  };

  switch (category) {
    case "senior-waivers":
      // Audit-friendly content. Surface the colleges directory (lists
      // audit policies per college) and the courses search (filter
      // by audit eligibility).
      return [
        collegesLink,
        { label: `Search ${stateName} community college courses`, href: `/${state}/courses` },
        { label: `Find late-start sections in ${stateName}`, href: `/${state}/starting-soon` },
      ];

    case "registration-timing":
    case "session-timing":
      // Late-start / session-format content. Point at the starting-soon
      // tool and courses search, which is where the user converts on
      // these queries.
      return [
        { label: `${stateName} courses starting soon`, href: `/${state}/starting-soon` },
        { label: `Search ${stateName} community college courses`, href: `/${state}/courses` },
        collegesLink,
      ];

    case "transfer-confusion":
    case "state-system-explainers":
      // Transfer-themed content. Surface the transfer lookup as the
      // primary action.
      return [
        { label: `${stateName} transfer course finder`, href: `/${state}/transfer` },
        { label: `Search ${stateName} community college courses`, href: `/${state}/courses` },
        collegesLink,
      ];

    case "mistake-avoidance":
      // Prereq / planning content. Point at courses search where users
      // can look up specific course prereqs.
      return [
        { label: `Search ${stateName} community college courses`, href: `/${state}/courses` },
        collegesLink,
        { label: `${stateName} transfer course finder`, href: `/${state}/transfer` },
      ];

    case "course-format-density":
      // Hybrid / online content. Point at courses search (filter by
      // mode) and the colleges directory.
      return [
        { label: `Search ${stateName} community college courses`, href: `/${state}/courses` },
        collegesLink,
        { label: `${stateName} courses starting soon`, href: `/${state}/starting-soon` },
      ];

    case "cross-college-scheduling":
      return [
        collegesLink,
        { label: `Search ${stateName} community college courses`, href: `/${state}/courses` },
        { label: `${stateName} transfer course finder`, href: `/${state}/transfer` },
      ];

    default:
      // Conservative default — every state has these.
      return [
        collegesLink,
        { label: `Search ${stateName} community college courses`, href: `/${state}/courses` },
      ];
  }
}

export default function BlogProgrammaticLinks({
  state,
  category,
}: BlogProgrammaticLinksProps) {
  const config = getStateConfig(state);
  const links = linksForCategory(
    state,
    category,
    config.name,
    config.systemName
  );

  if (links.length === 0) return null;

  return (
    <aside className="not-prose mt-10 rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 px-5 py-4">
      <p className="text-sm font-semibold text-gray-900 dark:text-slate-100">
        Related {config.name} tools
      </p>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
        Use these to act on what you just read — search the catalog,
        compare colleges, or find sections that haven&apos;t started yet.
      </p>
      <ul className="mt-3 space-y-1.5">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-700 dark:text-teal-300 hover:text-teal-900 dark:hover:text-teal-200 transition-colors"
            >
              {link.label}
              <span aria-hidden="true">→</span>
            </Link>
          </li>
        ))}
      </ul>
    </aside>
  );
}

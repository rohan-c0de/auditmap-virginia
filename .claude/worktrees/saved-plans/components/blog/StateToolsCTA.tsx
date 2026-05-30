import Link from "next/link";
import { getStateConfig } from "@/lib/states/registry";

interface StateToolsCTAProps {
  state: string;
  variant: "top" | "bottom";
}

export default function StateToolsCTA({ state, variant }: StateToolsCTAProps) {
  const config = getStateConfig(state);
  const headline =
    variant === "top"
      ? `Looking up ${config.name} community college courses?`
      : `Use the ${config.name} tools`;
  const subhead =
    variant === "top"
      ? `Skip to the search and transfer tools for ${config.systemName} colleges.`
      : `Search ${config.systemName} courses, look up transfer credit, or build a schedule.`;

  return (
    <aside
      className={`not-prose rounded-xl border border-teal-200 dark:border-teal-800 bg-teal-50/60 dark:bg-teal-900/20 px-5 py-4 ${
        variant === "top" ? "mb-8" : "mt-10"
      }`}
    >
      <p className="text-sm font-semibold text-teal-900 dark:text-teal-200">
        {headline}
      </p>
      <p className="mt-1 text-sm text-teal-800 dark:text-teal-300">{subhead}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href={`/${state}`}
          className="inline-flex items-center rounded-md bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 transition-colors"
        >
          {`Find ${config.name} courses →`}
        </Link>
        {config.transferSupported && (
          <Link
            href={`/${state}/transfer`}
            className="inline-flex items-center rounded-md border border-teal-600 bg-white dark:bg-transparent px-3 py-1.5 text-xs font-medium text-teal-700 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-900/40 transition-colors"
          >
            {`${config.name} transfer lookup →`}
          </Link>
        )}
      </div>
    </aside>
  );
}

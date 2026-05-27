/**
 * CollegeContext — server-rendered editorial paragraphs above the college
 * page's stat grid. Computes data-grounded prose from the page's already-
 * loaded section data plus a few Supabase queries (transfers, ASSIST for CA).
 *
 * Returns null when fewer than 2 sentences qualify, so data-sparse colleges
 * don't render an empty heading.
 */

import {
  getCollegeInsights,
  type GetCollegeInsightsArgs,
} from "@/lib/college-insights";
import { renderCollegeProse } from "@/lib/insights-prose";

export default async function CollegeContext(
  args: GetCollegeInsightsArgs,
) {
  let paragraphs: string[] = [];
  try {
    const insights = await getCollegeInsights(args);
    paragraphs = renderCollegeProse(insights);
  } catch (err) {
    // Never let a context-rendering failure break the page. Log so the
    // signal still surfaces in Vercel logs without taking down the route.
    console.warn(
      `CollegeContext failed for ${args.state}/${args.institution.id}:`,
      err,
    );
    return null;
  }

  if (paragraphs.length === 0) return null;

  return (
    <section
      aria-label={`About ${args.institution.name}`}
      className="mt-2 mb-8 rounded-2xl border border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/40 px-6 py-6"
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 mb-4">
        at a glance
      </div>
      <div className="space-y-4 text-[15px] leading-relaxed text-gray-700 dark:text-slate-300">
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
    </section>
  );
}

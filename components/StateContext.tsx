/**
 * StateContext — server-rendered editorial paragraphs for the state landing
 * page. Aggregates statewide section counts, top subjects, transfer
 * destinations, ASSIST data (CA only), and Scorecard medians into 2–4
 * paragraphs of natural prose.
 *
 * Returns null when fewer than 2 sentences qualify, so sparse states don't
 * render an empty heading.
 */

import {
  getStateInsights,
  type GetStateInsightsArgs,
} from "@/lib/state-insights";
import { renderStateProse } from "@/lib/insights-prose";

export default async function StateContext(args: GetStateInsightsArgs) {
  let paragraphs: string[] = [];
  try {
    const insights = await getStateInsights(args);
    paragraphs = renderStateProse(insights);
  } catch (err) {
    console.warn(`StateContext failed for ${args.state}:`, err);
    return null;
  }

  if (paragraphs.length === 0) return null;

  return (
    <section
      aria-label={`About community colleges in ${args.stateName}`}
      className="py-12 px-4 sm:px-6 lg:px-8"
    >
      <div className="max-w-4xl mx-auto">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 mb-4">
          {args.stateName.toLowerCase()} community colleges at a glance
        </div>
        <div className="space-y-4 text-[15px] leading-relaxed text-gray-700 dark:text-slate-300">
          {paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </div>
    </section>
  );
}

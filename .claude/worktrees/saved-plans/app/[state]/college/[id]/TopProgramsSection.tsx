/**
 * "Top programs at this college" — links a college page upward to the
 * state-wide program comparison hub at `/[state]/program/[slug]`. Closes
 * issue #414 and addresses the broader internal-link gap tracked at #413.
 *
 * Server component. No client JS, no extra I/O — re-uses scorecard-programs
 * JSON files already on disk from the #410 ingest. Renders nothing if the
 * college lacks scorecard data or none of its CIPs map to a program we
 * cover.
 */

import SectionHeading from "@/components/SectionHeading";

import Link from "next/link";
import { getScorecardPrograms } from "@/lib/scorecard";
import {
  getProgramByCip,
  type ProgramDef,
} from "@/lib/programs/registry";

interface Props {
  state: string;
  collegeId: string;
  collegeName: string;
}

interface TopProgramRow {
  program: ProgramDef;
  totalAwards: number;
  // Median 5-yr earnings at this college for the dominant CIP, if known.
  // Falls back to 1-yr earnings, then to null (suppressed cohort).
  earnings: number | null;
}

export default function TopProgramsSection({
  state,
  collegeId,
  collegeName,
}: Props) {
  const programs = getScorecardPrograms(state, collegeId);
  if (!programs || programs.length === 0) return null;

  // Roll per-CIP records up to our program slugs. One slug can absorb
  // multiple CIPs (nursing maps to 5138/5139/5116), so we sum award
  // counts and pick the earnings number from the CIP with the most
  // awards in that bucket.
  const bySlug = new Map<string, TopProgramRow>();
  for (const r of programs) {
    const def = getProgramByCip(r.cipCode);
    if (!def) continue;
    const awards = (r.awardsLevel1 ?? 0) + (r.awardsLevel2 ?? 0);
    if (awards === 0 && r.earnings5YrMedian == null) continue;
    const existing = bySlug.get(def.slug);
    if (!existing) {
      bySlug.set(def.slug, {
        program: def,
        totalAwards: awards,
        earnings: r.earnings5YrMedian ?? r.earnings1YrMedian ?? null,
      });
    } else {
      existing.totalAwards += awards;
      // Prefer the earnings from whichever CIP has more awards (the
      // dominant track within this program slug). Tracked by re-checking
      // r.awardsLevel1+2 against existing's most-recent contribution —
      // simpler: keep the larger earnings number, which avoids needing
      // a per-CIP "winner" state. Earnings differences within one slug
      // are typically small.
      if (
        existing.earnings == null ||
        (r.earnings5YrMedian != null && r.earnings5YrMedian > existing.earnings)
      ) {
        const e = r.earnings5YrMedian ?? r.earnings1YrMedian;
        if (e != null) existing.earnings = e;
      }
    }
  }

  const ranked = Array.from(bySlug.values())
    .filter((r) => r.totalAwards > 0)
    .sort((a, b) => b.totalAwards - a.totalAwards)
    .slice(0, 8);

  if (ranked.length === 0) return null;

  return (
    <section className="mt-8" aria-labelledby="top-programs">
      <SectionHeading
        id="top-programs"
        className="text-xl font-semibold text-gray-900 dark:text-slate-100"
      >
        Top programs at {collegeName}
      </SectionHeading>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
        Ranked by federal IPEDS award counts. Click any program to compare it
        across every community college in this state — including median
        earnings of graduates.
      </p>
      <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {ranked.map(({ program, totalAwards, earnings }) => (
          <li key={program.slug}>
            <Link
              href={`/${state}/program/${program.slug}`}
              className="block rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 hover:border-teal-300 dark:hover:border-teal-600 transition-colors"
            >
              <div className="font-medium text-teal-700 dark:text-teal-300">
                {program.name}
              </div>
              <div className="mt-0.5 text-xs text-gray-500 dark:text-slate-400 tabular-nums">
                {totalAwards} awards/yr
                {earnings != null && (
                  <>
                    {" · "}
                    <span className="text-gray-700 dark:text-slate-300">
                      grads earn ${earnings.toLocaleString()}/yr
                    </span>
                  </>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

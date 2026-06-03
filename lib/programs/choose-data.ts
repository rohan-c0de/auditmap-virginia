/**
 * Server-only fact gatherer for the "Help me choose" flow.
 *
 * Kept separate from `choose.ts` (the client-safe taxonomy + pure logic) so
 * that importing the quiz UI never drags Supabase / `node:fs` into the client
 * bundle. Reads ONLY runtime-available sources:
 *   - live sections via `loadProgramData` (Supabase — same path the
 *     /[state]/programs index uses, cached + ISR)
 *   - BLS wages from the bundled `data/bls/wages.json` (fs)
 *
 * Emits a fact ONLY for slugs that clear `qualifies()`, so a recommendation
 * can never link to a program page that soft-404s. Never fabricates a number:
 * every field is a measured value or null.
 */

import { loadProgramData, qualifies } from "./index";
import { getProgramBySlug } from "./registry";
import { relevantSlugs, type ChooseProgramFact } from "./choose";
import { computeCourseAvailabilityProfile } from "@/lib/course-stats";
import { getStateSocStats } from "@/lib/bls";

/**
 * Gather honest facts for every quiz-relevant program that QUALIFIES in the
 * state this term. Cost profile mirrors the /[state]/programs index
 * (loadProgramData per slug, cached). Returns only qualifying slugs.
 */
export async function gatherChooseFacts(
  state: string,
): Promise<ChooseProgramFact[]> {
  const results = await Promise.all(
    relevantSlugs().map(async (slug) => {
      const def = getProgramBySlug(slug);
      if (!def) return null;
      const data = await loadProgramData(state, slug).catch(() => null);
      if (!data || !qualifies(data)) return null;

      const profile = computeCourseAvailabilityProfile(data.flatSections);
      const onlinePct = profile
        ? Math.round(
            (profile.modes.pcts.online ?? 0) + (profile.modes.pcts.zoom ?? 0),
          )
        : null;
      const eveningAvailable = profile ? profile.timeOfDay.evening > 0 : false;
      const medianWage = def.primarySoc
        ? getStateSocStats(state, def.primarySoc)?.medianAnnualWage ?? null
        : null;

      return {
        slug,
        name: def.name,
        blurb: def.description,
        collegeCount: data.totalColleges,
        sectionCount: data.totalSections,
        onlinePct,
        eveningAvailable,
        medianWage,
        careerOriented: def.primarySoc != null,
      } satisfies ChooseProgramFact;
    }),
  );

  return results.filter((r): r is ChooseProgramFact => r !== null);
}

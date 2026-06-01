/**
 * Per-state insight bundler. Returns a fact bag the prose renderer (in
 * `lib/insights-prose.ts`) turns into editorial paragraphs on the state
 * landing page.
 *
 * As with `college-insights`, every field is optional and present only when
 * the underlying data is non-null. Sparse states should render shorter
 * context blocks rather than padded ones.
 */

import { loadInstitutions } from "@/lib/institutions";
import { getStateRankings } from "@/lib/college-insights";
// Snapshot-only helpers replace the previous `loadAllCourses` Supabase
// fan-out used to derive totalSections + topSubjects. Same data, zero
// network — see lib/courses.ts for why this matters during static gen.
import {
  getStateSectionTotalFromSnapshot,
  getStateTopSubjectsFromSnapshot,
} from "@/lib/courses";
import { getStateAggregates, type StateScorecardAggregates } from "@/lib/scorecard";
import { getArticlesByState } from "@/lib/blog";
import { supabase } from "@/lib/supabase";
import type { TransferDestRollup } from "@/scripts/build-transfer-dest-rollup";
import * as fs from "node:fs";
import * as path from "node:path";

export interface StateInsightCollegeRef {
  collegeCode: string;
  collegeName: string;
  sectionCount: number;
}

export interface StateInsightSubject {
  prefix: string;
  sectionCount: number;
  collegesOffering: number;
}

export interface StateInsightTransferDest {
  university: string;
  mappingCount: number;
}

export interface StateInsightAssistPair {
  ccSlug: string;
  ccName: string;
  uniSlug: string;
  uniName: string;
  agreementCount: number;
}

export interface StateInsights {
  state: string;
  stateName: string;
  systemName: string;

  /** Term these insights summarize. */
  term: string | null;

  /** Total course sections statewide this term. */
  totalSections: number | null;
  /** Number of colleges with at least one section this term. */
  collegesWithData: number;
  /** Number of colleges in the state per registry, regardless of data. */
  totalColleges: number;

  largestCollege: StateInsightCollegeRef | null;
  smallestCollege: StateInsightCollegeRef | null;
  topSubjects: StateInsightSubject[];

  topTransferDestinations: StateInsightTransferDest[];
  totalTransferMappings: number | null;

  /** CA-only: total ASSIST agreements for the state. */
  assistAgreementCount: number | null;
  /** CA-only: top 3 CC→Uni pairs by agreement count. */
  assistTopPairs: StateInsightAssistPair[];

  blogPostCount: number;

  seniorWaiver: {
    ageThreshold: number;
    legalCitation: string;
    bannerDetail: string;
  } | null;

  scorecard: {
    medianTuition: number | null;
    medianNetPrice: number | null;
    medianEarnings: number | null;
    medianCompletion: number | null;
  } | null;
}

// ---------------------------------------------------------------------------
// Process-cached transfer + ASSIST aggregations (heavy queries)
// ---------------------------------------------------------------------------

function loadStateTransferDestinations(
  state: string,
): { destinations: StateInsightTransferDest[]; total: number } {
  const rollupPath = path.join(process.cwd(), "data", state, "transfer-dest-rollup.json");
  try {
    const raw = fs.readFileSync(rollupPath, "utf8");
    const rollup = JSON.parse(raw) as TransferDestRollup;
    return { destinations: rollup.destinations, total: rollup.total };
  } catch {
    return { destinations: [], total: 0 };
  }
}

const stateAssistCache = new Map<
  string,
  Promise<{ count: number; topPairs: StateInsightAssistPair[] }>
>();

async function loadStateAssistContext(
  state: string,
): Promise<{ count: number; topPairs: StateInsightAssistPair[] }> {
  const existing = stateAssistCache.get(state);
  if (existing) return existing;

  const promise = (async () => {
    const { data, error, count } = await supabase
      .from("assist_agreements")
      .select(
        "cc_slug, cc_name, receiving_institution_slug, receiving_institution_name",
        { count: "exact" },
      )
      .eq("state", state);

    if (error) {
      console.warn(`loadStateAssistContext error for ${state}:`, error.message);
      return { count: 0, topPairs: [] as StateInsightAssistPair[] };
    }
    const rows = data ?? [];
    if (rows.length === 0) {
      return { count: 0, topPairs: [] as StateInsightAssistPair[] };
    }

    const pairTally = new Map<
      string,
      { ccSlug: string; ccName: string; uniSlug: string; uniName: string; count: number }
    >();
    for (const r of rows) {
      const key = `${r.cc_slug}|${r.receiving_institution_slug}`;
      const entry = pairTally.get(key);
      if (entry) entry.count += 1;
      else
        pairTally.set(key, {
          ccSlug: r.cc_slug as string,
          ccName: r.cc_name as string,
          uniSlug: r.receiving_institution_slug as string,
          uniName: r.receiving_institution_name as string,
          count: 1,
        });
    }
    const topPairs = Array.from(pairTally.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map((p) => ({
        ccSlug: p.ccSlug,
        ccName: p.ccName,
        uniSlug: p.uniSlug,
        uniName: p.uniName,
        agreementCount: p.count,
      }));

    return { count: count ?? rows.length, topPairs };
  })();

  stateAssistCache.set(state, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// Top subjects statewide
// ---------------------------------------------------------------------------

// (Previously: tallyTopSubjects(sections: CourseSection[]) — replaced by
// getStateTopSubjectsFromSnapshot in lib/courses.ts.)

// ---------------------------------------------------------------------------
// Main bundler
// ---------------------------------------------------------------------------

export interface GetStateInsightsArgs {
  state: string;
  stateName: string;
  systemName: string;
  /** Most-recent term with data for the state. */
  term: string | null;
  seniorWaiver: {
    ageThreshold: number;
    legalCitation: string;
    bannerDetail: string;
  } | null;
}

export async function getStateInsights(
  args: GetStateInsightsArgs,
): Promise<StateInsights> {
  const { state, stateName, systemName, term, seniorWaiver } = args;
  const institutions = loadInstitutions(state);
  const totalColleges = institutions.length;

  const codeToName = new Map<string, string>();
  for (const i of institutions) codeToName.set(i.college_slug, i.name);

  // Fan out the heavy queries in parallel. Note: the previous version
  // included `loadAllCourses(term, state)` here — a paginated Supabase
  // catalog download. It saturated the connection pool when 51 states
  // rendered during static gen and was the second of two killers (the
  // first being `getCourseCount` fan-out from /colleges) behind the
  // "Failed to build /[state]/page: /va after 3 attempts" failures.
  // Replaced with snapshot-derived aggregates below.
  const [
    rankings,
    transferAgg,
    assistAgg,
    scorecardAgg,
  ] = await Promise.all([
    term ? getStateRankings(state, term).catch(() => null) : Promise.resolve(null),
    Promise.resolve(loadStateTransferDestinations(state)),
    state === "ca"
      ? loadStateAssistContext(state).catch(() => ({
          count: 0,
          topPairs: [] as StateInsightAssistPair[],
        }))
      : Promise.resolve({ count: 0, topPairs: [] as StateInsightAssistPair[] }),
    Promise.resolve(getStateAggregates(state)),
  ]);

  const totalSections = term ? getStateSectionTotalFromSnapshot(state, term) || null : null;
  const topSubjects = term ? getStateTopSubjectsFromSnapshot(state, term, 3) : [];

  let largestCollege: StateInsightCollegeRef | null = null;
  let smallestCollege: StateInsightCollegeRef | null = null;
  if (rankings && rankings.sectionRanks.length > 0) {
    const head = rankings.sectionRanks[0];
    const tail = rankings.sectionRanks[rankings.sectionRanks.length - 1];
    largestCollege = head
      ? {
          collegeCode: head.collegeCode,
          collegeName: codeToName.get(head.collegeCode) ?? head.collegeCode,
          sectionCount: head.count,
        }
      : null;
    // Only surface "smallest" if there are ≥ 3 colleges in the rankings —
    // otherwise it's a meaningless callout.
    smallestCollege =
      rankings.sectionRanks.length >= 3 && tail
        ? {
            collegeCode: tail.collegeCode,
            collegeName: codeToName.get(tail.collegeCode) ?? tail.collegeCode,
            sectionCount: tail.count,
          }
        : null;
  }

  const blogPostCount = getArticlesByState(state).length;

  return {
    state,
    stateName,
    systemName,
    term,
    totalSections,
    collegesWithData: rankings?.sectionRanks.length ?? 0,
    totalColleges,
    largestCollege,
    smallestCollege,
    topSubjects,
    topTransferDestinations: transferAgg.destinations.slice(0, 3),
    totalTransferMappings: transferAgg.total > 0 ? transferAgg.total : null,
    assistAgreementCount: assistAgg.count > 0 ? assistAgg.count : null,
    assistTopPairs: assistAgg.topPairs,
    blogPostCount,
    seniorWaiver,
    scorecard: buildScorecardSummary(scorecardAgg),
  };
}

function buildScorecardSummary(
  agg: StateScorecardAggregates,
): StateInsights["scorecard"] {
  if (
    agg.medianTuitionInState == null &&
    agg.medianNetPrice == null &&
    agg.medianEarnings == null &&
    agg.medianCompletionRate == null
  ) {
    return null;
  }
  return {
    medianTuition: agg.medianTuitionInState,
    medianNetPrice: agg.medianNetPrice,
    medianEarnings: agg.medianEarnings,
    medianCompletion: agg.medianCompletionRate,
  };
}

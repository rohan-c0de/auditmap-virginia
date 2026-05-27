/**
 * Per-college insight bundler. Returns a fact bag the prose renderer (in
 * `lib/insights-prose.ts`) turns into editorial paragraphs on the college
 * detail page.
 *
 * Every field on `CollegeInsights` is optional and present only when the
 * underlying data is non-null. The renderer's job is to skip facts that are
 * missing or unremarkable — so this bundler should never fabricate values to
 * fill gaps. Better to render shorter prose on data-poor colleges than
 * templated padding.
 *
 * What we layer on top of existing utilities:
 *  - `computeOfferingProfile` (lib/college-stats) → mode mix, top subjects,
 *    late-start count
 *  - Per-college rank within the state for section count + late-start count
 *    + online share (computed from state-wide section data, cached)
 *  - Mode-mix deltas vs. state median percentages
 *  - Top transfer-destination universities from the `transfers` table
 *  - ASSIST agreement counts for CA colleges only (Phase 3 data)
 *  - Scorecard cost/earnings with state-median comparison
 */

import type { CourseSection, Institution } from "@/lib/types";
import { computeOfferingProfile } from "@/lib/college-stats";
import {
  getScorecard,
  getStateAggregates,
  type ScorecardRecord,
  type StateScorecardAggregates,
} from "@/lib/scorecard";
import { loadAllCourses } from "@/lib/courses";
import { supabase } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Public shape
// ---------------------------------------------------------------------------

export interface CollegeRank {
  /** 1 = largest in the state. */
  position: number;
  /** Total colleges in the state with data for the same metric. */
  outOf: number;
  /** This college's value. */
  value: number;
}

export interface ModeShare {
  /** Percentage of sections in this mode at this college (0–100). */
  pct: number;
  /** State median percentage for the same mode (0–100). */
  statePct: number;
  /** `pct - statePct`, positive if college is above the state median. */
  delta: number;
}

export interface TransferDestination {
  university: string;
  /** Total course→university equivalencies this CC has with the university. */
  mappingCount: number;
}

export interface ScorecardContext {
  /** Median in-state tuition at this college, $. */
  tuition: number | null;
  /** State-median in-state tuition for context. */
  tuitionStateMedian: number | null;
  /** Median 10-yr-after-entry earnings, $. */
  earnings10yr: number | null;
  /** State-median 10-yr earnings for context. */
  earningsStateMedian: number | null;
  /** First-year retention rate (full-time), 0–1. */
  retentionFullTime: number | null;
  /** Share of students receiving Pell grants, 0–1. */
  pellRate: number | null;
  /** State-average Pell rate. */
  pellStateAvg: number | null;
}

export interface CollegeInsights {
  state: string;
  collegeId: string;
  collegeName: string;
  systemName: string;

  /** Most-recent term's offering profile (sections, modes, top subjects). */
  term: string;
  termSectionCount: number | null;

  /** Rank within the state by total sections offered this term. */
  sectionRank: CollegeRank | null;

  /** Top 3 subjects this term, with state-rank context if available. */
  topSubjects: Array<{ prefix: string; sections: number }>;

  /** Mode mix vs. state median for this term. */
  modeShares: {
    inPerson: ModeShare | null;
    hybrid: ModeShare | null;
    online: ModeShare | null;
  };

  /** Number of late-start sections (>14 days after earliest term start). */
  lateStartCount: number | null;
  /** Rank within state for late-start density. */
  lateStartRank: CollegeRank | null;

  /** Top 3 receiving universities by mapping count (from `transfers` table). */
  topTransferDestinations: TransferDestination[];

  /** Total transfer mappings on file for this college. */
  totalTransferMappings: number | null;

  /** CA-only: number of ASSIST agreements (CC → uni → major triples). */
  assistAgreementCount: number | null;
  /** CA-only: top 3 receiving universities by agreement count. */
  assistTopUniversities: Array<{ slug: string; name: string; count: number }>;

  /** Scorecard cost/earnings context vs. state. */
  scorecard: ScorecardContext | null;

  /** Has a senior tuition waiver (from state config). */
  seniorWaiver: { ageThreshold: number; legalCitation: string } | null;

  /** Campus locations (cities) — surfaces "near [city]" prose. */
  primaryCity: string | null;
  additionalCities: string[];
}

// ---------------------------------------------------------------------------
// State-wide ranking cache
// ---------------------------------------------------------------------------

interface StateRankings {
  /** Per-college section count, sorted desc. */
  sectionRanks: Array<{ collegeCode: string; count: number }>;
  /** Per-college late-start count, sorted desc. */
  lateStartRanks: Array<{ collegeCode: string; count: number }>;
  /** State-median mode percentages across colleges with ≥ 25 sections. */
  modeMedians: { inPerson: number; hybrid: number; online: number };
}

const rankingsCache = new Map<string, Promise<StateRankings | null>>();

/**
 * Build per-college section/late-start rankings + state-median mode shares
 * for the given state/term. Loads all state courses once and caches the
 * result for the duration of the process — fine for ISR builds since each
 * page rebuild gets a fresh process.
 *
 * Returns null when the state has no course data for the term.
 */
export async function getStateRankings(
  state: string,
  term: string,
): Promise<StateRankings | null> {
  const key = `${state}:${term}`;
  const existing = rankingsCache.get(key);
  if (existing) return existing;

  const promise = (async (): Promise<StateRankings | null> => {
    const sections = await loadAllCourses(term, state);
    if (sections.length === 0) return null;

    // Group sections by college_code.
    const byCollege = new Map<string, CourseSection[]>();
    for (const s of sections) {
      const list = byCollege.get(s.college_code);
      if (list) list.push(s);
      else byCollege.set(s.college_code, [s]);
    }

    const sectionCounts: Array<{ collegeCode: string; count: number }> = [];
    const lateStartCounts: Array<{ collegeCode: string; count: number }> = [];
    const modeRows: Array<{
      inPerson: number;
      hybrid: number;
      online: number;
    }> = [];

    for (const [collegeCode, list] of byCollege) {
      sectionCounts.push({ collegeCode, count: list.length });

      const profile = computeOfferingProfile(list);
      if (profile) {
        lateStartCounts.push({
          collegeCode,
          count: profile.lateStartCount,
        });
        if (list.length >= 25) {
          modeRows.push({
            inPerson: profile.modes.modePcts["in-person"] ?? 0,
            hybrid: profile.modes.modePcts["hybrid"] ?? 0,
            // Combine `online` + `zoom` — both are remote synchronous-or-not.
            online:
              (profile.modes.modePcts["online"] ?? 0) +
              (profile.modes.modePcts["zoom"] ?? 0),
          });
        }
      }
    }

    sectionCounts.sort((a, b) => b.count - a.count);
    lateStartCounts.sort((a, b) => b.count - a.count);

    const med = (xs: number[]): number => {
      if (xs.length === 0) return 0;
      const sorted = [...xs].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
    };

    return {
      sectionRanks: sectionCounts,
      lateStartRanks: lateStartCounts,
      modeMedians: {
        inPerson: med(modeRows.map((r) => r.inPerson)),
        hybrid: med(modeRows.map((r) => r.hybrid)),
        online: med(modeRows.map((r) => r.online)),
      },
    };
  })();

  rankingsCache.set(key, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// Transfer destination aggregation (Supabase)
// ---------------------------------------------------------------------------

const transferDestCache = new Map<string, Promise<TransferDestination[]>>();

/**
 * Top receiving universities for a given CC's course catalog, ordered by
 * mapping count desc. Limited to top 10.
 *
 * `subjectPrefixes` scopes the aggregation so we don't pull the full state
 * catalog. Pass the prefixes the college actually offers.
 */
async function loadTopTransferDestinations(
  state: string,
  ccSlug: string,
  subjectPrefixes: string[],
): Promise<TransferDestination[]> {
  if (subjectPrefixes.length === 0) return [];

  const key = `${state}:${ccSlug}:${[...subjectPrefixes].sort().join("|")}`;
  const existing = transferDestCache.get(key);
  if (existing) return existing;

  const promise = (async (): Promise<TransferDestination[]> => {
    const { data, error } = await supabase
      .from("transfers")
      .select("university, univ_course")
      .eq("state", state)
      .in("cc_prefix", subjectPrefixes);

    if (error) {
      console.warn(
        `loadTopTransferDestinations error for ${state}/${ccSlug}:`,
        error.message,
      );
      return [];
    }

    const tally = new Map<string, number>();
    for (const row of data ?? []) {
      // Skip combo-credit placeholders like "**** ****".
      if (row.univ_course && row.univ_course.includes("*")) continue;
      const u = row.university;
      if (!u) continue;
      tally.set(u, (tally.get(u) ?? 0) + 1);
    }

    return Array.from(tally.entries())
      .map(([university, mappingCount]) => ({ university, mappingCount }))
      .sort((a, b) => b.mappingCount - a.mappingCount)
      .slice(0, 10);
  })();

  transferDestCache.set(key, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// ASSIST aggregation (CA only)
// ---------------------------------------------------------------------------

const assistCache = new Map<
  string,
  Promise<{
    count: number;
    topUniversities: Array<{ slug: string; name: string; count: number }>;
  }>
>();

async function loadAssistContext(
  ccSlug: string,
): Promise<{
  count: number;
  topUniversities: Array<{ slug: string; name: string; count: number }>;
}> {
  const existing = assistCache.get(ccSlug);
  if (existing) return existing;

  const promise = (async () => {
    const { data, error } = await supabase
      .from("assist_agreements")
      .select(
        "receiving_institution_slug, receiving_institution_name, major_slug",
      )
      .eq("state", "ca")
      .eq("cc_slug", ccSlug);

    if (error) {
      console.warn(`loadAssistContext error for ${ccSlug}:`, error.message);
      return { count: 0, topUniversities: [] };
    }
    const rows = data ?? [];
    if (rows.length === 0) return { count: 0, topUniversities: [] };

    const byUni = new Map<string, { name: string; count: number }>();
    for (const r of rows) {
      const slug = r.receiving_institution_slug as string;
      const name = r.receiving_institution_name as string;
      if (!slug || !name) continue;
      const entry = byUni.get(slug);
      if (entry) entry.count += 1;
      else byUni.set(slug, { name, count: 1 });
    }
    const topUniversities = Array.from(byUni.entries())
      .map(([slug, v]) => ({ slug, name: v.name, count: v.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
    return { count: rows.length, topUniversities };
  })();

  assistCache.set(ccSlug, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// Main bundler
// ---------------------------------------------------------------------------

export interface GetCollegeInsightsArgs {
  state: string;
  /** Full state name, e.g. "Virginia". */
  stateName: string;
  /** State CC-system short name, e.g. "VCCS". */
  systemName: string;
  institution: Institution;
  /** Section list for the rendered term — usually the page's `defaultTerm`. */
  sections: CourseSection[];
  /** The term these sections belong to (used for cross-college ranking). */
  term: string;
  /** Optional senior waiver from state config; surfaces in prose if present. */
  seniorWaiver: { ageThreshold: number; legalCitation: string } | null;
}

/**
 * Build the per-college insight bundle. Pulls in:
 *  - The college's own section profile (synchronous, in-memory)
 *  - State-wide rankings (cached)
 *  - Transfer destinations (Supabase, cached)
 *  - ASSIST counts for CA only (Supabase, cached)
 *  - Scorecard context (from local data files)
 *
 * Failures in any branch degrade gracefully — the field comes back null and
 * the prose renderer omits the corresponding sentence.
 */
export async function getCollegeInsights(
  args: GetCollegeInsightsArgs,
): Promise<CollegeInsights> {
  const {
    state,
    institution,
    sections,
    term,
    seniorWaiver,
    systemName,
  } = args;
  const collegeId = institution.id;
  const collegeCode = institution.college_slug;
  const collegeName = institution.name;

  // 1) This college's offering profile (fast, in-memory).
  const profile = computeOfferingProfile(sections);
  const termSectionCount = profile?.total ?? null;
  const topSubjects = profile?.topSubjects.slice(0, 3) ?? [];
  const lateStartCount = profile?.lateStartCount ?? null;

  // Resolve subject prefixes for transfer destination aggregation.
  const subjectPrefixes = Array.from(
    new Set(sections.map((s) => s.course_prefix).filter(Boolean)),
  );

  // 2-5) Fan out the slow branches in parallel.
  const [rankings, destinations, assistContext, scorecardRecord, stateAgg] =
    await Promise.all([
      getStateRankings(state, term).catch(() => null),
      loadTopTransferDestinations(state, collegeCode, subjectPrefixes).catch(
        () => [] as TransferDestination[],
      ),
      // ASSIST data only exists for CA at this time.
      state === "ca"
        ? loadAssistContext(collegeCode).catch(() => ({
            count: 0,
            topUniversities: [] as Array<{
              slug: string;
              name: string;
              count: number;
            }>,
          }))
        : Promise.resolve({
            count: 0,
            topUniversities: [] as Array<{
              slug: string;
              name: string;
              count: number;
            }>,
          }),
      Promise.resolve(getScorecard(state, collegeId)),
      Promise.resolve(getStateAggregates(state)),
    ]);

  // Compute ranks once we have state-wide rankings.
  const sectionRank = computeRank(
    rankings?.sectionRanks ?? [],
    collegeCode,
  );
  const lateStartRank = computeRank(
    rankings?.lateStartRanks ?? [],
    collegeCode,
  );

  // Mode shares vs. state median (only when state median is meaningful and
  // this college has enough sections to compute a stable share).
  const modeShares = computeModeShares(profile, rankings);

  const scorecard = buildScorecardContext(scorecardRecord, stateAgg);

  // Campus → cities (use distinct campus names as a cheap city proxy when no
  // separate city field exists). Some configs store the campus name as
  // "Annandale" already; for those we expose them as the "city" surface.
  const cityList = uniqueCities(institution);
  const primaryCity = cityList[0] ?? null;
  const additionalCities = cityList.slice(1, 4);

  return {
    state,
    collegeId,
    collegeName,
    systemName,
    term,
    termSectionCount,
    sectionRank,
    topSubjects,
    modeShares,
    lateStartCount,
    lateStartRank,
    topTransferDestinations: destinations.slice(0, 3),
    totalTransferMappings: destinations.length === 0
      ? null
      : destinations.reduce((a, b) => a + b.mappingCount, 0),
    assistAgreementCount: assistContext.count > 0 ? assistContext.count : null,
    assistTopUniversities: assistContext.topUniversities,
    scorecard,
    seniorWaiver,
    primaryCity,
    additionalCities,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeRank(
  list: Array<{ collegeCode: string; count: number }>,
  collegeCode: string,
): CollegeRank | null {
  if (list.length === 0) return null;
  const idx = list.findIndex((e) => e.collegeCode === collegeCode);
  if (idx === -1) return null;
  return {
    position: idx + 1,
    outOf: list.length,
    value: list[idx].count,
  };
}

function computeModeShares(
  profile: ReturnType<typeof computeOfferingProfile>,
  rankings: StateRankings | null,
): CollegeInsights["modeShares"] {
  if (!profile || profile.total < 25) {
    return { inPerson: null, hybrid: null, online: null };
  }
  const meds = rankings?.modeMedians;
  if (!meds) return { inPerson: null, hybrid: null, online: null };

  const inPersonPct = profile.modes.modePcts["in-person"] ?? 0;
  const hybridPct = profile.modes.modePcts["hybrid"] ?? 0;
  const onlinePct =
    (profile.modes.modePcts["online"] ?? 0) +
    (profile.modes.modePcts["zoom"] ?? 0);

  return {
    inPerson: {
      pct: inPersonPct,
      statePct: meds.inPerson,
      delta: inPersonPct - meds.inPerson,
    },
    hybrid: {
      pct: hybridPct,
      statePct: meds.hybrid,
      delta: hybridPct - meds.hybrid,
    },
    online: {
      pct: onlinePct,
      statePct: meds.online,
      delta: onlinePct - meds.online,
    },
  };
}

function buildScorecardContext(
  record: ScorecardRecord | null,
  agg: StateScorecardAggregates,
): ScorecardContext | null {
  if (!record) return null;
  return {
    tuition: record.cost.tuitionInState,
    tuitionStateMedian: agg.medianTuitionInState,
    earnings10yr: record.earnings.median10YrsAfterEntry,
    earningsStateMedian: agg.medianEarnings,
    retentionFullTime: record.completion.retentionRateFullTime,
    pellRate: record.aid.pellGrantRate,
    pellStateAvg: agg.avgPellRate,
  };
}

function uniqueCities(institution: Institution): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of institution.campuses ?? []) {
    const name = c.name?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

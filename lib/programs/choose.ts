/**
 * "Help me choose" guided-flow data layer + pure recommendation logic.
 *
 * Powers `/[state]/choose`: a short interest → goal → schedule quiz that
 * points an undecided student at real program comparison pages. Owner-
 * approved concept (the `choose.html` prototype); this is the production
 * wiring against the REAL catalog.
 *
 * Two halves, deliberately separated:
 *
 *  1. PURE LOGIC (`recommend`, the FIELDS/GOALS/TIMES taxonomy) — no I/O,
 *     fully unit-tested. Given a set of program facts and the student's
 *     three answers, returns the ordered matches.
 *
 *  2. SERVER GATHERER (`gatherChooseFacts`) — reads only data sources proven
 *     available at runtime: live sections via `loadProgramData` (Supabase,
 *     same path the /[state]/programs index uses) + BLS wages (bundled
 *     file). It NEVER fabricates a number; every field is a measured value
 *     or null. Slugs are emitted ONLY when they clear `qualifies()`, so a
 *     recommendation can never link to a program page that soft-404s.
 *
 * Design decisions worth keeping (verified against real data 2026-06-02):
 *  - Field taxonomy maps onto slugs that actually qualify. Each non-trades
 *    field has at least one near-universally-qualifying anchor (psychology,
 *    biology, mathematics, liberal-arts) so results are rarely empty. Trades
 *    is genuinely state-limited by data; the UI says so and offers an escape.
 *  - Job-vs-transfer orientation comes from the registry `primarySoc`
 *    (non-null = a direct CC career path; null = transfer-oriented), NOT from
 *    scraped `total_credits`/credentials, which are only 3–18% populated in
 *    some states.
 *  - No transfer-coverage % is computed here: `transfer-equiv.json` is
 *    excluded from runtime bundles, and career programs legitimately have
 *    ~0 transfer rows. The UI links to the existing transfer views instead.
 */

import { loadProgramData, qualifies } from "./index";
import { getProgramBySlug } from "./registry";
import { computeCourseAvailabilityProfile } from "@/lib/course-stats";
import { getStateSocStats } from "@/lib/bls";

// ---------------------------------------------------------------------------
// Quiz taxonomy (config-driven — tune the field→slug map in one place)
// ---------------------------------------------------------------------------

export type FieldId = "business" | "health" | "stem" | "arts" | "trades";
export type GoalId = "job" | "transfer" | "pay";
export type TimeId = "fulltime" | "parttime" | "evening" | "online";

export type FieldDef = {
  id: FieldId;
  /** Card title shown in the quiz. */
  label: string;
  /** One-line plain-language hint under the title. */
  desc: string;
  /**
   * Registry program slugs this interest maps to. A slug may appear under
   * more than one field (e.g. biology under both health and stem) — that's
   * intentional; goal/time ordering surfaces the most relevant first.
   */
  slugs: string[];
  /** Inline SVG path(s) for the card icon (no <svg> wrapper). */
  iconPath: string;
};

/**
 * Order matters — this is the on-screen order of Q1. Every field except
 * `trades` includes at least one slug that qualifies in nearly every state
 * with program data, so a student rarely hits an empty result.
 */
export const FIELDS: FieldDef[] = [
  {
    id: "business",
    label: "Business & money",
    desc: "Accounting, management, marketing",
    slugs: ["business-administration", "accounting"],
    iconPath: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  },
  {
    id: "health",
    label: "Health & helping people",
    desc: "Nursing, child care, psychology",
    slugs: ["nursing", "early-childhood-education", "psychology", "biology"],
    iconPath:
      '<path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 5.5-7 10-7 10z"/>',
  },
  {
    id: "stem",
    label: "Science, tech & math",
    desc: "Computers, engineering, math",
    slugs: ["computer-science", "engineering", "mathematics", "biology"],
    iconPath:
      '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/>',
  },
  {
    id: "arts",
    label: "Arts & humanities",
    desc: "English, history, art, liberal arts",
    slugs: ["english", "history", "art", "liberal-arts"],
    iconPath:
      '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  },
  {
    id: "trades",
    label: "Hands-on & trades",
    desc: "Welding, automotive, criminal justice",
    slugs: ["welding", "automotive-technology", "criminal-justice"],
    iconPath:
      '<path d="M14.7 6.3a4 4 0 0 0-5.6 5.6L3 18l3 3 6.1-6.1a4 4 0 0 0 5.6-5.6l-2.9 2.9-2-2 2.9-2.9z"/>',
  },
];

export type GoalDef = {
  id: GoalId;
  label: string;
  desc: string;
  iconPath: string;
};

export const GOALS: GoalDef[] = [
  {
    id: "job",
    label: "A job, soon",
    desc: "Start working as fast as I can",
    iconPath:
      '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  },
  {
    id: "transfer",
    label: "Transfer to a 4-year",
    desc: "A bachelor's degree is the goal",
    iconPath: '<path d="M4 7h12M12 3l4 4-4 4"/><path d="M20 17H8M12 21l-4-4 4-4"/>',
  },
  {
    id: "pay",
    label: "The highest pay",
    desc: "Earnings matter most to me",
    iconPath: '<path d="M3 17l6-6 4 4 7-8"/><path d="M21 7v5h-5"/>',
  },
];

export type TimeDef = {
  id: TimeId;
  label: string;
  desc: string;
  iconPath: string;
};

export const TIMES: TimeDef[] = [
  {
    id: "fulltime",
    label: "Full-time",
    desc: "I can take a full load",
    iconPath: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  },
  {
    id: "parttime",
    label: "Part-time",
    desc: "A class or two at a time",
    iconPath: '<circle cx="12" cy="12" r="9"/><path d="M12 12V8M12 12h4"/>',
  },
  {
    id: "evening",
    label: "Evenings & weekends",
    desc: "I work during the day",
    iconPath: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  },
  {
    id: "online",
    label: "Online",
    desc: "I'd rather study from home",
    iconPath:
      '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  },
];

export const FIELD_IDS = FIELDS.map((f) => f.id);
export const GOAL_IDS = GOALS.map((g) => g.id);
export const TIME_IDS = TIMES.map((t) => t.id);

// ---------------------------------------------------------------------------
// Facts (gathered server-side, serialized to the client). All values are
// measured or null — never estimated.
// ---------------------------------------------------------------------------

export type ChooseProgramFact = {
  slug: string;
  name: string;
  /** Registry description; the UI line-clamps it. */
  blurb: string;
  /** Colleges in the state offering coursework in this program (live term). */
  collegeCount: number;
  /** Total sections this term across those colleges. */
  sectionCount: number;
  /** % of sections that are online/remote, rounded; null if unknown. */
  onlinePct: number | null;
  /** Whether any section meets in the evening (start ≥ 17:00). */
  eveningAvailable: boolean;
  /** State median annual wage for the program's primary career (BLS); null if
   *  transfer-oriented or no BLS data for this state/occupation. */
  medianWage: number | null;
  /** True when the program maps to a direct CC career (registry primarySoc);
   *  false for transfer-oriented majors. Drives job-vs-transfer ordering. */
  careerOriented: boolean;
};

export type QuizAnswers = {
  field: FieldId;
  goal: GoalId;
  time: TimeId;
};

// ---------------------------------------------------------------------------
// Pure recommendation logic (no I/O — unit-tested)
// ---------------------------------------------------------------------------

/** Does a fact match the schedule preference? full/part-time never filter. */
export function matchesTime(fact: ChooseProgramFact, time: TimeId): boolean {
  if (time === "evening") return fact.eveningAvailable;
  if (time === "online") return (fact.onlinePct ?? 0) > 0;
  return true; // fulltime / parttime — every program allows these
}

/**
 * Comparator key for a fact under a goal. Lower sorts first. Returned as a
 * tuple compared lexicographically by `byKey`. Wage-unknown always sorts
 * after wage-known (via the `wageKnown` flag) so we never push a "no data"
 * card above a real one.
 *
 * All components are FINITE — never use ±Infinity here: two unknown-wage
 * facts would otherwise yield `Infinity - Infinity = NaN` in `byKey`, and a
 * NaN from a sort comparator silently corrupts ordering. The `wageKnown`
 * flag separates known/unknown, and `wageDesc` is 0 for unknowns (only ever
 * compared against other unknowns, where it ties and falls through to the
 * next component).
 */
function goalKey(fact: ChooseProgramFact, goal: GoalId): number[] {
  const wage = fact.medianWage;
  const wageKnown = wage == null ? 1 : 0; // 0 (known) sorts before 1 (unknown)
  const wageDesc = wage == null ? 0 : -wage; // higher wage first among known
  const sections = -fact.sectionCount;
  const colleges = -fact.collegeCount;
  switch (goal) {
    case "job":
      // Career-path first, then known pay, then higher pay, then sections.
      return [fact.careerOriented ? 0 : 1, wageKnown, wageDesc, sections];
    case "transfer":
      // Transfer-oriented majors first, then breadth (more colleges), sections.
      return [fact.careerOriented ? 1 : 0, colleges, sections];
    case "pay":
      // Known wage first, then highest wage, then sections.
      return [wageKnown, wageDesc, sections];
  }
}

/** Lexicographic compare of two equal-length numeric tuples. */
function byKey(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * Core recommendation: filter to the chosen field's qualifying programs,
 * order by goal, then float schedule-matching programs to the top WITHOUT
 * dropping the rest (avoids empty results). Deterministic: ties break on
 * slug so the output is stable for tests and ISR.
 */
export function recommend(
  facts: ChooseProgramFact[],
  answers: QuizAnswers,
): ChooseProgramFact[] {
  const field = FIELDS.find((f) => f.id === answers.field);
  if (!field) return [];
  const allowed = new Set(field.slugs);

  const inField = facts.filter((f) => allowed.has(f.slug));

  // Stable ordering by goal, slug as the final tie-breaker.
  const ordered = [...inField].sort((a, b) => {
    const k = byKey(goalKey(a, answers.goal), goalKey(b, answers.goal));
    return k !== 0 ? k : a.slug.localeCompare(b.slug);
  });

  // Float schedule matches up while preserving goal order within each group.
  if (answers.time === "evening" || answers.time === "online") {
    const match = ordered.filter((f) => matchesTime(f, answers.time));
    const rest = ordered.filter((f) => !matchesTime(f, answers.time));
    return [...match, ...rest];
  }
  return ordered;
}

// ---------------------------------------------------------------------------
// Server-side fact gathering (Supabase live sections + bundled BLS file)
// ---------------------------------------------------------------------------

/** Every slug referenced by any field (deduped) — the universe to evaluate. */
function relevantSlugs(): string[] {
  return [...new Set(FIELDS.flatMap((f) => f.slugs))];
}

/**
 * Gather honest facts for every quiz-relevant program that QUALIFIES in the
 * state this term. Mirrors the /[state]/programs index cost profile
 * (loadProgramData per slug, cached + ISR). Returns only qualifying slugs,
 * so the client can never recommend a soft-404 page.
 */
export async function gatherChooseFacts(
  state: string,
): Promise<ChooseProgramFact[]> {
  const slugs = relevantSlugs();
  const results = await Promise.all(
    slugs.map(async (slug) => {
      const def = getProgramBySlug(slug);
      if (!def) return null;
      const data = await loadProgramData(state, slug).catch(() => null);
      if (!data || !qualifies(data)) return null;

      const profile = computeCourseAvailabilityProfile(data.flatSections);
      const onlinePct = profile
        ? Math.round((profile.modes.pcts.online ?? 0) + (profile.modes.pcts.zoom ?? 0))
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

/**
 * Which fields will actually yield ≥1 result given the qualifying facts.
 * Lets the page disable/annotate dead fields up front rather than letting a
 * student pick one and hit an empty screen.
 */
export function availableFieldIds(facts: ChooseProgramFact[]): Set<FieldId> {
  const present = new Set(facts.map((f) => f.slug));
  const out = new Set<FieldId>();
  for (const field of FIELDS) {
    if (field.slugs.some((s) => present.has(s))) out.add(field.id);
  }
  return out;
}

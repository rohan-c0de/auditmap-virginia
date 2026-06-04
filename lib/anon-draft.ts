/**
 * Versioned sessionStorage draft for the anonymous→account hand-off.
 *
 * A logged-out student who builds a plan and clicks "Sign in to save" has the
 * plan stashed here so it survives the full-page OAuth redirect; on first authed
 * load AuthProvider offers to drain it into the new account (DraftDrainPrompt).
 *
 * Why sessionStorage (tab-scoped): safer on shared computers, cleared when the
 * tab closes. NOT localStorage, and NOT a Supabase anonymous session — an anon
 * session sets the `sb-` cookie and would defeat AuthProvider's logged-out SEO
 * fast-path.
 *
 * Store only INPUT (state + course codes + kind), never computed plan_data —
 * plans/favorites are recomputed from their input after sign-in. EXCEPTION: a
 * saved SCHEDULE is one chosen GeneratedSchedule (one of many ranked options),
 * so there is nothing to recompute — its draft carries the full sections array
 * + score + scoreBreakdown + form_data, inserted verbatim by the drain. The
 * pure helpers (parseAndValidateDraft / upsert* / *DedupKey) are split from the
 * I/O so they can be unit-tested without a DOM.
 */
export const ANON_DRAFT_KEY = "ccp:anon-draft";
export const ANON_DRAFT_VERSION = 1;
export const ANON_DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type PlanKind = "semester" | "program";

export interface AnonPlanDraft {
  state: string;
  name: string;
  targetCourses: string[];
  kind: PlanKind;
  dedupKey: string;
}

export interface AnonFavoriteDraft {
  state: string;
  coursePrefix: string;
  courseNumber: string;
  courseTitle: string;
  dedupKey: string;
}

/**
 * A chosen schedule. Unlike plans/favorites this stores COMPUTED output (the
 * picked sections + score), because the saved artifact IS one specific ranked
 * option — there is no input to recompute it from. `sections` is the serialized
 * ScheduleSection[]; score / scoreBreakdown / formData may be null.
 */
export interface AnonScheduleDraft {
  state: string;
  name: string;
  sections: unknown[];
  score: number | null;
  scoreBreakdown: unknown | null;
  formData: Record<string, unknown> | null;
  dedupKey: string;
}

export interface AnonDraft {
  v: number;
  plans: AnonPlanDraft[];
  favorites: AnonFavoriteDraft[];
  schedules: AnonScheduleDraft[];
  savedAt: number; // epoch ms
}

/**
 * Stable, content-derived idempotency key: re-saving the same plan (same state +
 * same targets) reuses one entry, and the drain RPC is a no-op on retry.
 */
export function planDedupKey(state: string, targetCourses: string[]): string {
  return `${state}::${[...targetCourses].sort().join("|")}`;
}

/**
 * PURE: validate a raw JSON string into a draft, or null if missing / wrong
 * version / malformed / stale (older than MAX_AGE) / empty. `now` is injected so
 * staleness is testable.
 */
export function parseAndValidateDraft(raw: string | null, now: number): AnonDraft | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const d = parsed as Partial<AnonDraft> | null;
  if (!d || d.v !== ANON_DRAFT_VERSION || !Array.isArray(d.plans)) return null;
  if (typeof d.savedAt !== "number" || now - d.savedAt > ANON_DRAFT_MAX_AGE_MS) return null;
  // favorites and schedules were added after the v1 plans-only draft shipped —
  // default missing arrays so older drafts (plans-only / plans+favorites) stay
  // valid.
  const favorites = Array.isArray(d.favorites) ? d.favorites : [];
  const schedules = Array.isArray(d.schedules) ? d.schedules : [];
  if (d.plans.length === 0 && favorites.length === 0 && schedules.length === 0) return null;
  return { v: d.v, plans: d.plans, favorites, schedules, savedAt: d.savedAt } as AnonDraft;
}

/** PURE: add or replace a plan by its dedupKey (each entry keeps its own state). */
export function upsertPlan(plans: AnonPlanDraft[], plan: AnonPlanDraft): AnonPlanDraft[] {
  return [...plans.filter((p) => p.dedupKey !== plan.dedupKey), plan];
}

/** Stable content key for a favorited course — matches the saved_courses unique
 *  index granularity (state + prefix + number). */
export function favoriteDedupKey(state: string, prefix: string, number: string): string {
  return `${state}::${prefix}::${number}`;
}

/** PURE: add or replace a favorite by its dedupKey. */
export function upsertFavorite(
  favorites: AnonFavoriteDraft[],
  fav: AnonFavoriteDraft
): AnonFavoriteDraft[] {
  return [...favorites.filter((f) => f.dedupKey !== fav.dedupKey), fav];
}

/**
 * Stable content key for a chosen schedule: state + the sorted set of section
 * identifiers (college_code:crn). Re-saving the same set of sections reuses one
 * entry; a different combination is a distinct schedule. Order-independent.
 */
export function scheduleDedupKey(
  state: string,
  sections: ReadonlyArray<{ college_code: string; crn: string }>
): string {
  const ids = sections.map((s) => `${s.college_code}:${s.crn}`).sort();
  return `${state}::${ids.join("|")}`;
}

/** PURE: add or replace a schedule by its dedupKey. */
export function upsertSchedule(
  schedules: AnonScheduleDraft[],
  sched: AnonScheduleDraft
): AnonScheduleDraft[] {
  return [...schedules.filter((s) => s.dedupKey !== sched.dedupKey), sched];
}

// ── sessionStorage I/O (client-only; no-ops during SSR) ─────────────────────

export function stashPlanDraft(plan: AnonPlanDraft): void {
  if (typeof window === "undefined") return;
  try {
    const existing = readAnonDraft();
    const plans = upsertPlan(existing?.plans ?? [], plan);
    const draft: AnonDraft = {
      v: ANON_DRAFT_VERSION,
      plans,
      favorites: existing?.favorites ?? [],
      schedules: existing?.schedules ?? [],
      savedAt: Date.now(),
    };
    window.sessionStorage.setItem(ANON_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // QuotaExceededError / serialization — drop silently; worst case the user
    // re-saves after signing in.
  }
}

export function stashFavoriteDraft(fav: AnonFavoriteDraft): void {
  if (typeof window === "undefined") return;
  try {
    const existing = readAnonDraft();
    const favorites = upsertFavorite(existing?.favorites ?? [], fav);
    const draft: AnonDraft = {
      v: ANON_DRAFT_VERSION,
      plans: existing?.plans ?? [],
      favorites,
      schedules: existing?.schedules ?? [],
      savedAt: Date.now(),
    };
    window.sessionStorage.setItem(ANON_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // QuotaExceededError / serialization — drop silently.
  }
}

export function stashScheduleDraft(sched: AnonScheduleDraft): void {
  if (typeof window === "undefined") return;
  try {
    const existing = readAnonDraft();
    const schedules = upsertSchedule(existing?.schedules ?? [], sched);
    const draft: AnonDraft = {
      v: ANON_DRAFT_VERSION,
      plans: existing?.plans ?? [],
      favorites: existing?.favorites ?? [],
      schedules,
      savedAt: Date.now(),
    };
    window.sessionStorage.setItem(ANON_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // QuotaExceededError / serialization — drop silently.
  }
}

export function readAnonDraft(): AnonDraft | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(ANON_DRAFT_KEY);
  } catch {
    return null;
  }
  const draft = parseAndValidateDraft(raw, Date.now());
  if (!draft && raw) clearAnonDraft(); // purge invalid / stale
  return draft;
}

export function clearAnonDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(ANON_DRAFT_KEY);
  } catch {
    // ignore
  }
}

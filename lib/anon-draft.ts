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
 * the plan is recomputed from target_courses after sign-in. The pure helpers
 * (parseAndValidateDraft / upsertPlan / planDedupKey) are split from the I/O so
 * they can be unit-tested without a DOM.
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

export interface AnonDraft {
  v: number;
  plans: AnonPlanDraft[];
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
  if (d.plans.length === 0) return null;
  return d as AnonDraft;
}

/** PURE: add or replace a plan by its dedupKey (each entry keeps its own state). */
export function upsertPlan(plans: AnonPlanDraft[], plan: AnonPlanDraft): AnonPlanDraft[] {
  return [...plans.filter((p) => p.dedupKey !== plan.dedupKey), plan];
}

// ── sessionStorage I/O (client-only; no-ops during SSR) ─────────────────────

export function stashPlanDraft(plan: AnonPlanDraft): void {
  if (typeof window === "undefined") return;
  try {
    const existing = readAnonDraft();
    const plans = upsertPlan(existing?.plans ?? [], plan);
    const draft: AnonDraft = { v: ANON_DRAFT_VERSION, plans, savedAt: Date.now() };
    window.sessionStorage.setItem(ANON_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // QuotaExceededError / serialization — drop silently; worst case the user
    // re-saves after signing in.
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

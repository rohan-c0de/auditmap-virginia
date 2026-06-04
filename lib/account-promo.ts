/**
 * Pure helpers for the logged-out AccountPromo CTA. Split out from the
 * "use client" component so the render guard is unit-testable without a DOM
 * (the vitest env is "node").
 */

export const PROMO_DISMISS_KEY = "ccp:promo-dismissed";

/**
 * The promo shows ONLY to a logged-out, not-yet-dismissed visitor whose auth
 * state has resolved (isLoading false) — so it never flashes for a signed-in
 * user while their session is still loading, and never walls anything.
 */
export function shouldShowAccountPromo(opts: {
  isLoading: boolean;
  user: unknown;
  dismissed: boolean;
}): boolean {
  return !opts.isLoading && !opts.user && !opts.dismissed;
}

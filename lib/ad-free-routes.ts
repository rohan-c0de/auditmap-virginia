/**
 * Routes where Google AdSense must never load or render.
 *
 * These are authenticated / private pages — the account dashboard
 * (`/account`) and a user's saved-plan view (`/plan/[id]`). They are seen only
 * by signed-in students, an audience that includes under-18 dual-enrollment
 * students, so we neither load Google's ad library (`adsbygoogle.js`) nor
 * render any ad slot here.
 *
 * See docs/auth-gating-matrix.md — cross-cutting requirement:
 * "ads OFF on every LOGIN-ONLY / account route."
 *
 * Single source of truth: consumed by both `AdSenseScript` (skips the library
 * loader) and `AdUnit` (skips the ad slot), so the two cannot drift.
 *
 * FOLLOW-UP (needs the age-gate PR): this is the conservative line — no ads for
 * ANY logged-in user on these private routes. A later PR introduces the 13+ age
 * attestation and turns OFF ad personalization specifically for under-18
 * accounts on the remaining (public) ad routes. That requires an age signal
 * that does not exist yet, so it is intentionally out of scope here.
 */
export function isAdFreeRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return (
    pathname === "/account" ||
    pathname.startsWith("/account/") ||
    pathname === "/plan" ||
    pathname.startsWith("/plan/")
  );
}

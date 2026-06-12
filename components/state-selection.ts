// The homepage's single source of truth for "which state is the user in".
//
// The hero's state chip writes here; anything else on the page that builds
// state-scoped links (the four feature cards) subscribes via the custom event
// so a chip switch retargets them immediately — no reload, no prop drilling
// through the server component.
//
// Priority order for consumers: stored manual choice > geo-IP guess > none.

export const STATE_LS_KEY = "ccp:lastState";
export const STATE_CHANGE_EVENT = "ccp:state-change";

/** Read the user's last manually-chosen state, if it's still a valid slug. */
export function readStoredState(validSlugs: readonly string[]): string | null {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(STATE_LS_KEY);
  return stored && validSlugs.includes(stored) ? stored : null;
}

/** Persist a manual state choice and notify same-page subscribers. */
export function storeSelectedState(slug: string): void {
  localStorage.setItem(STATE_LS_KEY, slug);
  window.dispatchEvent(new CustomEvent(STATE_CHANGE_EVENT, { detail: slug }));
}

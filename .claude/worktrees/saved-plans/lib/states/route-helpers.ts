import { notFound } from "next/navigation";
import { getStateConfig, isValidState, type StateConfig } from "./registry";

/**
 * Server-only wrapper for `getStateConfig` that triggers Next's 404 handler
 * (HTTP 404, not 500) when the slug isn't a registered state. Use this in
 * any `app/[state]/**` route component or `generateMetadata` instead of
 * calling `getStateConfig` directly — the latter throws, which Next renders
 * as a 500 server-error page.
 *
 * Issue #158: prior to this helper, navigating to /<unregistered>/colleges
 * (or /courses, /plan, /college/[id], etc.) crashed the route with a real
 * 500 instead of returning a clean 404. Pulled into its own module so
 * `lib/states/registry.ts` stays Next-agnostic — Node CLI scripts
 * (scrape-matrix, check-scraper-coverage) import the registry without
 * dragging in `next/navigation`.
 */
export function requireStateConfig(slug: string): StateConfig {
  if (!isValidState(slug)) notFound();
  return getStateConfig(slug);
}

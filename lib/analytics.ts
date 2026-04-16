/**
 * analytics.ts — Thin wrapper around gtag for custom GA4 events.
 *
 * Call `track("event_name", { param: value })` from anywhere in the client.
 * Safe no-op on the server or when GA is not configured.
 *
 * Keep event names in `snake_case` and limit to the enumerated list below so
 * reporting stays consistent.
 */

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

export type AnalyticsEvent =
  // Search / discovery
  | "course_search_submit"
  | "course_search_filter"
  | "course_detail_view"
  | "college_detail_view"
  | "subject_page_view"
  | "instructor_page_view"
  // Transfer
  | "transfer_lookup_submit"
  | "transfer_course_add"
  // Schedule builder
  | "schedule_build_submit"
  | "schedule_results_view"
  | "schedule_save"
  // Saved items
  | "course_bookmark_add"
  | "course_bookmark_remove"
  // External clicks
  | "external_college_link"
  // Auth
  | "auth_modal_open"
  | "auth_sign_in"
  | "auth_sign_out";

type EventParams = Record<string, string | number | boolean | null | undefined>;

/**
 * Send a custom event to Google Analytics 4.
 *
 * Silently no-ops if gtag hasn't loaded (e.g. server render, ad blocker, or
 * NEXT_PUBLIC_GA_ID unset). Never throws — analytics should never break the
 * user experience.
 */
export function track(event: AnalyticsEvent, params: EventParams = {}): void {
  if (typeof window === "undefined") return;
  try {
    const gtag = window.gtag;
    if (typeof gtag !== "function") return;
    // Strip undefined/null so GA doesn't receive noisy empty params
    const clean: EventParams = {};
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") clean[k] = v;
    }
    gtag("event", event, clean);
  } catch {
    // swallow — analytics must never break the app
  }
}

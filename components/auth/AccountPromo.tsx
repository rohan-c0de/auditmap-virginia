"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/hooks/useAuth";
import { PROMO_DISMISS_KEY, shouldShowAccountPromo } from "@/lib/account-promo";

/**
 * Logged-out-only growth CTA: advertises that a free account SAVES a visitor's
 * work (plans / schedules / courses) and unlocks seat alerts. Browsing stays
 * free and un-gated — this never walls reads; it only promotes saving (the
 * anon→account drain already carries logged-out work into the new account on
 * sign-in). Dismiss is tab-scoped (sessionStorage, like the anon-draft) so it
 * doesn't nag across navigation. Reads ONLY the useAuth context — never imports
 * Supabase — so the AuthProvider logged-out SEO fast-path is preserved.
 *
 * `className` styles the OUTER wrapper (spacing/width per placement); when the
 * promo is hidden the component renders null, so no empty padded gap is left.
 */
export default function AccountPromo({ className = "" }: { className?: string }) {
  const { user, isLoading, openLoginModal } = useAuth();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time client read of the tab-scoped dismiss flag on mount (sessionStorage is client-only)
      if (sessionStorage.getItem(PROMO_DISMISS_KEY) === "1") setDismissed(true);
    } catch {
      // sessionStorage unavailable — just show the promo.
    }
  }, []);

  if (!shouldShowAccountPromo({ isLoading, user, dismissed })) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(PROMO_DISMISS_KEY, "1");
    } catch {
      // ignore
    }
    setDismissed(true);
  };

  return (
    <div className={className}>
      <div className="rounded-xl border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-900/20 px-4 py-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-slate-100">
            Save your work with a free account
          </p>
          <p className="mt-1 text-xs text-gray-600 dark:text-slate-400">
            Free to search and plan — no account needed. Create one to save your
            plans, schedules, and courses, and get notified when a seat opens.
          </p>
        </div>
        <div className="mt-3 sm:mt-0 flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={openLoginModal}
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 transition whitespace-nowrap"
          >
            Create a free account
          </button>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss account suggestion"
            className="rounded-md p-1.5 text-teal-700/70 hover:text-teal-900 dark:text-teal-300/70 dark:hover:text-teal-100 hover:bg-teal-100 dark:hover:bg-teal-800/40 transition"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

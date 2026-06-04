"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/hooks/useAuth";

/**
 * Shared-computer guard for the anonymous→account drain. When AuthProvider
 * detects a sessionStorage draft (plans, favorited courses, and/or schedules)
 * on the first authed load, it surfaces THIS confirmation — we NEVER auto-flush
 * a draft into
 * whoever happens to be signed in (person A's draft must not silently land in
 * person B's account on a shared machine). Mounted in the root layout next to
 * LoginModal / ConsentPrompt.
 */
export default function DraftDrainPrompt() {
  const { user, pendingDraft, drainDraft, discardDraft } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (!user || !pendingDraft) return null;
  const planCount = pendingDraft.plans.length;
  const favCount = pendingDraft.favorites.length;
  const schedCount = pendingDraft.schedules.length;
  if (planCount === 0 && favCount === 0 && schedCount === 0) return null;

  const who = user.email ?? "your account";
  const parts: string[] = [];
  if (planCount > 0) parts.push(`${planCount} ${planCount === 1 ? "plan" : "plans"}`);
  if (favCount > 0)
    parts.push(`${favCount} saved ${favCount === 1 ? "course" : "courses"}`);
  if (schedCount > 0)
    parts.push(`${schedCount} ${schedCount === 1 ? "schedule" : "schedules"}`);
  const summary = parts.join(" and ");
  const isPlural = planCount + favCount + schedCount > 1;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">
          Add your unsaved work?
        </h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">
          We found {summary} you saved on this device before signing in. Add{" "}
          {isPlural ? "them" : "it"} to <strong>{who}</strong>&apos;s account?
        </p>
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={async () => {
              setBusy(true);
              const ok = await drainDraft();
              setBusy(false);
              if (ok) router.push("/account");
            }}
            disabled={busy}
            className="flex-1 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {busy ? "Adding..." : "Add to my account"}
          </button>
          <button
            type="button"
            onClick={() => discardDraft()}
            disabled={busy}
            className="rounded-lg border border-gray-300 dark:border-slate-600 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50 transition"
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/hooks/useAuth";

/**
 * One-time consent prompt for already-signed-in accounts that predate the
 * signup consent gate (or whose acceptance couldn't be recorded at signup —
 * e.g. a magic link opened on a different device). Rendered in the root layout
 * alongside LoginModal; only shows when AuthProvider sets needsConsent.
 *
 * Mirrors the signup checkbox: accepting attests 13+ AND agreement to the
 * Terms and Privacy Policy, then writes profiles.tos_accepted_at.
 */
export default function ConsentPrompt() {
  const { user, needsConsent, acceptConsent } = useAuth();
  const [submitting, setSubmitting] = useState(false);

  if (!user || !needsConsent) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">
          One quick thing
        </h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">
          We&apos;ve added Terms of Service and updated our Privacy Policy. To keep using your
          account, please confirm you are 13 or older and agree to the{" "}
          <Link href="/terms" target="_blank" className="text-teal-600 underline">Terms of Service</Link>{" "}
          and{" "}
          <Link href="/privacy" target="_blank" className="text-teal-600 underline">Privacy Policy</Link>.
        </p>
        <button
          type="button"
          onClick={async () => {
            setSubmitting(true);
            await acceptConsent();
            setSubmitting(false);
          }}
          disabled={submitting}
          className="mt-4 w-full rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {submitting ? "Saving..." : "I'm 13+ and I agree"}
        </button>
      </div>
    </div>
  );
}

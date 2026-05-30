"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/lib/hooks/useAuth";
import { getEnabledProviders } from "@/lib/auth-providers";

/**
 * Login modal dialog — appears over the current page.
 *
 * Renders SSO buttons dynamically from AUTH_PROVIDERS config,
 * plus a magic link email option. Provider-agnostic — adding
 * a new SSO provider only requires updating lib/auth-providers.ts.
 */
export default function LoginModal() {
  const {
    loginModalOpen,
    closeLoginModal,
    signInWithOAuth,
    signInWithMagicLink,
  } = useAuth();

  const [email, setEmail] = useState("");
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [magicLinkError, setMagicLinkError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const providers = getEnabledProviders();

  // Sync dialog open/close with state
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (loginModalOpen) {
      if (!dialog.open) dialog.showModal();
    } else {
      if (dialog.open) dialog.close();
      // Reset internal form state when the parent closes the modal.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEmail("");

      setMagicLinkSent(false);

      setMagicLinkError(null);
    }
  }, [loginModalOpen]);

  // Close on backdrop click
  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current) {
      closeLoginModal();
    }
  };

  // Close on Escape key (dialog has built-in support but we need to sync state)
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleCancel = () => closeLoginModal();
    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
  }, [closeLoginModal]);

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setIsSending(true);
    setMagicLinkError(null);

    const { error } = await signInWithMagicLink(email.trim());

    if (error) {
      setMagicLinkError(error);
    } else {
      setMagicLinkSent(true);
    }
    setIsSending(false);
  };

  if (!loginModalOpen) return null;

  return (
    <dialog
      ref={dialogRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-[100] m-auto w-full max-w-sm rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-0 shadow-xl backdrop:bg-black/50"
    >
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">
            Sign in to save your work
          </h2>
          <button
            onClick={closeLoginModal}
            className="rounded-lg p-1.5 text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 transition"
            aria-label="Close"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* SSO Buttons — rendered dynamically from AUTH_PROVIDERS config */}
        <div className="space-y-3">
          {providers.map((provider) => (
            <button
              key={provider.id}
              onClick={() => signInWithOAuth(provider.id)}
              className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-600 transition"
            >
              <provider.icon />
              {provider.label}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200 dark:border-slate-700" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-white dark:bg-slate-800 px-3 text-gray-400 dark:text-slate-500">
              or
            </span>
          </div>
        </div>

        {/* Magic Link form */}
        {magicLinkSent ? (
          <div className="rounded-lg bg-teal-50 dark:bg-teal-900/30 border border-teal-200 dark:border-teal-800 p-4 text-center">
            <p className="text-sm font-medium text-teal-800 dark:text-teal-200">
              Check your email
            </p>
            <p className="mt-1 text-xs text-teal-700 dark:text-teal-300">
              We sent a sign-in link to{" "}
              <strong>{email}</strong>. Click the link to sign in.
            </p>
          </div>
        ) : (
          <form onSubmit={handleMagicLink}>
            <label
              htmlFor="login-email"
              className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5"
            >
              Email address
            </label>
            <input
              id="login-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 placeholder:text-gray-400 dark:placeholder:text-slate-500 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none transition"
            />
            {magicLinkError && (
              <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">
                {magicLinkError}
              </p>
            )}
            <button
              type="submit"
              disabled={isSending}
              className="mt-3 w-full rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {isSending ? "Sending..." : "Send Magic Link"}
            </button>
            <p className="mt-2 text-xs text-gray-400 dark:text-slate-500 text-center">
              No password needed. We&apos;ll email you a sign-in link.
            </p>
          </form>
        )}
      </div>
    </dialog>
  );
}

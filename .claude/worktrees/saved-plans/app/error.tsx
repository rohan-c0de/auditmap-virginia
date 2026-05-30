"use client";

import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-24 bg-white dark:bg-slate-900 min-h-screen">
      <h1 className="text-4xl font-bold text-gray-200 dark:text-slate-700">Something went wrong</h1>
      <p className="mt-4 text-gray-600 dark:text-slate-400 text-center max-w-md">
        {error.digest
          ? "An unexpected error occurred. Please try again."
          : error.message || "An unexpected error occurred. Please try again."}
      </p>
      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 transition"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-lg border border-gray-300 dark:border-slate-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition"
        >
          Go Home
        </Link>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const RADIUS_OPTIONS = [10, 25, 50] as const;

interface SearchFormProps {
  state?: string;
  /** Optional placeholder for the zip/city input. Pass from a server component using StateConfig. */
  placeholder?: string;
}

export default function SearchForm({ state = "va", placeholder }: SearchFormProps) {
  const router = useRouter();
  const [zip, setZip] = useState("");
  const [radius, setRadius] = useState<number>(25);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmed = zip.trim();
    if (!trimmed) {
      setError("Please enter a zip code or city name.");
      return;
    }

    // Accept either a 5-digit zip or a city name (2+ chars)
    if (/^\d+$/.test(trimmed) && trimmed.length !== 5) {
      setError("Please enter a valid 5-digit zip code.");
      return;
    }

    if (trimmed.length < 2) {
      setError("Please enter at least 2 characters.");
      return;
    }

    router.push(`/${state}/results?zip=${encodeURIComponent(trimmed)}&radius=${radius}`);
  }

  return (
    <form
      id="search"
      onSubmit={handleSubmit}
      className="mx-auto w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 p-6 shadow-lg dark:shadow-slate-900/50 sm:p-8"
    >
      <h3 className="mb-1 text-center text-xl font-bold text-gray-900 dark:text-slate-100">
        Find Colleges Near You
      </h3>
      <p className="mb-6 text-center text-sm text-gray-500 dark:text-slate-400">
        Enter your zip code or city name to find nearby community colleges.
      </p>

      {/* Zip code input */}
      <div className="mb-5">
        <label
          htmlFor="zip"
          className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-slate-300"
        >
          Zip Code or City
        </label>
        <input
          id="zip"
          type="text"
          maxLength={30}
          placeholder={placeholder || "e.g. zip code or city"}
          value={zip}
          onChange={(e) => {
            setZip(e.target.value);
            if (error) setError(null);
          }}
          className={`w-full rounded-lg border px-4 py-3 text-lg tracking-widest placeholder:tracking-normal placeholder:text-gray-400 dark:placeholder:text-slate-500 dark:bg-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 ${
            error
              ? "border-red-400 focus:ring-red-300"
              : "border-gray-300 dark:border-slate-600 focus:border-teal-500 focus:ring-teal-200 dark:focus:ring-teal-800"
          }`}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? "zip-error" : undefined}
        />
        {error && (
          <p id="zip-error" className="mt-1.5 text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
      </div>

      {/* Radius selector */}
      <div className="mb-6">
        <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-slate-300">
          Search Radius
        </span>
        <div className="flex gap-2">
          {RADIUS_OPTIONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRadius(r)}
              className={`flex-1 rounded-lg border py-2.5 text-sm font-medium transition ${
                radius === r
                  ? "border-teal-600 bg-teal-600 text-white shadow-sm"
                  : "border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-400 hover:border-teal-400 hover:text-teal-700"
              }`}
            >
              {r} miles
            </button>
          ))}
        </div>
      </div>

      {/* Submit */}
      <button
        type="submit"
        className="w-full rounded-lg bg-teal-600 px-6 py-3 text-base font-semibold text-white shadow transition hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:ring-offset-2"
      >
        Find Colleges
      </button>
    </form>
  );
}

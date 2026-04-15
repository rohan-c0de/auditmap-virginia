"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import CollegeCard from "@/components/CollegeCard";
import MapViewWrapper from "@/components/MapViewWrapper";
import type { Institution, SearchResult } from "@/lib/types";

export default function ResultsContent({ state }: { state: string }) {
  const searchParams = useSearchParams();
  const zip = searchParams.get("zip") || "";
  const radius = parseInt(searchParams.get("radius") || "25", 10);

  const [results, setResults] = useState<SearchResult[]>([]);
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(
    null
  );
  const [cityName, setCityName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [linkCopied, setLinkCopied] = useState(false);
  const [showMap, setShowMap] = useState(false);

  useEffect(() => {
    if (!zip) {
      setError("No zip code provided.");
      setLoading(false);
      return;
    }

    async function fetchResults() {
      try {
        const res = await fetch(
          `/api/${state}/search?zip=${encodeURIComponent(zip)}&radius=${radius}`
        );
        if (!res.ok) {
          const data = await res.json();
          setError(data.error || "Search failed.");
          setLoading(false);
          return;
        }
        const data = await res.json();
        setResults(data.results);
        setCenter(data.center);
        setCityName(data.city || "");
        setLoading(false);
      } catch {
        setError("Failed to load results. Please try again.");
        setLoading(false);
      }
    }

    fetchResults();
  }, [zip, radius, state]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-12">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 dark:bg-slate-700 rounded w-1/3" />
          <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-1/2" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100 mb-4">
          Search Error
        </h1>
        <p className="text-gray-600 dark:text-slate-400 mb-6">{error}</p>
        <Link
          href={`/${state}`}
          className="inline-flex items-center px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
        >
          Try Again
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <Link
          href={`/${state}`}
          className="text-sm text-teal-600 hover:text-teal-700 mb-2 inline-block"
        >
          &larr; New search
        </Link>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-slate-100">
          {results.length} College{results.length !== 1 ? "s" : ""} Near{" "}
          {cityName && cityName.toLowerCase() !== zip.toLowerCase()
            ? `${cityName} (${zip})`
            : cityName || zip}
        </h1>
        <div className="flex items-center gap-4 mt-1">
          <p className="text-gray-600 dark:text-slate-400">
            Within {radius}
            {" "}miles &middot; Showing colleges with course listings this term
          </p>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(window.location.href);
                setLinkCopied(true);
                setTimeout(() => setLinkCopied(false), 2000);
              } catch {
                // fallback
              }
            }}
            className="shrink-0 inline-flex items-center gap-1 rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800 transition"
          >
            {linkCopied ? (
              <>
                <svg className="h-3.5 w-3.5 text-emerald-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                Copied!
              </>
            ) : (
              <>
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                Share
              </>
            )}
          </button>
        </div>
      </div>

      {results.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-lg text-gray-600 dark:text-slate-400 mb-4">
            No colleges found within {radius} miles of {zip}.
          </p>
          <p className="text-gray-500 dark:text-slate-400 mb-6">
            Try increasing the search radius or checking a different zip code.
          </p>
          <Link
            href={`/${state}`}
            className="inline-flex items-center px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
          >
            Search Again
          </Link>
        </div>
      ) : (
        <div className="grid lg:grid-cols-5 gap-8">
          {/* Left panel — college list */}
          <div className="lg:col-span-3 space-y-4">
            {results.map((result) => (
              <CollegeCard
                key={result.institution.id}
                institution={result.institution}
                distance={result.distance}
                courseCount={result.courseCount}
                state={state}
              />
            ))}
          </div>

          {/* Right panel — map */}
          <div className="lg:col-span-2">
            {/* Mobile: toggleable */}
            <div className="lg:hidden mb-4">
              <button
                type="button"
                onClick={() => setShowMap(!showMap)}
                className="w-full flex items-center justify-center gap-2 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                </svg>
                {showMap ? "Hide Map" : "Show Map"}
              </button>
            </div>
            <div className={`${showMap ? "block" : "hidden"} lg:block`}>
              <div className="sticky top-24 h-[350px] lg:h-[calc(100vh-8rem)]">
                {center && (
                  <MapViewWrapper
                    institutions={results.map((r) => ({
                      institution: r.institution,
                      distance: r.distance,
                    }))}
                    center={center}
                    zoom={radius <= 10 ? 11 : radius <= 25 ? 9 : 8}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

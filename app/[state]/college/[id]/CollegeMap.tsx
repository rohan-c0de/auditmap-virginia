"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { Institution } from "@/lib/types";

// Dynamic import keeps Leaflet's ~147 KB raw / 42 KB gzipped code out of
// the main bundle. We further defer the *mount* (and therefore the chunk
// fetch + parse) behind an IntersectionObserver below — Lighthouse
// identified Leaflet as the dominant TBT contributor on the college page
// (TBT 3.2 s, perf score 51 before this change).
const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full animate-pulse rounded-lg bg-gray-100 dark:bg-slate-800" />
  ),
});

interface Props {
  institution: Institution;
}

export default function CollegeMap({ institution }: Props) {
  const [show, setShow] = useState(false);
  const placeholderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (show) return;
    const el = placeholderRef.current;
    if (!el) return;

    // Safari 14 and older don't have IntersectionObserver — fall back to
    // rendering eagerly so the map still shows up.
    if (typeof IntersectionObserver === "undefined") {
      setShow(true);
      return;
    }

    // When the placeholder is above the fold (common on this page), IO fires
    // on mount — which would defeat the TBT win. Route the trigger through
    // requestIdleCallback so Leaflet's parse/execute happens after the main
    // thread has finished the initial render burst.
    let idleHandle: number | undefined;
    const ric = window as typeof window & {
      requestIdleCallback?: (
        cb: () => void,
        opts?: { timeout: number }
      ) => number;
      cancelIdleCallback?: (h: number) => void;
    };
    const scheduleLoad = () => {
      if (idleHandle !== undefined) return;
      if (typeof ric.requestIdleCallback === "function") {
        idleHandle = ric.requestIdleCallback(() => setShow(true), {
          timeout: 4000,
        });
      } else {
        idleHandle = window.setTimeout(() => setShow(true), 2000);
      }
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          scheduleLoad();
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (idleHandle !== undefined) {
        if (typeof ric.cancelIdleCallback === "function") {
          ric.cancelIdleCallback(idleHandle);
        } else {
          window.clearTimeout(idleHandle);
        }
      }
    };
  }, [show]);

  if (!institution.campuses || institution.campuses.length === 0) return null;

  const center = {
    lat: institution.campuses[0].lat,
    lng: institution.campuses[0].lng,
  };

  if (show) {
    return (
      <MapView
        institutions={[{ institution, distance: 0 }]}
        center={center}
        zoom={institution.campuses.length > 1 ? 10 : 13}
      />
    );
  }

  const campusCount = institution.campuses.length;

  // `h-full` (not a fixed height) so the placeholder fills whatever height
  // its parent provides. The college page wraps this component in an
  // `h-[250px]` container; other future usages can provide their own.
  return (
    <div
      ref={placeholderRef}
      className="relative h-full w-full overflow-hidden rounded-lg border border-gray-200 dark:border-slate-700 bg-gradient-to-br from-gray-50 to-gray-100 dark:from-slate-800 dark:to-slate-900 shadow-sm"
    >
      <svg
        className="absolute inset-0 h-full w-full opacity-40"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 400 300"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <defs>
          <pattern
            id="map-grid"
            width="40"
            height="40"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 40 0 L 0 0 0 40"
              fill="none"
              stroke="#cbd5e1"
              strokeWidth="1"
            />
          </pattern>
        </defs>
        <rect width="400" height="300" fill="url(#map-grid)" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center">
        <button
          type="button"
          onClick={() => setShow(true)}
          className="rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2"
        >
          Show map
        </button>
        <p className="text-xs text-gray-500 dark:text-slate-400">
          {campusCount} campus{campusCount === 1 ? "" : "es"}
        </p>
      </div>
    </div>
  );
}

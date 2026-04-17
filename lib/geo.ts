import type { Institution, SearchResult } from "./types";

// Static JSON imports so this module is safe on the edge runtime (no `fs`).
// Same pattern as `lib/institutions.ts`. Empty placeholder JSON files exist
// for states without geocoded ZIP data (pa, nj) so distance filtering
// gracefully no-ops there rather than erroring.
// Full data set is ~500 KB uncompressed across 15 states.
import vaZipcodes from "@/data/va/zipcodes.json";
import ncZipcodes from "@/data/nc/zipcodes.json";
import scZipcodes from "@/data/sc/zipcodes.json";
import dcZipcodes from "@/data/dc/zipcodes.json";
import mdZipcodes from "@/data/md/zipcodes.json";
import gaZipcodes from "@/data/ga/zipcodes.json";
import deZipcodes from "@/data/de/zipcodes.json";
import tnZipcodes from "@/data/tn/zipcodes.json";
import nyZipcodes from "@/data/ny/zipcodes.json";
import riZipcodes from "@/data/ri/zipcodes.json";
import vtZipcodes from "@/data/vt/zipcodes.json";
import ctZipcodes from "@/data/ct/zipcodes.json";
import meZipcodes from "@/data/me/zipcodes.json";
import paZipcodes from "@/data/pa/zipcodes.json";
import njZipcodes from "@/data/nj/zipcodes.json";

type ZipEntry = { lat: number; lng: number; city: string };

const ZIP_REGISTRY: Record<string, Record<string, ZipEntry>> = {
  va: vaZipcodes as Record<string, ZipEntry>,
  nc: ncZipcodes as Record<string, ZipEntry>,
  sc: scZipcodes as Record<string, ZipEntry>,
  dc: dcZipcodes as Record<string, ZipEntry>,
  md: mdZipcodes as Record<string, ZipEntry>,
  ga: gaZipcodes as Record<string, ZipEntry>,
  de: deZipcodes as Record<string, ZipEntry>,
  tn: tnZipcodes as Record<string, ZipEntry>,
  ny: nyZipcodes as Record<string, ZipEntry>,
  ri: riZipcodes as Record<string, ZipEntry>,
  vt: vtZipcodes as Record<string, ZipEntry>,
  ct: ctZipcodes as Record<string, ZipEntry>,
  me: meZipcodes as Record<string, ZipEntry>,
  pa: paZipcodes as Record<string, ZipEntry>,
  nj: njZipcodes as Record<string, ZipEntry>,
};

function loadZipData(state = "va"): Record<string, ZipEntry> {
  return ZIP_REGISTRY[state] ?? {};
}

/**
 * Look up coordinates and city name for a ZIP code in the given state.
 * Returns null if the ZIP code is not found in the static dataset.
 */
export function getZipCoordinates(
  zip: string,
  state = "va"
): { lat: number; lng: number; city: string } | null {
  const data = loadZipData(state);
  const entry = data[zip];
  return entry ?? null;
}

/**
 * Find zip codes matching a city name (case-insensitive).
 * Returns the first match's zip code, or null if not found.
 */
export function findZipByCity(
  cityQuery: string,
  state = "va"
): { zip: string; lat: number; lng: number; city: string } | null {
  const data = loadZipData(state);
  const query = cityQuery.trim().toLowerCase();
  if (!query) return null;

  // Exact match first
  for (const [zip, entry] of Object.entries(data)) {
    if (entry.city.toLowerCase() === query) {
      return { zip, ...entry };
    }
  }

  // Prefix match as fallback
  for (const [zip, entry] of Object.entries(data)) {
    if (entry.city.toLowerCase().startsWith(query)) {
      return { zip, ...entry };
    }
  }

  return null;
}

/**
 * Resolve a user query (zip code or city name) to coordinates.
 * Returns zip, coordinates, and city name, or null if not found.
 */
export function resolveLocation(
  query: string,
  state = "va"
): { zip: string; lat: number; lng: number; city: string } | null {
  const trimmed = query.trim();

  // If it looks like a zip code, try that first
  if (/^\d{5}$/.test(trimmed)) {
    const coords = getZipCoordinates(trimmed, state);
    if (coords) return { zip: trimmed, ...coords };
  }

  // Otherwise try city name lookup
  return findZipByCity(trimmed, state);
}

/**
 * Calculate the great-circle distance between two points using the Haversine
 * formula.
 * @returns distance in miles
 */
export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const EARTH_RADIUS_MILES = 3958.8;

  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_MILES * c;
}

/**
 * Find institutions within a given radius of coordinates, sorted by distance
 * to the nearest campus.
 */
export function findNearbyInstitutions(
  lat: number,
  lng: number,
  radiusMiles: number,
  institutions: Institution[]
): SearchResult[] {
  const results: SearchResult[] = [];

  for (const institution of institutions) {
    // Find the distance to the nearest campus
    let minDistance = Infinity;

    for (const campus of institution.campuses) {
      const dist = calculateDistance(
        lat,
        lng,
        campus.lat,
        campus.lng
      );
      if (dist < minDistance) {
        minDistance = dist;
      }
    }

    if (minDistance <= radiusMiles) {
      results.push({
        institution,
        distance: Math.round(minDistance * 10) / 10, // round to 1 decimal
        courseCount: 0, // caller should populate with actual course count
      });
    }
  }

  // Sort by distance ascending
  results.sort((a, b) => a.distance - b.distance);

  return results;
}

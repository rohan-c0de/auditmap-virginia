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
import nhZipcodes from "@/data/nh/zipcodes.json";
import maZipcodes from "@/data/ma/zipcodes.json";
import wvZipcodes from "@/data/wv/zipcodes.json";
import flZipcodes from "@/data/fl/zipcodes.json";
import kyZipcodes from "@/data/ky/zipcodes.json";
import alZipcodes from "@/data/al/zipcodes.json";
import msZipcodes from "@/data/ms/zipcodes.json";
import ohZipcodes from "@/data/oh/zipcodes.json";
import miZipcodes from "@/data/mi/zipcodes.json";
import iaZipcodes from "@/data/ia/zipcodes.json";
import moZipcodes from "@/data/mo/zipcodes.json";
import txZipcodes from "@/data/tx/zipcodes.json";
import ilZipcodes from "@/data/il/zipcodes.json";
import hiZipcodes from "@/data/hi/zipcodes.json";
import mtZipcodes from "@/data/mt/zipcodes.json";
import orZipcodes from "@/data/or/zipcodes.json";
import caZipcodes from "@/data/ca/zipcodes.json";
import nvZipcodes from "@/data/nv/zipcodes.json";
import azZipcodes from "@/data/az/zipcodes.json";
import arZipcodes from "@/data/ar/zipcodes.json";
import coZipcodes from "@/data/co/zipcodes.json";
import laZipcodes from "@/data/la/zipcodes.json";
import mnZipcodes from "@/data/mn/zipcodes.json";
import ndZipcodes from "@/data/nd/zipcodes.json";
import nmZipcodes from "@/data/nm/zipcodes.json";
import sdZipcodes from "@/data/sd/zipcodes.json";
import utZipcodes from "@/data/ut/zipcodes.json";
import waZipcodes from "@/data/wa/zipcodes.json";
import wyZipcodes from "@/data/wy/zipcodes.json";
import akZipcodes from "@/data/ak/zipcodes.json";
import idZipcodes from "@/data/id/zipcodes.json";
import wiZipcodes from "@/data/wi/zipcodes.json";
import okZipcodes from "@/data/ok/zipcodes.json";
import neZipcodes from "@/data/ne/zipcodes.json";
import ksZipcodes from "@/data/ks/zipcodes.json";

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
  nh: nhZipcodes as Record<string, ZipEntry>,
  ma: maZipcodes as Record<string, ZipEntry>,
  wv: wvZipcodes as Record<string, ZipEntry>,
  fl: flZipcodes as Record<string, ZipEntry>,
  ky: kyZipcodes as Record<string, ZipEntry>,
  al: alZipcodes as Record<string, ZipEntry>,
  ms: msZipcodes as Record<string, ZipEntry>,
  oh: ohZipcodes as Record<string, ZipEntry>,
  mi: miZipcodes as Record<string, ZipEntry>,
  ia: iaZipcodes as Record<string, ZipEntry>,
  mo: moZipcodes as Record<string, ZipEntry>,
  tx: txZipcodes as Record<string, ZipEntry>,
  il: ilZipcodes as Record<string, ZipEntry>,
  hi: hiZipcodes as Record<string, ZipEntry>,
  mt: mtZipcodes as Record<string, ZipEntry>,
  or: orZipcodes as Record<string, ZipEntry>,
  ca: caZipcodes as Record<string, ZipEntry>,
  nv: nvZipcodes as Record<string, ZipEntry>,
  az: azZipcodes as Record<string, ZipEntry>,
  ar: arZipcodes as Record<string, ZipEntry>,
  co: coZipcodes as Record<string, ZipEntry>,
  la: laZipcodes as Record<string, ZipEntry>,
  mn: mnZipcodes as Record<string, ZipEntry>,
  nd: ndZipcodes as Record<string, ZipEntry>,
  nm: nmZipcodes as Record<string, ZipEntry>,
  sd: sdZipcodes as Record<string, ZipEntry>,
  ut: utZipcodes as Record<string, ZipEntry>,
  wa: waZipcodes as Record<string, ZipEntry>,
  wy: wyZipcodes as Record<string, ZipEntry>,
  ak: akZipcodes as Record<string, ZipEntry>,
  id: idZipcodes as Record<string, ZipEntry>,
  wi: wiZipcodes as Record<string, ZipEntry>,
  ok: okZipcodes as Record<string, ZipEntry>,
  ne: neZipcodes as Record<string, ZipEntry>,
  ks: ksZipcodes as Record<string, ZipEntry>,
};

function loadZipData(state: string): Record<string, ZipEntry> {
  return ZIP_REGISTRY[state] ?? {};
}

/**
 * Look up coordinates and city name for a ZIP code in the given state.
 * Returns null if the ZIP code is not found in the static dataset.
 */
export function getZipCoordinates(
  zip: string,
  state: string
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
  state: string
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
  state: string
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

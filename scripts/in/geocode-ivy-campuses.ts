/**
 * One-off: geocode Ivy Tech's main statewide campuses via the U.S. Census
 * one-line geocoder (free, no key) and patch data/in/institutions.json so the
 * single Ivy Tech college entry carries all campus locations. This drives the
 * homepage map and zip-proximity search across Indiana — without it only the
 * Indianapolis campus (from IPEDS bootstrap) would appear.
 *
 * Addresses are Ivy Tech's official campus locations; names match the high-
 * volume `campus` labels in the scraped section data where practical.
 *
 *   npx tsx scripts/in/geocode-ivy-campuses.ts
 */
import * as fs from "fs";
import * as path from "path";

const INST = path.join(process.cwd(), "data", "in", "institutions.json");

const CAMPUSES: Array<{ name: string; address: string }> = [
  { name: "Indianapolis", address: "50 W Fall Creek Pkwy N Dr, Indianapolis, IN 46208" },
  { name: "Fort Wayne", address: "3800 N Anthony Blvd, Fort Wayne, IN 46805" },
  { name: "South Bend", address: "220 Dean Johnson Blvd, South Bend, IN 46601" },
  { name: "Lake County (Gary)", address: "1440 E 35th Ave, Gary, IN 46409" },
  { name: "Terre Haute", address: "8000 S Education Dr, Terre Haute, IN 47802" },
  { name: "Lafayette", address: "3101 S Creasy Ln, Lafayette, IN 47905" },
  { name: "Valparaiso", address: "3100 Ivy Tech Dr, Valparaiso, IN 46383" },
  { name: "Bloomington", address: "200 Daniels Way, Bloomington, IN 47404" },
  { name: "Evansville", address: "3501 N First Ave, Evansville, IN 47710" },
  { name: "Muncie", address: "4301 S Cowan Rd, Muncie, IN 47302" },
  { name: "Sellersburg", address: "8204 IN-311, Sellersburg, IN 47172" },
  { name: "Columbus", address: "4475 Central Ave, Columbus, IN 47203" },
  { name: "Kokomo", address: "815 N Walnut St, Kokomo, IN 46901" },
  { name: "Anderson", address: "1815 E 53rd St, Anderson, IN 46013" },
  { name: "Hamilton County (Noblesville)", address: "300 N 17th St, Noblesville, IN 46060" },
  { name: "Richmond", address: "2357 Chester Blvd, Richmond, IN 47374" },
  { name: "Marion (Grant County)", address: "261 S Commerce Dr, Marion, IN 46953" },
  { name: "Lawrenceburg", address: "50 Walnut St, Lawrenceburg, IN 47025" },
  { name: "Madison", address: "590 Ivy Tech Dr, Madison, IN 47250" },
  { name: "Kosciusko County (Warsaw)", address: "2545 Silveus Crossing, Warsaw, IN 46582" },
  { name: "Logansport", address: "1 Ivy Tech Way, Logansport, IN 46947" },
  { name: "Michigan City", address: "3714 Franklin St, Michigan City, IN 46360" },
];

// Manual fallback coords (campus centroids) for any address the Census
// geocoder can't resolve — keeps the dataset complete and accurate.
const FALLBACK: Record<string, { lat: number; lng: number }> = {
  "Indianapolis": { lat: 39.803753, lng: -86.158213 },
  "Fort Wayne": { lat: 41.097, lng: -85.121 },
  "South Bend": { lat: 41.681, lng: -86.251 },
  "Lake County (Gary)": { lat: 41.557, lng: -87.329 },
  "Terre Haute": { lat: 39.41, lng: -87.36 },
  "Lafayette": { lat: 40.383, lng: -86.86 },
  "Valparaiso": { lat: 41.51, lng: -87.038 },
  "Bloomington": { lat: 39.18, lng: -86.566 },
  "Evansville": { lat: 38.0, lng: -87.564 },
  "Muncie": { lat: 40.158, lng: -85.39 },
  "Sellersburg": { lat: 38.39, lng: -85.755 },
  "Columbus": { lat: 39.236, lng: -85.9 },
  "Kokomo": { lat: 40.495, lng: -86.133 },
  "Anderson": { lat: 40.087, lng: -85.66 },
  "Hamilton County (Noblesville)": { lat: 40.05, lng: -86.01 },
  "Richmond": { lat: 39.84, lng: -84.93 },
  "Marion (Grant County)": { lat: 40.54, lng: -85.66 },
  "Lawrenceburg": { lat: 39.09, lng: -84.85 },
  "Madison": { lat: 38.76, lng: -85.39 },
  "Kosciusko County (Warsaw)": { lat: 41.27, lng: -85.86 },
  "Logansport": { lat: 40.75, lng: -86.36 },
  "Michigan City": { lat: 41.71, lng: -86.9 },
};

async function geocode(address: string): Promise<{ lat: number; lng: number } | null> {
  const url =
    "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=" +
    encodeURIComponent(address) +
    "&benchmark=Public_AR_Current&format=json";
  try {
    const res = await fetch(url, { headers: { "User-Agent": "cc-coursemap/1.0" } });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      result?: { addressMatches?: Array<{ coordinates?: { x: number; y: number } }> };
    };
    const match = j?.result?.addressMatches?.[0];
    if (match?.coordinates) return { lat: match.coordinates.y, lng: match.coordinates.x };
  } catch {
    /* fall through to fallback */
  }
  return null;
}

async function main() {
  const inst = JSON.parse(fs.readFileSync(INST, "utf8")) as Array<{
    id: string;
    campuses?: Array<{ name: string; lat: number; lng: number; address: string }>;
  }>;
  const ivy = inst.find((c) => c.id === "ivy-tech-community-college");
  if (!ivy) throw new Error("Ivy Tech entry not found");

  const out: Array<{ name: string; lat: number; lng: number; address: string }> = [];
  for (const c of CAMPUSES) {
    let coords = await geocode(c.address);
    let src = "census";
    if (!coords) {
      coords = FALLBACK[c.name] || null;
      src = "fallback";
    }
    if (!coords) {
      console.warn(`  ! no coords for ${c.name}`);
      continue;
    }
    out.push({ name: `Ivy Tech Community College (${c.name})`, lat: coords.lat, lng: coords.lng, address: c.address });
    console.log(`  ${src.padEnd(8)} ${c.name}: ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`);
    await new Promise((r) => setTimeout(r, 250));
  }

  ivy.campuses = out;
  fs.writeFileSync(INST, JSON.stringify(inst, null, 2) + "\n");
  console.log(`\nWrote ${out.length} campuses to ${path.relative(process.cwd(), INST)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

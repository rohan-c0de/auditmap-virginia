/**
 * Registry integrity check.
 *
 * For every slug in `getAllStates()`, verifies that every per-state
 * touchpoint is wired up — data files present, config importable, and
 * the slug appears in both `lib/institutions.ts` (REGISTRY) and
 * `lib/geo.ts` (ZIP_REGISTRY). These two files use static imports for
 * edge-runtime compatibility, so a missing entry silently produces an
 * empty page in production rather than a build error. See issue #48.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getAllStates } from "../lib/states/registry";
import { loadInstitutions } from "../lib/institutions";

const ROOT = resolve(__dirname, "..");
const errors: string[] = [];

function err(slug: string, msg: string) {
  errors.push(`[${slug}] ${msg}`);
}

const institutionsSrc = readFileSync(resolve(ROOT, "lib/institutions.ts"), "utf8");
const geoSrc = readFileSync(resolve(ROOT, "lib/geo.ts"), "utf8");

for (const { slug } of getAllStates()) {
  // 1. Data files exist and parse with the expected shape.
  const instPath = resolve(ROOT, `data/${slug}/institutions.json`);
  const zipPath = resolve(ROOT, `data/${slug}/zipcodes.json`);
  const transferPath = resolve(ROOT, `data/${slug}/transfer-equiv.json`);

  if (!existsSync(instPath)) {
    err(slug, `data/${slug}/institutions.json missing`);
  } else {
    try {
      const inst = JSON.parse(readFileSync(instPath, "utf8"));
      if (!Array.isArray(inst) || inst.length === 0) {
        err(slug, `data/${slug}/institutions.json must be a non-empty array`);
      }
    } catch (e) {
      err(slug, `data/${slug}/institutions.json failed to parse: ${(e as Error).message}`);
    }
  }

  if (!existsSync(zipPath)) {
    err(slug, `data/${slug}/zipcodes.json missing`);
  } else {
    try {
      const zips = JSON.parse(readFileSync(zipPath, "utf8"));
      if (zips === null || typeof zips !== "object" || Array.isArray(zips)) {
        err(slug, `data/${slug}/zipcodes.json must be an object (may be empty)`);
      }
    } catch (e) {
      err(slug, `data/${slug}/zipcodes.json failed to parse: ${(e as Error).message}`);
    }
  }

  if (!existsSync(transferPath)) {
    err(slug, `data/${slug}/transfer-equiv.json missing`);
  } else {
    try {
      const t = JSON.parse(readFileSync(transferPath, "utf8"));
      if (!Array.isArray(t)) {
        err(slug, `data/${slug}/transfer-equiv.json must be an array (may be empty)`);
      }
    } catch (e) {
      err(slug, `data/${slug}/transfer-equiv.json failed to parse: ${(e as Error).message}`);
    }
  }

  // 2. Per-state config file present.
  if (!existsSync(resolve(ROOT, `lib/states/${slug}/config.ts`))) {
    err(slug, `lib/states/${slug}/config.ts missing`);
  }

  // 3. `lib/institutions.ts` must import and register this slug.
  //    Matches the key-colon pattern inside the REGISTRY literal, e.g. `  ma: maInstitutions`.
  const instImport = institutionsSrc.includes(`@/data/${slug}/institutions.json`);
  const instKey = new RegExp(`\\b${slug}:\\s*\\w+Institutions\\b`).test(institutionsSrc);
  if (!instImport || !instKey) {
    err(
      slug,
      `lib/institutions.ts missing import/registry entry for "${slug}". Add the static import and the REGISTRY key.`
    );
  }

  // 4. `lib/geo.ts` must import and register this slug in ZIP_REGISTRY.
  const zipImport = geoSrc.includes(`@/data/${slug}/zipcodes.json`);
  const zipKey = new RegExp(`\\b${slug}:\\s*\\w+Zipcodes\\b`).test(geoSrc);
  if (!zipImport || !zipKey) {
    err(
      slug,
      `lib/geo.ts missing import/registry entry for "${slug}". Add the static import and the ZIP_REGISTRY key.`
    );
  }

  // 5. Runtime check: loadInstitutions(slug) returns a non-empty array.
  //    Guards against the REGISTRY map being present but wired to the wrong import.
  try {
    const loaded = loadInstitutions(slug);
    if (!Array.isArray(loaded) || loaded.length === 0) {
      err(slug, `loadInstitutions("${slug}") returned empty — registry entry not wired correctly`);
    }
  } catch (e) {
    err(slug, `loadInstitutions("${slug}") threw: ${(e as Error).message}`);
  }
}

if (errors.length > 0) {
  console.error("Registry integrity check FAILED:\n");
  for (const line of errors) console.error("  " + line);
  console.error(
    `\n${errors.length} issue(s) found across ${getAllStates().length} registered state(s).`
  );
  console.error(
    "\nEvery state slug in lib/states/registry.ts must also be registered in lib/institutions.ts and lib/geo.ts."
  );
  process.exit(1);
}

console.log(
  `Registry integrity OK — ${getAllStates().length} states fully registered.`
);

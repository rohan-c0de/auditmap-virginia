import type { Institution } from "./types";

// Static imports so this module is safe on the edge runtime (no `fs`).
// Each state's institutions JSON is small (<150 KB); the full set is ~400 KB
// across 15 states, well under any edge bundle limit.
import vaInstitutions from "@/data/va/institutions.json";
import ncInstitutions from "@/data/nc/institutions.json";
import scInstitutions from "@/data/sc/institutions.json";
import dcInstitutions from "@/data/dc/institutions.json";
import mdInstitutions from "@/data/md/institutions.json";
import gaInstitutions from "@/data/ga/institutions.json";
import deInstitutions from "@/data/de/institutions.json";
import tnInstitutions from "@/data/tn/institutions.json";
import nyInstitutions from "@/data/ny/institutions.json";
import riInstitutions from "@/data/ri/institutions.json";
import vtInstitutions from "@/data/vt/institutions.json";
import ctInstitutions from "@/data/ct/institutions.json";
import meInstitutions from "@/data/me/institutions.json";
import paInstitutions from "@/data/pa/institutions.json";
import njInstitutions from "@/data/nj/institutions.json";

// Double-cast via `unknown` because the JSON-inferred types narrow some fields
// to `null` where `Institution` expects a concrete type (e.g. `minimum_age` is
// `null` for states without age-based audit policies). The runtime shape
// matches — the JSON schema is authored to match `Institution` — so this cast
// is safe; it just appeases TS's structural comparison.
const REGISTRY: Record<string, Institution[]> = {
  va: vaInstitutions as unknown as Institution[],
  nc: ncInstitutions as unknown as Institution[],
  sc: scInstitutions as unknown as Institution[],
  dc: dcInstitutions as unknown as Institution[],
  md: mdInstitutions as unknown as Institution[],
  ga: gaInstitutions as unknown as Institution[],
  de: deInstitutions as unknown as Institution[],
  tn: tnInstitutions as unknown as Institution[],
  ny: nyInstitutions as unknown as Institution[],
  ri: riInstitutions as unknown as Institution[],
  vt: vtInstitutions as unknown as Institution[],
  ct: ctInstitutions as unknown as Institution[],
  me: meInstitutions as unknown as Institution[],
  pa: paInstitutions as unknown as Institution[],
  nj: njInstitutions as unknown as Institution[],
};

/**
 * Load institutions for a given state. Data is statically bundled so this
 * works on both Node and edge runtimes.
 */
export function loadInstitutions(state = "va"): Institution[] {
  return REGISTRY[state] ?? [];
}

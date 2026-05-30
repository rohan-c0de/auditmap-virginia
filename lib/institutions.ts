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
import nhInstitutions from "@/data/nh/institutions.json";
import maInstitutions from "@/data/ma/institutions.json";
import wvInstitutions from "@/data/wv/institutions.json";
import flInstitutions from "@/data/fl/institutions.json";
import kyInstitutions from "@/data/ky/institutions.json";
import alInstitutions from "@/data/al/institutions.json";
import msInstitutions from "@/data/ms/institutions.json";
import ohInstitutions from "@/data/oh/institutions.json";
import miInstitutions from "@/data/mi/institutions.json";
import iaInstitutions from "@/data/ia/institutions.json";
import moInstitutions from "@/data/mo/institutions.json";
import txInstitutions from "@/data/tx/institutions.json";
import ilInstitutions from "@/data/il/institutions.json";
import hiInstitutions from "@/data/hi/institutions.json";
import mtInstitutions from "@/data/mt/institutions.json";
import orInstitutions from "@/data/or/institutions.json";
import caInstitutions from "@/data/ca/institutions.json";
import nvInstitutions from "@/data/nv/institutions.json";
import azInstitutions from "@/data/az/institutions.json";
import arInstitutions from "@/data/ar/institutions.json";
import mnInstitutions from "@/data/mn/institutions.json";
import laInstitutions from "@/data/la/institutions.json";
import nmInstitutions from "@/data/nm/institutions.json";
import sdInstitutions from "@/data/sd/institutions.json";
import utInstitutions from "@/data/ut/institutions.json";
import waInstitutions from "@/data/wa/institutions.json";
import coInstitutions from "@/data/co/institutions.json";
import ndInstitutions from "@/data/nd/institutions.json";
import wyInstitutions from "@/data/wy/institutions.json";
import idInstitutions from "@/data/id/institutions.json";

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
  nh: nhInstitutions as unknown as Institution[],
  ma: maInstitutions as unknown as Institution[],
  wv: wvInstitutions as unknown as Institution[],
  fl: flInstitutions as unknown as Institution[],
  ky: kyInstitutions as unknown as Institution[],
  al: alInstitutions as unknown as Institution[],
  ms: msInstitutions as unknown as Institution[],
  oh: ohInstitutions as unknown as Institution[],
  mi: miInstitutions as unknown as Institution[],
  ia: iaInstitutions as unknown as Institution[],
  mo: moInstitutions as unknown as Institution[],
  tx: txInstitutions as unknown as Institution[],
  il: ilInstitutions as unknown as Institution[],
  hi: hiInstitutions as unknown as Institution[],
  mt: mtInstitutions as unknown as Institution[],
  or: orInstitutions as unknown as Institution[],
  ca: caInstitutions as unknown as Institution[],
  nv: nvInstitutions as unknown as Institution[],
  az: azInstitutions as unknown as Institution[],
  ar: arInstitutions as unknown as Institution[],
  mn: mnInstitutions as unknown as Institution[],
  la: laInstitutions as unknown as Institution[],
  nm: nmInstitutions as unknown as Institution[],
  sd: sdInstitutions as unknown as Institution[],
  ut: utInstitutions as unknown as Institution[],
  wa: waInstitutions as unknown as Institution[],
  co: coInstitutions as unknown as Institution[],
  nd: ndInstitutions as unknown as Institution[],
  wy: wyInstitutions as unknown as Institution[],
  id: idInstitutions as unknown as Institution[],
};

/**
 * Load institutions for a given state. Data is statically bundled so this
 * works on both Node and edge runtimes.
 */
export function loadInstitutions(state: string): Institution[] {
  return REGISTRY[state] ?? [];
}

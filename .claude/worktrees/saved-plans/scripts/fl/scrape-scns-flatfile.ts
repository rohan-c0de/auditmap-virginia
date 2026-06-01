/**
 * scrape-scns-flatfile.ts (FL)
 *
 * Builds Florida's transfer-equivalency dataset from the SCNS flat-file
 * dump at flscns.fldoe.org. Replaces the per-receiver scrape pattern used
 * for VA/NC/GA — Florida runs a state-wide course-numbering system, so the
 * articulation IS algorithmic: two courses at any FL public institution
 * are equivalent by law if they share prefix + 3-digit number + lab code.
 * (FL Stat. § 1007.24, Rule 6A-10.024 — see SCNS Public User Manual.)
 *
 * Source:
 *   POST https://flscns.fldoe.org/Default with __EVENTTARGET=ctl00$hl_download
 *   → 79 MB attachment "crslist.txt", 411-char fixed-width records.
 *   No authentication. ~190k records covering every FL public-college
 *   course-at-an-institution (active + reserved + discontinued).
 *
 * Output:
 *   data/fl/transfer-equiv.json — rows of shape `TransferMapping`.
 *   One row per (SCNS code × receiving public university) where the code
 *   is offered by at least one of the 28 FCS colleges and is also offered
 *   by the receiving university and survives the SCNS exception list.
 *
 * Usage:
 *   npx tsx scripts/fl/scrape-scns-flatfile.ts            # download + write
 *   npx tsx scripts/fl/scrape-scns-flatfile.ts --cached   # reuse last download
 *   npx tsx scripts/fl/scrape-scns-flatfile.ts --no-import
 */

import fs from "fs";
import path from "path";
import { importTransfersToSupabase } from "../lib/supabase-import";

// ---------------------------------------------------------------------------
// Institution map — SCNS numeric ID (positions 1-7 of each record) to our
// internal college / university slug. Discovered by scraping the public
// dropdown at flscns.fldoe.org/PbInstituteCourseSearch.aspx and matching
// against data/fl/institutions.json + the FL config's universityAliases.
//
// 28 FCS colleges (sending side) + 12 public 4-year institutions (receiving
// side). Private universities (Miami, Rollins) are out of scope — SCNS
// only covers public-system articulation.
// ---------------------------------------------------------------------------

const FCS_INSTITUTIONS: Record<number, string> = {
  1: "southflorida",
  2: "sjrstate",
  4: "phsc",
  5: "lssc",
  11: "scf",
  20: "fscj",
  26: "broward",
  27: "gulfcoast",
  29: "nwfsc",
  31: "palmbeachstate",
  37: "mdc",
  48: "polk",
  49: "valencia",
  51: "spcollege",
  52: "sfcollege",
  55: "fgc",
  56: "daytonastate",
  59: "irsc",
  68: "easternflorida",
  69: "cf",
  73: "nfc",
  76: "pensacolastate",
  79: "fsw",
  89: "seminolestate",
  94: "chipola",
  96: "cfk",
  98: "tcc-fl",
  102: "hccfl",
};

interface SusInstitution {
  slug: string;
  name: string;
}

const SUS_INSTITUTIONS: Record<number, SusInstitution> = {
  9: { slug: "unf", name: "University of North Florida" },
  13: { slug: "famu", name: "Florida A&M University" },
  17: { slug: "fiu", name: "Florida International University" },
  22: { slug: "usf", name: "University of South Florida" },
  23: { slug: "ucf", name: "University of Central Florida" },
  64: { slug: "fgcu", name: "Florida Gulf Coast University" },
  75: { slug: "fau", name: "Florida Atlantic University" },
  82: { slug: "uwf", name: "University of West Florida" },
  85: { slug: "fsu", name: "Florida State University" },
  101: { slug: "uf", name: "University of Florida" },
  137: { slug: "flpoly", name: "Florida Polytechnic University" },
  147: { slug: "ncf", name: "New College of Florida" },
};

// ---------------------------------------------------------------------------
// Fixed-width record parsing. Positions are 0-indexed half-open ranges,
// derived empirically from the public flat file (April 2026 sample, 411
// chars wide). Matches /Downloads/File_Format_for_SCNS_Flat_File.doc.
// ---------------------------------------------------------------------------

interface ScnsRecord {
  institution: number;
  prefix: string;
  level: string;
  number: string;
  lab: string;
  status: string;
  title: string;
  credits: string;
}

function parseRecord(line: string): ScnsRecord | null {
  if (line.length < 200) return null;
  return {
    institution: parseInt(line.slice(0, 7), 10),
    prefix: line.slice(10, 13).trim(),
    level: line.slice(13, 14),
    number: line.slice(14, 17),
    lab: line.slice(17, 18).trim(),
    status: line.slice(28, 29),
    title: line.slice(29, 179).trim(),
    credits: line.slice(179, 187).trim(),
  };
}

// SCNS exception list (Public User Manual, page 2). A course matching any
// of these does NOT auto-articulate even if a same-prefix-and-number
// course exists at the receiving institution.
function isExcluded(r: ScnsRecord): boolean {
  // Status filter — only Active courses participate.
  if (r.status !== "A") return true;
  // 0-level: college prep / vocational prep — not transferable for credit.
  if (r.level === "0") return true;
  // 5-9 level: graduate courses — not under SCNS undergrad articulation.
  const lvl = parseInt(r.level, 10);
  if (Number.isFinite(lvl) && lvl >= 5) return true;
  // X900-999 series — institutional electives, evaluated case-by-case.
  if (r.number.startsWith("9")) return true;
  // TPP X000-X299 — performing-arts skills, not guaranteed transferable.
  if (r.prefix === "TPP") {
    const numLvl = parseInt(r.number, 10);
    if (Number.isFinite(numLvl) && numLvl <= 299) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

const SCNS_BASE = "https://flscns.fldoe.org";
const CACHE_DIR = path.join(process.cwd(), "tmp", "scns");

async function downloadFlatFile(): Promise<string> {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const cachePath = path.join(CACHE_DIR, `crslist-${date}.txt`);

  if (fs.existsSync(cachePath)) {
    const sizeMB = fs.statSync(cachePath).size / 1024 / 1024;
    console.log(
      `Using cached flat file: ${cachePath} (${sizeMB.toFixed(1)} MB)`
    );
    return cachePath;
  }

  console.log("Fetching SCNS homepage to capture viewstate token...");
  const homeRes = await fetch(`${SCNS_BASE}/Default`);
  const homeHtml = await homeRes.text();
  const cookieHeader = (homeRes.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");

  const vs = homeHtml.match(/id="__VIEWSTATE"\s+value="([^"]+)"/)?.[1];
  const vsg = homeHtml.match(
    /id="__VIEWSTATEGENERATOR"\s+value="([^"]+)"/
  )?.[1];
  if (!vs || !vsg) {
    throw new Error(
      "Could not extract __VIEWSTATE / __VIEWSTATEGENERATOR — has the SCNS site changed?"
    );
  }

  console.log("POSTing flat-file download (this returns ~80 MB)...");
  const body = new URLSearchParams({
    __EVENTTARGET: "ctl00$hl_download",
    __EVENTARGUMENT: "",
    __VIEWSTATE: vs,
    __VIEWSTATEGENERATOR: vsg,
  });

  const dlRes = await fetch(`${SCNS_BASE}/Default`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeader,
    },
    body,
  });

  if (!dlRes.ok) {
    throw new Error(`Flat-file download returned HTTP ${dlRes.status}`);
  }

  const buf = Buffer.from(await dlRes.arrayBuffer());
  fs.writeFileSync(cachePath, buf);
  console.log(
    `  → ${cachePath} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`
  );
  return cachePath;
}

// ---------------------------------------------------------------------------
// Parse and aggregate
// ---------------------------------------------------------------------------

interface InstitutionCourseOffering {
  institution: number;
  title: string;
  credits: string;
}

// Key shape: "PREFIX LEVEL+NUMBER+LAB", e.g. "ENC 1101", "MAC 1105L".
function scnsKey(r: ScnsRecord): string {
  return `${r.prefix} ${r.level}${r.number}${r.lab}`;
}

interface ParsedFlatFile {
  fcsByCode: Map<string, InstitutionCourseOffering[]>;
  susByCode: Map<string, InstitutionCourseOffering[]>;
  perFcsCounts: Map<number, number>;
  perSusCounts: Map<number, number>;
  totalParsed: number;
  totalAfterFilter: number;
}

function parseFlatFile(filePath: string): ParsedFlatFile {
  const fcsByCode = new Map<string, InstitutionCourseOffering[]>();
  const susByCode = new Map<string, InstitutionCourseOffering[]>();
  const perFcsCounts = new Map<number, number>();
  const perSusCounts = new Map<number, number>();
  let totalParsed = 0;
  let totalAfterFilter = 0;

  const data = fs.readFileSync(filePath, "utf-8");
  for (const line of data.split("\n")) {
    if (!line) continue;
    totalParsed++;
    const r = parseRecord(line);
    if (!r) continue;

    const isFcs = FCS_INSTITUTIONS[r.institution] !== undefined;
    const isSus = SUS_INSTITUTIONS[r.institution] !== undefined;
    if (!isFcs && !isSus) continue;
    if (isExcluded(r)) continue;

    totalAfterFilter++;
    const key = scnsKey(r);
    const offering: InstitutionCourseOffering = {
      institution: r.institution,
      title: r.title,
      credits: r.credits,
    };

    if (isFcs) {
      let arr = fcsByCode.get(key);
      if (!arr) {
        arr = [];
        fcsByCode.set(key, arr);
      }
      arr.push(offering);
      perFcsCounts.set(
        r.institution,
        (perFcsCounts.get(r.institution) ?? 0) + 1
      );
    } else {
      let arr = susByCode.get(key);
      if (!arr) {
        arr = [];
        susByCode.set(key, arr);
      }
      arr.push(offering);
      perSusCounts.set(
        r.institution,
        (perSusCounts.get(r.institution) ?? 0) + 1
      );
    }
  }

  return {
    fcsByCode,
    susByCode,
    perFcsCounts,
    perSusCounts,
    totalParsed,
    totalAfterFilter,
  };
}

// ---------------------------------------------------------------------------
// Build transfer mappings
// ---------------------------------------------------------------------------

interface TransferMapping {
  cc_prefix: string;
  cc_number: string;
  cc_course: string;
  cc_title: string;
  cc_credits: string;
  university: string;
  university_name: string;
  univ_course: string;
  univ_title: string;
  univ_credits: string;
  notes: string;
  no_credit: boolean;
  is_elective: boolean;
}

// Pick the most common title across the offerings (or arbitrary first if
// all unique). Same for credits. The transfer-equiv schema has no per-CC
// dimension; we collapse 28 FCS senders into one representative row, which
// is correct under SCNS rules — the credit transfers regardless of which
// CC the student attended.
function pickRepresentative(
  offerings: InstitutionCourseOffering[]
): { title: string; credits: string } {
  if (offerings.length === 0) return { title: "", credits: "" };
  const titleCounts = new Map<string, number>();
  const creditCounts = new Map<string, number>();
  for (const o of offerings) {
    if (o.title) {
      titleCounts.set(o.title, (titleCounts.get(o.title) ?? 0) + 1);
    }
    if (o.credits) {
      creditCounts.set(o.credits, (creditCounts.get(o.credits) ?? 0) + 1);
    }
  }
  const topTitle =
    [...titleCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
    offerings[0].title;
  const topCredits =
    [...creditCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
    offerings[0].credits;
  return { title: topTitle, credits: topCredits };
}

// Title-case a SCREAMING-CAPS title to match the convention used in other
// transfer-equiv files (e.g. "Principles of Accounting", not "PRINCIPLES
// OF ACCOUNTING"). Preserves obvious acronyms (3+ caps already in source
// but no, source is uniformly upper) — we only lowercase short words.
const SMALL_WORDS = new Set([
  "of",
  "and",
  "the",
  "a",
  "an",
  "to",
  "in",
  "for",
  "on",
  "or",
  "with",
  "at",
  "by",
  "as",
]);

function titleCase(s: string): string {
  if (!s) return s;
  const words = s.toLowerCase().split(/\s+/);
  return words
    .map((w, i) => {
      if (i > 0 && SMALL_WORDS.has(w)) return w;
      // Roman numerals — keep upper
      if (/^[ivx]+$/i.test(w)) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ");
}

function buildMappings(parsed: ParsedFlatFile): TransferMapping[] {
  const out: TransferMapping[] = [];

  for (const [scnsCode, fcsOfferings] of parsed.fcsByCode) {
    const susOfferings = parsed.susByCode.get(scnsCode);
    if (!susOfferings) continue; // No public 4-year offers it → not transferable in-system

    const fcsRep = pickRepresentative(fcsOfferings);
    const [prefix, rest] = scnsCode.split(" ");
    // rest is "1101" or "1105L" or "2204C". Number portion is 4 chars
    // (level + 3-digit), lab is 0-1 trailing char. Schema fields cc_number
    // store the number portion AS THE COURSES ARE SCRAPED in Banner —
    // existing data shows "1101", "2021C", etc. So we keep lab in cc_number.
    const ccNumber = rest;

    // Group SUS offerings by institution; emit one row per receiving uni.
    const byUni = new Map<number, InstitutionCourseOffering[]>();
    for (const o of susOfferings) {
      let arr = byUni.get(o.institution);
      if (!arr) {
        arr = [];
        byUni.set(o.institution, arr);
      }
      arr.push(o);
    }

    for (const [instId, offerings] of byUni) {
      const sus = SUS_INSTITUTIONS[instId];
      if (!sus) continue;
      const susRep = pickRepresentative(offerings);
      out.push({
        cc_prefix: prefix,
        cc_number: ccNumber,
        cc_course: scnsCode,
        cc_title: titleCase(fcsRep.title),
        cc_credits: fcsRep.credits || "",
        university: sus.slug,
        university_name: sus.name,
        univ_course: scnsCode,
        univ_title: titleCase(susRep.title),
        univ_credits: susRep.credits || "",
        notes: "",
        no_credit: false,
        is_elective: false,
      });
    }
  }

  // Stable sort — by SCNS code, then university — so re-runs produce
  // identical diffs unless data actually changed.
  out.sort((a, b) => {
    if (a.cc_course !== b.cc_course) return a.cc_course < b.cc_course ? -1 : 1;
    return a.university < b.university ? -1 : 1;
  });

  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const useCached = args.includes("--cached");
  const noImport = args.includes("--no-import");

  // --cached prefers any existing crslist file in tmp/scns/, regardless
  // of date. Useful in dev when iterating on parse logic.
  let filePath: string;
  if (useCached) {
    const files = fs.existsSync(CACHE_DIR)
      ? fs
          .readdirSync(CACHE_DIR)
          .filter((f) => f.startsWith("crslist-") && f.endsWith(".txt"))
          .sort()
      : [];
    if (files.length === 0) {
      throw new Error(
        `No cached crslist file in ${CACHE_DIR}. Drop --cached to download.`
      );
    }
    filePath = path.join(CACHE_DIR, files[files.length - 1]);
    const sizeMB = fs.statSync(filePath).size / 1024 / 1024;
    console.log(`Using cached: ${filePath} (${sizeMB.toFixed(1)} MB)`);
  } else {
    filePath = await downloadFlatFile();
  }

  console.log("\nParsing flat file...");
  const parsed = parseFlatFile(filePath);
  console.log(
    `  Parsed ${parsed.totalParsed} records, ${parsed.totalAfterFilter} survived filters`
  );
  console.log(`  Unique SCNS codes at FCS: ${parsed.fcsByCode.size}`);
  console.log(`  Unique SCNS codes at SUS: ${parsed.susByCode.size}`);

  console.log("\nPer-FCS active-course counts:");
  for (const [id, slug] of Object.entries(FCS_INSTITUTIONS)) {
    const n = parsed.perFcsCounts.get(parseInt(id, 10)) ?? 0;
    const flag = n < 100 ? "  ⚠ low" : "";
    console.log(`  ${slug.padEnd(18)} ${String(n).padStart(5)}${flag}`);
  }
  console.log("\nPer-SUS active-course counts:");
  for (const [id, sus] of Object.entries(SUS_INSTITUTIONS)) {
    const n = parsed.perSusCounts.get(parseInt(id, 10)) ?? 0;
    const flag = n < 100 ? "  ⚠ low" : "";
    console.log(`  ${sus.slug.padEnd(8)} ${String(n).padStart(5)}${flag}`);
  }

  console.log("\nBuilding transfer mappings...");
  const mappings = buildMappings(parsed);
  console.log(`  Total mappings: ${mappings.length}`);

  // Spot checks — these are the most common gen-ed transfers in FL.
  for (const code of ["ENC 1101", "MAC 1105", "PSY 2012", "AMH 2010"]) {
    const sample = mappings.filter((m) => m.cc_course === code);
    const unis = sample.map((m) => m.university).sort();
    console.log(
      `  ${code}: ${sample.length} receivers — ${unis.join(", ") || "(none)"}`
    );
  }

  if (mappings.length === 0) {
    console.error("\n⚠ Zero mappings produced. Aborting before writing.");
    process.exit(1);
  }

  const outPath = path.join(
    process.cwd(),
    "data",
    "fl",
    "transfer-equiv.json"
  );
  fs.writeFileSync(outPath, JSON.stringify(mappings, null, 2) + "\n");
  console.log(`\nWrote ${outPath}`);

  if (!noImport) {
    try {
      const imported = await importTransfersToSupabase("fl");
      if (imported > 0) {
        console.log(`Imported ${imported} rows to Supabase`);
      }
    } catch (err) {
      console.log(`Supabase import skipped: ${(err as Error).message}`);
    }
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

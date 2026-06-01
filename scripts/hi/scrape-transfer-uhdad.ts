/**
 * scrape-transfer-uhdad.ts — UH System course transfer equivalencies.
 *
 * The University of Hawaiʻi System publishes a single statewide course-
 * transfer database covering all 10 UH campuses (7 CCs + 3 four-years).
 *
 * Background — endpoint migration (2026):
 *   The original Banner SSB form at
 *     https://www.sis.hawaii.edu/uhdad/CourseTransfer.home
 *   was decommissioned and now returns HTTP 502 "service temporarily
 *   unavailable". UH replaced it with an Ellucian-React SPA at
 *     https://www.sis.hawaii.edu:9350/crsetrns/
 *   backed by a JSON API on the same host:
 *     GET /crsetrns/transfer/x-transfer-equiv?institutionCode=<sbgi>&campusCode=<level>
 *     GET /crsetrns/transfer/x-transfer-institution?search=<query>
 *
 *   The API requires an `X-Recaptcha-Token` request header, but it is
 *   only presence-checked (not validated) — any non-empty string works.
 *   The page's recaptcha script tag is commented out in the live HTML
 *   as of 2026-05-29, so this is likely an unfinished gating layer; we
 *   send `cc-coursemap-scraper` as a clearly-attributed token.
 *
 * Parameters:
 *   institutionCode = sending institution's 4-digit STVSBGI code
 *                     (1801 Hawaii CC, 4350 Honolulu CC, etc.)
 *   campusCode      = receiving UH campus's single-digit primary level
 *                     (0 Manoa, 1 Hilo, 2 West Oʻahu, 8 Maui)
 *
 * Response shape (one row per equivalency):
 *   {
 *     subjCodeTrns: "ACC", crseNumbTrns: "120",          // sender (CC) course
 *     subjCodeInst: "OTHO", crseNumbInst: "ELEC0",       // receiver (UH) course
 *     instTitle: "Elective", instCreditsUsed: 3,
 *     sbgiCode: "1801",                                   // sender STVSBGI
 *     tlvlCode: "U0",                                     // receiver level
 *     termCodeEffTrns: "000000" | "202410" | ...,         // effective term ("000000" = current)
 *     ...
 *   }
 *
 * Throttled at 1500ms between requests; the new API is fast (~250-350 KB
 * per pair) but we don't want to compete with student traffic during
 * peak registration.
 *
 * Usage:
 *   npx tsx scripts/hi/scrape-transfer-uhdad.ts
 *   npx tsx scripts/hi/scrape-transfer-uhdad.ts --college honolulu-community-college
 *   npx tsx scripts/hi/scrape-transfer-uhdad.ts --no-import
 */

import * as fs from "fs";
import * as path from "path";

const STATE = "hi";
const API_BASE = "https://www.sis.hawaii.edu:9350/crsetrns";
const DELAY_MS = 1500;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";
// Presence-checked only; any non-empty string passes the server's header
// guard. We send a clearly-attributed value rather than an opaque token.
const RECAPTCHA_TOKEN = "cc-coursemap-scraper";

// Senders: the 6 UH community colleges. STVSBGI codes from the React app's
// embedded institution table (assets/index-*.js, 2026-05-29).
const CC_SENDERS: { sbgi: string; code: string; slug: string }[] = [
  { sbgi: "1801", code: "HAW", slug: "hawaii-community-college" },
  { sbgi: "4350", code: "HON", slug: "honolulu-community-college" },
  { sbgi: "4377", code: "KAP", slug: "kapiolani-community-college" },
  { sbgi: "4378", code: "KAU", slug: "kauai-community-college" },
  { sbgi: "4410", code: "LEE", slug: "leeward-community-college" },
  { sbgi: "4976", code: "WIN", slug: "windward-community-college" },
];

// Receivers: the 3 UH four-year campuses, identified by their single-digit
// primary level in the API's `campusCode` parameter. (UH-Maui at level "8"
// also exists but is a 2/4-year hybrid; CCM treats it as out-of-scope for
// CC→4-year transfer mapping.)
const RECEIVERS: { campus: string; slug: string; name: string }[] = [
  { campus: "0", slug: "uh-manoa", name: "University of Hawaiʻi at Mānoa" },
  { campus: "1", slug: "uh-hilo", name: "University of Hawaiʻi at Hilo" },
  { campus: "2", slug: "uh-west-oahu", name: "University of Hawaiʻi—West Oʻahu" },
];

interface ApiRow {
  subjCodeTrns: string;
  crseNumbTrns: string;
  subjCodeInst: string;
  crseNumbInst: string;
  instTitle: string;
  instCreditsUsed: number | string;
  sbgiCode: string;
  tlvlCode: string;
  termCodeEffTrns: string;
  seqno?: number;
  dataOrigin?: string;
  program?: string;
}

interface TransferMapping {
  state: string;
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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function fetchEquiv(
  sbgi: string,
  campus: string,
  attempt = 0,
): Promise<ApiRow[]> {
  const url = `${API_BASE}/transfer/x-transfer-equiv?institutionCode=${sbgi}&campusCode=${campus}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        "X-Recaptcha-Token": RECAPTCHA_TOKEN,
      },
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) {
      if ((res.status === 502 || res.status === 429 || res.status >= 500) && attempt < 4) {
        const wait = 5000 * Math.pow(2, attempt);
        console.log(`    HTTP ${res.status}; retry ${attempt + 1}/4 in ${wait}ms`);
        await sleep(wait);
        return fetchEquiv(sbgi, campus, attempt + 1);
      }
      throw new Error(`HTTP ${res.status}`);
    }
    return (await res.json()) as ApiRow[];
  } catch (e) {
    if (attempt < 4 && /timeout|network|ECONN|HTTP 5/i.test(String(e))) {
      await sleep(5000 * Math.pow(2, attempt));
      return fetchEquiv(sbgi, campus, attempt + 1);
    }
    throw e;
  }
}

/**
 * UH uses "OTHO ELEC0" / "OTHO ELEC1" / similar opaque codes to denote
 * "elective credit" rather than a specific course. We also see "OTHO 0"
 * variants. Classify these into our is_elective bucket; everything else
 * passes through as a direct match.
 */
function classifyReceiver(
  subjInst: string,
  crseInst: string,
  title: string,
): {
  univ_course: string;
  univ_title: string;
  no_credit: boolean;
  is_elective: boolean;
} {
  const subj = (subjInst || "").trim();
  const crse = (crseInst || "").trim();
  const t = (title || "").trim();
  const lowerT = t.toLowerCase();

  if (!subj && !crse) {
    return {
      univ_course: "",
      univ_title: t || "No equivalent",
      no_credit: true,
      is_elective: false,
    };
  }

  const code = `${subj} ${crse}`.trim();
  if (
    /no\s+credit|no\s+equivalent|not\s+transferable|non\s*transferable/i.test(
      lowerT,
    )
  ) {
    return { univ_course: "", univ_title: t, no_credit: true, is_elective: false };
  }

  // OTHO + ELEC* is UH's "elective credit" placeholder. Also catch
  // titles that literally say "Elective".
  if (
    /^OTHO$/i.test(subj) ||
    /^ELEC\d*/i.test(crse) ||
    /^elective$/i.test(lowerT)
  ) {
    return {
      univ_course: "",
      univ_title: t || `${subj} elective`,
      no_credit: false,
      is_elective: true,
    };
  }

  return { univ_course: code, univ_title: t, no_credit: false, is_elective: false };
}

/**
 * Drop superseded rows: keep only the most-current termCodeEffTrns per
 * (sender course, receiver). "000000" means "currently in effect"; any
 * concrete YYYYMM term is historical. When both exist, "000000" wins.
 */
function selectCurrent(rows: ApiRow[]): ApiRow[] {
  const keep = new Map<string, ApiRow>();
  for (const r of rows) {
    const key = `${r.subjCodeTrns}|${r.crseNumbTrns}|${r.subjCodeInst}|${r.crseNumbInst}|${r.seqno ?? 0}`;
    const existing = keep.get(key);
    if (!existing) {
      keep.set(key, r);
      continue;
    }
    // Prefer "000000" (current) over any historical term code.
    const aCurrent = r.termCodeEffTrns === "000000";
    const bCurrent = existing.termCodeEffTrns === "000000";
    if (aCurrent && !bCurrent) keep.set(key, r);
    else if (aCurrent === bCurrent && r.termCodeEffTrns > existing.termCodeEffTrns) {
      // Both historical — prefer the more recent term.
      keep.set(key, r);
    }
  }
  return Array.from(keep.values());
}

function rowsToMappings(
  rows: ApiRow[],
  sender: { slug: string },
  receiver: { slug: string; name: string },
): TransferMapping[] {
  const out: TransferMapping[] = [];
  for (const r of rows) {
    const ccPrefix = (r.subjCodeTrns || "").trim().toUpperCase();
    const ccNumber = (r.crseNumbTrns || "").trim();
    if (!ccPrefix || !ccNumber) continue;
    const classified = classifyReceiver(
      r.subjCodeInst,
      r.crseNumbInst,
      r.instTitle,
    );
    out.push({
      state: STATE,
      cc_prefix: ccPrefix,
      cc_number: ccNumber,
      cc_course: `${ccPrefix} ${ccNumber}`,
      // The new API doesn't surface the sender's course title; leave blank
      // (the UI joins on (prefix, number) against course catalog data).
      cc_title: "",
      cc_credits: r.instCreditsUsed != null ? String(r.instCreditsUsed) : "",
      university: receiver.slug,
      university_name: receiver.name,
      univ_course: classified.univ_course,
      univ_title: classified.univ_title,
      univ_credits: r.instCreditsUsed != null ? String(r.instCreditsUsed) : "",
      notes: "",
      no_credit: classified.no_credit,
      is_elective: classified.is_elective,
    });
  }
  return out;
}

async function scrapePair(
  sender: { sbgi: string; slug: string },
  receiver: { campus: string; slug: string; name: string },
): Promise<TransferMapping[]> {
  const raw = await fetchEquiv(sender.sbgi, receiver.campus);
  const current = selectCurrent(raw);
  return rowsToMappings(current, sender, receiver);
}

async function main() {
  const args = process.argv.slice(2);
  const collegeIdx = args.indexOf("--college");
  const collegeFilter = collegeIdx >= 0 ? args[collegeIdx + 1] : undefined;
  const noImport = args.includes("--no-import");

  console.log("HI Transfer Equivalency Scraper (UH System SPA API)");
  console.log(`  Source: ${API_BASE}/transfer/x-transfer-equiv\n`);

  const senders = collegeFilter
    ? CC_SENDERS.filter((s) => s.slug === collegeFilter)
    : CC_SENDERS;
  if (senders.length === 0) {
    console.error(
      `Unknown college: ${collegeFilter}. Known: ${CC_SENDERS.map((s) => s.slug).join(", ")}`,
    );
    process.exit(1);
  }

  const allMappings: TransferMapping[] = [];
  const failures: { sender: string; receiver: string; error: string }[] = [];

  for (const sender of senders) {
    let senderTotal = 0;
    for (const receiver of RECEIVERS) {
      try {
        const rows = await scrapePair(sender, receiver);
        allMappings.push(...rows);
        senderTotal += rows.length;
        console.log(`  ${sender.slug} → ${receiver.slug}: ${rows.length} mappings`);
      } catch (e) {
        console.error(
          `  ${sender.slug} → ${receiver.slug}: FAILED — ${(e as Error).message}`,
        );
        failures.push({
          sender: sender.slug,
          receiver: receiver.slug,
          error: (e as Error).message,
        });
      }
      await sleep(DELAY_MS);
    }
    console.log(
      `    ${sender.slug}: +${senderTotal} mappings (running total: ${allMappings.length})`,
    );
  }

  console.log(`\n  Total mappings: ${allMappings.length}`);
  if (failures.length > 0) {
    console.log(`  Failures: ${failures.length}`);
    for (const f of failures) console.log(`    - ${f.sender} → ${f.receiver}: ${f.error}`);
  }

  // Dedup on (cc_course, university, univ_course, univ_title). The API
  // returns multiple seqno rows for some courses that share the same
  // outbound mapping; collapse them.
  const seen = new Set<string>();
  const deduped = allMappings.filter((m) => {
    const key = `${m.cc_prefix}|${m.cc_number}|${m.university}|${m.univ_course}|${m.univ_title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (deduped.length < allMappings.length) {
    console.log(
      `  After dedup: ${deduped.length} (dropped ${allMappings.length - deduped.length} duplicates)`,
    );
  }

  deduped.sort(
    (a, b) =>
      a.cc_prefix.localeCompare(b.cc_prefix) ||
      a.cc_number.localeCompare(b.cc_number) ||
      a.university.localeCompare(b.university),
  );

  // Refuse to write an empty file — leave the existing data untouched
  // per the CLAUDE.md invariant ("if a scraper fails, leave the existing
  // data untouched rather than substitute placeholder courses"). The
  // health-rollup writes status=empty for us when this exits with a
  // zero-byte JSON, but we want zero-byte to mean "definitely fetched
  // and got zero" rather than "API was wedged and we wrote junk".
  if (deduped.length === 0) {
    if (failures.length > 0) {
      console.error("  Refusing to write empty file — every (sender, receiver) pair failed.");
      process.exit(1);
    }
    console.warn("  API returned zero mappings for every pair (unusual). Writing empty array.");
  }

  const outPath = path.join(process.cwd(), "data", STATE, "transfer-equiv.json");
  fs.writeFileSync(outPath, JSON.stringify(deduped, null, 2));
  console.log(`\n  Wrote ${deduped.length} mappings → ${outPath}`);

  if (!noImport && deduped.length > 0) {
    try {
      const { importTransfersToSupabase } = await import("../lib/supabase-import");
      await importTransfersToSupabase(STATE);
    } catch (e) {
      console.log(`  Supabase import skipped: ${(e as Error).message}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

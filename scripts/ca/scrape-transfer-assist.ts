/**
 * scrape-transfer-assist.ts
 *
 * California transfer equivalencies from ASSIST.org — the official statewide
 * articulation portal.
 *
 * Strategy: per-CC transferability lists (UCTCA + CSUTC) rather than per-major
 * articulation reports. UCTCA = UC Transferable Course Agreement (UC system),
 * CSUTC = CSU Transferable Courses (CSU system). Each list gives us the
 * canonical "this course is transferable to the UC/CSU system" answer,
 * which is what most students care about at the broad-survey level.
 *
 * Why not per-major agreements (yet): ASSIST has detailed CC×university×major
 * reports (~50KB each via /api/articulation/Agreements?Key=...) but covering
 * all 116 CCs × ~30 receiving universities × ~30-50 majors each = ~150,000
 * API calls (10+ hours). The system-level UCTCA/CSUTC lists cover the broad
 * transferability question with just 2 calls per CC (~5 min total) and unblock
 * the audit's F-grade on CA transfers. Per-major detail can land as a v2.
 *
 * API: ASSIST.org uses an XSRF-protected REST API. We GET / first to
 * receive the X-XSRF-TOKEN cookie, then echo it back as a header on every
 * subsequent /api/ call. Without the header, every endpoint returns HTTP 400.
 *
 * Endpoints:
 *   GET /                                              → sets X-XSRF-TOKEN cookie
 *   GET /api/institutions                              → 179 institutions, 116 CCs + 63 unis
 *   GET /api/AcademicYears                             → year IDs, current is 76 (2025-26)
 *   GET /api/transferability/courses?institutionId={ccId}&academicYearId=76
 *                              &listType=UCTCA|CSUTC   → ~400KB course list per call
 *
 * Output: one TransferMapping per (CC course, system) pair. univ_course is
 * "TRANSFERABLE" because the system-level list doesn't bind to a specific
 * UC/CSU campus course — `is_elective: true` reflects that. notes records
 * which system + the CC slug for downstream filtering.
 *
 * Usage:
 *   npx tsx scripts/ca/scrape-transfer-assist.ts
 *   npx tsx scripts/ca/scrape-transfer-assist.ts --no-import
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { importTransfersToSupabase } from "../lib/supabase-import.js";

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

interface AssistInstitution {
  id: number;
  code: string;
  isCommunityCollege: boolean;
  names: Array<{ name: string; hideInList?: boolean }>;
}

interface AssistCourse {
  prefixCode: string;
  prefixDescription?: string;
  courseNumber: string;
  courseTitle: string;
  minUnits?: number | null;
  maxUnits?: number | null;
  isCsuTransferable?: boolean;
}

interface AssistTransferabilityResponse {
  listType: number;
  institutionName: string;
  academicYear: { id: number; description: string };
  courseInformationList: AssistCourse[];
}

const BASE_URL = "https://assist.org";
const ACADEMIC_YEAR_ID = 76; // 2025-2026 (current)
const DATA_DIR = path.join(process.cwd(), "data", "ca");
const OUT_FILE = path.join(DATA_DIR, "transfer-equiv.json");
const INST_FILE = path.join(DATA_DIR, "institutions.json");
const DELAY_MS = 1000;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

const LIST_TYPES: Array<{
  code: "UCTCA" | "CSUTC";
  university: string;
  universityName: string;
}> = [
  { code: "UCTCA", university: "uc-system", universityName: "University of California (system-wide)" },
  { code: "CSUTC", university: "csu-system", universityName: "California State University (system-wide)" },
];

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ASSIST display name → our institution slug. Override when slugify diverges.
// Discovered via first-run unmatched report (12 ASSIST CCs didn't slugify to
// our slugs); most are college vs district naming or historical names.
const NAME_OVERRIDES: Record<string, string> = {
  "Mt. San Antonio College": "mt-san-antonio-college",
  "Mount San Antonio College": "mt-san-antonio-college",
  "Mt. San Jacinto College": "mt-san-jacinto-community-college-district",
  "El Camino College": "el-camino-community-college-district",
  "Antelope Valley College": "antelope-valley-community-college-district",
  "Feather River College": "feather-river-community-college-district",
  "Copper Mountain College": "copper-mountain-community-college",
  "Compton Community College": "compton-college",
  // ASSIST uses historical names for these two:
  "Kings River College": "reedley-college",
  "Vista Community College": "berkeley-city-college",
  // Rancho Santiago is a district (Santa Ana + Santiago Canyon); map to the
  // larger primary campus (Santa Ana). Santiago Canyon is its own slug too.
  "Rancho Santiago College": "santa-ana-college",
  // West Hills Coalinga / Lemoore are absent from our institutions.json —
  // legitimately unmatched; will appear in the unmatched report.
};

// ---------------------------------------------------------------------------
// HTTP — XSRF flow
// ---------------------------------------------------------------------------

interface Session {
  cookies: string;
  xsrfToken: string;
}

async function startSession(): Promise<Session> {
  const resp = await fetch(`${BASE_URL}/`, {
    headers: { "User-Agent": UA },
    redirect: "follow",
  });
  const setCookies = resp.headers.getSetCookie?.() ?? [];
  const cookieMap = new Map<string, string>();
  for (const sc of setCookies) {
    const [pair] = sc.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) cookieMap.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  const xsrfToken = cookieMap.get("X-XSRF-TOKEN") || "";
  if (!xsrfToken) {
    throw new Error("ASSIST: no X-XSRF-TOKEN cookie returned from homepage");
  }
  const cookies = Array.from(cookieMap.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return { cookies, xsrfToken };
}

async function apiGet<T>(session: Session, path: string): Promise<T> {
  const resp = await fetch(`${BASE_URL}${path}`, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json, text/plain, */*",
      Cookie: session.cookies,
      "X-XSRF-TOKEN": session.xsrfToken,
    },
  });
  if (!resp.ok) {
    throw new Error(`ASSIST ${path}: HTTP ${resp.status}`);
  }
  return resp.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Slug matching — ASSIST institution → our slug
// ---------------------------------------------------------------------------

function matchAssistToOurSlug(
  assistName: string,
  ourSlugs: Set<string>,
): string | null {
  if (NAME_OVERRIDES[assistName]) {
    return ourSlugs.has(NAME_OVERRIDES[assistName]) ? NAME_OVERRIDES[assistName] : null;
  }
  const direct = slugify(assistName);
  if (ourSlugs.has(direct)) return direct;
  // Try "X College" → "x-community-college-district" variants
  const withCC = slugify(`${assistName} Community College District`);
  if (ourSlugs.has(withCC)) return withCC;
  // Substring match — our slug contains the ASSIST slug
  for (const s of Array.from(ourSlugs)) {
    if (s.includes(direct) && direct.length > 4) return s;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const skipImport = process.argv.includes("--no-import");

  console.log("ASSIST.org — California Transfer Equivalencies\n");

  // 1. Session bootstrap
  console.log("Starting session (XSRF flow)…");
  const session = await startSession();
  console.log(`  XSRF token: ${session.xsrfToken.slice(0, 24)}…\n`);

  // 2. Fetch institutions
  console.log("Fetching ASSIST institutions…");
  const allInsts = await apiGet<AssistInstitution[]>(session, "/api/institutions");
  const ccs = allInsts.filter((i) => i.isCommunityCollege);
  console.log(`  ${ccs.length} community colleges available\n`);

  // 3. Load our CA institutions for slug matching
  const ourInsts: { id: string; name: string }[] = JSON.parse(
    fs.readFileSync(INST_FILE, "utf8"),
  );
  const ourSlugs = new Set(ourInsts.map((i) => i.id));

  // 4. Build match map (ASSIST id → our slug)
  const matched: Array<{ assistId: number; assistName: string; ourSlug: string }> = [];
  const unmatched: string[] = [];
  for (const cc of ccs) {
    const assistName = cc.names[0]?.name ?? "";
    const ourSlug = matchAssistToOurSlug(assistName, ourSlugs);
    if (ourSlug) {
      matched.push({ assistId: cc.id, assistName, ourSlug });
    } else {
      unmatched.push(assistName);
    }
  }
  console.log(`Matched ${matched.length}/${ccs.length} ASSIST CCs to our slugs`);
  if (unmatched.length > 0 && unmatched.length <= 20) {
    console.log(`Unmatched ASSIST names: ${unmatched.join(", ")}`);
  } else if (unmatched.length > 20) {
    console.log(`Unmatched: ${unmatched.length} (first 5: ${unmatched.slice(0, 5).join(", ")})`);
  }
  console.log();

  // 5. Fetch UCTCA + CSUTC for each matched CC
  const mappings: TransferMapping[] = [];
  const byCC = new Map<string, number>();
  const errors: string[] = [];

  for (const cc of matched) {
    let total = 0;
    for (const lt of LIST_TYPES) {
      try {
        const url =
          `/api/transferability/courses` +
          `?institutionId=${cc.assistId}` +
          `&academicYearId=${ACADEMIC_YEAR_ID}` +
          `&listType=${lt.code}`;
        const data = await apiGet<AssistTransferabilityResponse>(session, url);
        for (const course of data.courseInformationList ?? []) {
          if (!course.prefixCode || !course.courseNumber) continue;
          const credits = course.maxUnits != null ? String(course.maxUnits) : "";
          mappings.push({
            state: "ca",
            cc_prefix: course.prefixCode,
            cc_number: course.courseNumber,
            cc_course: `${course.prefixCode} ${course.courseNumber}`,
            cc_title: course.courseTitle ?? "",
            cc_credits: credits,
            university: lt.university,
            university_name: lt.universityName,
            univ_course: "TRANSFERABLE",
            univ_title: `${lt.code}-listed transferable course`,
            univ_credits: "",
            notes: `[${cc.ourSlug}] ${lt.code} system-level transferability; check ASSIST.org for major + campus-specific articulation`,
            no_credit: false,
            // Elective because the system-level list does not bind to a specific
            // UC/CSU campus course — it confirms transferability, not equivalency.
            is_elective: true,
          });
          total++;
        }
      } catch (err) {
        errors.push(`${cc.ourSlug}/${lt.code}: ${(err as Error).message}`);
      }
      await sleep(DELAY_MS);
    }
    byCC.set(cc.ourSlug, total);
    console.log(`  ${cc.ourSlug}: ${total} mappings`);
  }

  // 6. Summary
  console.log("\n=== Summary ===");
  console.log(`  Total mappings: ${mappings.length}`);
  console.log(`  Unique CCs: ${byCC.size}`);
  console.log(`  Universities: ${LIST_TYPES.map((l) => l.university).join(", ")}`);
  console.log(`  Errors: ${errors.length}`);
  if (errors.length > 0 && errors.length <= 10) {
    for (const e of errors) console.log(`    ${e}`);
  }

  // 7. Merge with existing data (preserve any non-ASSIST rows)
  let existing: TransferMapping[] = [];
  try {
    existing = JSON.parse(fs.readFileSync(OUT_FILE, "utf-8"));
  } catch {
    // empty or missing
  }
  const assistUnivs = new Set(LIST_TYPES.map((l) => l.university));
  const preserved = existing.filter((m) => !assistUnivs.has(m.university));
  const merged = [...preserved, ...mappings];
  console.log(`  Preserved from other sources: ${preserved.length}`);
  console.log(`  Total merged: ${merged.length}`);

  // 8. Write
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(merged, null, 2) + "\n");
  console.log(`\nSaved ${merged.length} mappings → ${OUT_FILE}`);

  // 9. Supabase import
  if (!skipImport) {
    console.log("\nImporting to Supabase…");
    await importTransfersToSupabase("ca");
    console.log("  Done.");
  } else {
    console.log("\nSkipping Supabase import (--no-import).");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

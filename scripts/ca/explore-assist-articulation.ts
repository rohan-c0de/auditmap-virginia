/**
 * explore-assist-articulation.ts — Phase 1 spike for v2 per-major articulation.
 *
 * Fetches sample ASSIST.org articulation reports for the top 10 CA CCs by
 * enrollment × top 5 receiving universities × top 3 transfer majors. Writes
 * each report as a JSON fixture under scripts/ca/fixtures/articulation/ for
 * use as parser test cases in Phase 2.
 *
 * Discovered endpoint flow (see docs/assist-articulation-schema.md):
 *   GET /                                          → X-XSRF-TOKEN cookie
 *   GET /api/institutions                          → institution IDs
 *   GET /api/agreementCategories?...               → list available report types
 *   GET /api/agreements?...&categoryCode=major     → list of reports w/ keys
 *   GET /api/articulation/Agreements?Key=...       → full articulation report
 *
 * Output:
 *   scripts/ca/fixtures/articulation/{cc-slug}__{uni-slug}__{major-slug}.json
 *   scripts/ca/fixtures/articulation/_index.json   (catalog of fixtures w/ metadata)
 *
 * Usage: npx tsx scripts/ca/explore-assist-articulation.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";

const BASE_URL = "https://assist.org";
const ACADEMIC_YEAR_ID = 76; // 2025-2026
const DELAY_MS = 1000;
const MAX_RETRIES = 4;
const BACKOFF_BASE_MS = 30000; // 30s, 60s, 120s, 240s
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

const FIXTURES_DIR = path.join(
  process.cwd(),
  "scripts",
  "ca",
  "fixtures",
  "articulation",
);

// Top 10 CA CCs by FTE enrollment (CCCCO 2023 data, rounded).
// Names must match ASSIST's `names[0].name` exactly.
const TOP_CCS = [
  "East Los Angeles College",
  "Santa Monica College",
  "Mount San Antonio College",
  "Pasadena City College",
  "De Anza College",
  "Long Beach City College",
  "American River College",
  "Diablo Valley College",
  "Orange Coast College",
  "Fullerton College",
];

// Top 5 receiving universities by CA-CC transfer volume.
const TOP_UNIS = [
  "University of California, Los Angeles",
  "University of California, Berkeley",
  "University of California, San Diego",
  "San Diego State University",
  "California State University, Long Beach",
];

// Top 3 transfer majors by volume (matched against the major `label` field
// via case-insensitive substring; we accept the first match per category).
const TARGET_MAJOR_PATTERNS = [
  /computer science/i,
  /psychology/i,
  /(business|economics)/i,
];

// ---------------------------------------------------------------------------
// HTTP helpers
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
  if (!xsrfToken) throw new Error("No X-XSRF-TOKEN cookie returned");
  const cookies = Array.from(cookieMap.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return { cookies, xsrfToken };
}

async function apiGet<T>(session: Session, p: string, retryCount = 0): Promise<T> {
  const resp = await fetch(`${BASE_URL}${p}`, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json, text/plain, */*",
      Cookie: session.cookies,
      "X-XSRF-TOKEN": session.xsrfToken,
    },
  });

  if (resp.status === 429 && retryCount < MAX_RETRIES) {
    const delayMs = BACKOFF_BASE_MS * Math.pow(2, retryCount);
    console.log(`  [429 rate limit] waiting ${(delayMs / 1000).toFixed(0)}s before retry ${retryCount + 1}/${MAX_RETRIES}`);
    await sleep(delayMs);
    return apiGet<T>(session, p, retryCount + 1);
  }

  if (!resp.ok) throw new Error(`${p}: HTTP ${resp.status}`);
  return resp.json() as Promise<T>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ---------------------------------------------------------------------------
// Types — minimal, just enough to navigate. Phase 2 will refine.
// ---------------------------------------------------------------------------

interface Institution {
  id: number;
  code: string;
  isCommunityCollege: boolean;
  names: Array<{ name: string }>;
}

interface AgreementListEntry {
  label: string;
  key: string;
  ownerInstitutionId: number;
}

interface AgreementListResponse {
  reports: AgreementListEntry[];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface FixtureMeta {
  ccSlug: string;
  ccName: string;
  ccAssistId: number;
  uniSlug: string;
  uniName: string;
  uniAssistId: number;
  majorLabel: string;
  majorPattern: string;
  agreementKey: string;
  filename: string;
  sizeBytes: number;
}

async function main() {
  console.log("ASSIST.org — Phase 1 articulation explorer (with 429 backoff)\n");

  // Parse CLI args: filter to specific CCs if provided
  const filterCcs = process.argv.slice(2);
  const REMAINING_CCS = [
    "Pasadena City College",
    "De Anza College",
    "Long Beach City College",
    "American River College",
    "Diablo Valley College",
    "Orange Coast College",
    "Fullerton College",
  ];

  // 1. Session
  const session = await startSession();
  console.log(`Session OK (XSRF ${session.xsrfToken.slice(0, 16)}…)\n`);

  // 2. Institutions
  const allInsts = await apiGet<Institution[]>(session, "/api/institutions");
  console.log(`Institutions: ${allInsts.length}\n`);

  // 3. Resolve target IDs
  const ccsToProcess = filterCcs.length > 0 ? filterCcs : REMAINING_CCS;
  const ccs = ccsToProcess.map((name) => {
    const inst = allInsts.find((i) => i.names[0]?.name === name);
    if (!inst) throw new Error(`CC not found in ASSIST institutions: ${name}`);
    return { name, id: inst.id, slug: slugify(name) };
  });
  const unis = TOP_UNIS.map((name) => {
    const inst = allInsts.find((i) => i.names[0]?.name === name);
    if (!inst) throw new Error(`Uni not found in ASSIST institutions: ${name}`);
    return { name, id: inst.id, slug: slugify(name) };
  });
  console.log(`Targets: ${ccs.length} CCs × ${unis.length} unis = ${ccs.length * unis.length} pairs`);
  console.log(`Majors per pair: up to ${TARGET_MAJOR_PATTERNS.length}\n`);

  fs.mkdirSync(FIXTURES_DIR, { recursive: true });

  // 4. Load existing index to append
  const indexPath = path.join(FIXTURES_DIR, "_index.json");
  let existingIndex: any = { fixtures: [], skipped: [] };
  if (fs.existsSync(indexPath)) {
    const indexContent = fs.readFileSync(indexPath, "utf-8");
    existingIndex = JSON.parse(indexContent);
    console.log(`Loaded existing index: ${existingIndex.fixtures.length} fixtures, ${existingIndex.skipped.length} skipped\n`);
  }

  // 5. For each (CC, uni) pair: enumerate major agreements, pick up to 3 matching
  //    patterns, fetch the report, write to fixtures.
  const fixtures: FixtureMeta[] = [...existingIndex.fixtures];
  const skipped: string[] = [...existingIndex.skipped];

  for (const cc of ccs) {
    for (const uni of unis) {
      console.log(`  ${cc.slug} → ${uni.slug}`);
      let majors: AgreementListEntry[] = [];
      try {
        const resp = await apiGet<AgreementListResponse>(
          session,
          `/api/agreements?receivingInstitutionId=${uni.id}&sendingInstitutionId=${cc.id}&academicYearId=${ACADEMIC_YEAR_ID}&categoryCode=major`,
        );
        majors = resp.reports ?? [];
      } catch (err: any) {
        skipped.push(`${cc.slug}→${uni.slug}: agreements list error ${err.message}`);
        await sleep(DELAY_MS);
        continue;
      }
      await sleep(DELAY_MS);
      if (majors.length === 0) {
        console.log(`    (no major agreements)`);
        skipped.push(`${cc.slug}→${uni.slug}: no major agreements`);
        continue;
      }
      console.log(`    ${majors.length} major reports available`);

      // For each target pattern, find first matching major (skip dupes by key)
      const pickedKeys = new Set<string>();
      for (const pattern of TARGET_MAJOR_PATTERNS) {
        const match = majors.find(
          (m) => pattern.test(m.label) && !pickedKeys.has(m.key),
        );
        if (!match) continue;
        pickedKeys.add(match.key);

        const filename = `${cc.slug}__${uni.slug}__${slugify(match.label)}.json`;
        const filepath = path.join(FIXTURES_DIR, filename);

        try {
          const report = await apiGet<any>(
            session,
            `/api/articulation/Agreements?Key=${encodeURIComponent(match.key)}`,
          );
          const body = JSON.stringify(report, null, 2);
          fs.writeFileSync(filepath, body);
          fixtures.push({
            ccSlug: cc.slug,
            ccName: cc.name,
            ccAssistId: cc.id,
            uniSlug: uni.slug,
            uniName: uni.name,
            uniAssistId: uni.id,
            majorLabel: match.label,
            majorPattern: pattern.source,
            agreementKey: match.key,
            filename,
            sizeBytes: body.length,
          });
          console.log(`      ✓ ${match.label} (${body.length} bytes) → ${filename}`);
        } catch (err: any) {
          skipped.push(`${cc.slug}→${uni.slug}/${match.label}: ${err.message}`);
        }
        await sleep(DELAY_MS);
      }
    }
  }

  // 6. Write appended index
  fs.writeFileSync(
    indexPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        academicYearId: ACADEMIC_YEAR_ID,
        fixtureCount: fixtures.length,
        totalBytes: fixtures.reduce((s, f) => s + f.sizeBytes, 0),
        fixtures,
        skipped,
      },
      null,
      2,
    ),
  );

  // 7. Summary
  const newFixtures = fixtures.length - existingIndex.fixtures.length;
  console.log(`\n=== Summary ===`);
  console.log(`  New fixtures: ${newFixtures}`);
  console.log(`  Total fixtures (cumulative): ${fixtures.length}`);
  console.log(`  Total size: ${(fixtures.reduce((s, f) => s + f.sizeBytes, 0) / 1024).toFixed(1)} KB`);
  console.log(`  Avg size: ${(fixtures.reduce((s, f) => s + f.sizeBytes, 0) / fixtures.length / 1024).toFixed(1)} KB`);
  console.log(`  Skipped: ${skipped.length}`);
  if (skipped.length > 0 && skipped.length <= 30) {
    for (const s of skipped) console.log(`    ${s}`);
  }
  console.log(`\n  Index: ${indexPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

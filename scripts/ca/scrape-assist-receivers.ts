/**
 * scrape-assist-receivers.ts
 *
 * California per-receiver transfer articulation from ASSIST.org.
 *
 * Complements scrape-transfer-assist.ts (which fetches the system-wide
 * UCTCA/CSUTC transferability lists — "is this CC course transferable to
 * UC/CSU at all"). This script goes deeper:
 *
 *   Phase A (coverage map): for every (CC × receiving institution) pair,
 *     fetch the major-index. Output: data/ca/transfer-coverage.json. Tells
 *     us "Diablo Valley has 168 transfer pathways into UCSD" — useful for
 *     surfacing which receivers a CC actually articulates with, without
 *     committing to a full per-major fetch.
 *
 *   Phase B (detail for top 5 UCs): for UCB / UCLA / UCSD / UCD / UCI ×
 *     every CC × every major, fetch the per-major articulation report
 *     (the ~8KB JSON used by scripts/ca/parse-assist-articulation.ts).
 *     Writes one fixture per major to scripts/ca/fixtures/articulation/.
 *     Resumable: skips files that already exist.
 *
 * Scope rationale: ASSIST exposes ~63 receiving institutions and (per
 * 2025-26) ~80 majors per pair average. Full sweep is ~585K calls / 16+ hr.
 * Top 5 UCs cover the dominant share of CA transfer applications and
 * scope to ~58K calls / 3-4 hr, which fits in one detached run.
 *
 * Endpoints (XSRF-protected; see scrape-transfer-assist.ts:25-30 for flow):
 *   GET /api/institutions
 *   GET /api/agreements?receivingInstitutionId={r}&sendingInstitutionId={s}
 *                      &academicYearId=76&categoryCode=major
 *   GET /api/articulation/Agreements?Key={76/sId/to/rId/Major/<guid>}
 *
 * Usage:
 *   npx tsx scripts/ca/scrape-assist-receivers.ts                  # phase A + B
 *   npx tsx scripts/ca/scrape-assist-receivers.ts --phase=a        # coverage only
 *   npx tsx scripts/ca/scrape-assist-receivers.ts --phase=b        # detail only
 *   npx tsx scripts/ca/scrape-assist-receivers.ts --cc=de-anza-college  # one CC (smoke test)
 *   npx tsx scripts/ca/scrape-assist-receivers.ts --concurrency=4
 *   npx tsx scripts/ca/scrape-assist-receivers.ts --delay=150       # ms between calls per worker
 */

import * as fs from "node:fs";
import * as path from "node:path";

interface AssistInstitution {
  id: number;
  code: string;
  isCommunityCollege: boolean;
  names: Array<{ name: string; hideInList?: boolean }>;
}

interface AssistAgreementReport {
  label: string;
  key: string;
  ownerInstitutionId: number;
}

interface AssistAgreementsResponse {
  reports?: AssistAgreementReport[];
}

interface OurInstitution {
  id: string;
  name: string;
}

interface CoverageEntry {
  ccSlug: string;
  ccAssistId: number;
  receiverCode: string;
  receiverName: string;
  receiverCategory: "UC" | "CSU" | "Independent";
  receiverSlug: string;
  majorCount: number;
  majors: Array<{ label: string; key: string }>;
}

interface CoverageOutput {
  generatedAt: string;
  academicYearId: number;
  pairsAttempted: number;
  pairsSucceeded: number;
  totalMajors: number;
  entries: CoverageEntry[];
}

const BASE_URL = "https://assist.org";
const ACADEMIC_YEAR_ID = 76; // 2025-2026
const DATA_DIR = path.join(process.cwd(), "data", "ca");
const INST_FILE = path.join(DATA_DIR, "institutions.json");
const COVERAGE_FILE = path.join(DATA_DIR, "transfer-coverage.json");
// FIXTURES_DIR can be overridden via env var so a detached long-running
// Phase B can write to a stable absolute path (e.g. /tmp/...) that survives
// session-level worktree cleanup. Defaults to the in-repo location.
const FIXTURES_DIR = process.env.ASSIST_FIXTURES_DIR ?? path.join(
  process.cwd(),
  "scripts",
  "ca",
  "fixtures",
  "articulation",
);
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

// Top 5 UCs by transfer-applicant volume (UC Office of the President data).
// Phase B fetches per-major articulation detail only for these.
const TOP_RECEIVERS = new Set(["UCB", "UCLA", "UCSD", "UCD", "UCI"]);

// CC name overrides — copied from scrape-transfer-assist.ts:118-135. Kept
// inline (not factored to a shared module) because the source script is
// itself <350 lines and the overrides are small + diverge rarely.
const NAME_OVERRIDES: Record<string, string> = {
  "Mt. San Antonio College": "mt-san-antonio-college",
  "Mount San Antonio College": "mt-san-antonio-college",
  "Mt. San Jacinto College": "mt-san-jacinto-community-college-district",
  "El Camino College": "el-camino-community-college-district",
  "Antelope Valley College": "antelope-valley-community-college-district",
  "Feather River College": "feather-river-community-college-district",
  "Copper Mountain College": "copper-mountain-community-college",
  "Compton Community College": "compton-college",
  "Kings River College": "reedley-college",
  "Vista Community College": "berkeley-city-college",
  "Rancho Santiago College": "santa-ana-college",
};

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const m = args.find((a) => a.startsWith(`--${name}=`));
  return m ? m.split("=").slice(1).join("=") : undefined;
}
const PHASE = (flag("phase") ?? "all").toLowerCase(); // a | b | all
const CC_FILTER = flag("cc"); // restrict to one CC slug for smoke-testing
const CONCURRENCY = Math.max(1, parseInt(flag("concurrency") ?? "3", 10));
const DELAY_MS = Math.max(0, parseInt(flag("delay") ?? "200", 10));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function matchAssistToOurSlug(
  assistName: string,
  ourSlugs: Set<string>,
): string | null {
  if (NAME_OVERRIDES[assistName]) {
    return ourSlugs.has(NAME_OVERRIDES[assistName])
      ? NAME_OVERRIDES[assistName]
      : null;
  }
  const direct = slugify(assistName);
  if (ourSlugs.has(direct)) return direct;
  const withCC = slugify(`${assistName} Community College District`);
  if (ourSlugs.has(withCC)) return withCC;
  for (const s of Array.from(ourSlugs)) {
    if (s.includes(direct) && direct.length > 4) return s;
  }
  return null;
}

function receiverCategory(code: string): "UC" | "CSU" | "Independent" {
  const c = code.trim().toUpperCase();
  if (c.startsWith("UC") || c === "UCB" || c === "UCLA") return "UC";
  if (
    c.startsWith("CSU") ||
    c === "SDSU" ||
    c === "SJSU" ||
    c === "SFSU" ||
    c === "SSU" ||
    c === "HSU" ||
    c === "CPSLO" ||
    c === "CPP"
  ) {
    return "CSU";
  }
  return "Independent";
}

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
    throw new Error("ASSIST: no X-XSRF-TOKEN cookie returned");
  }
  const cookies = Array.from(cookieMap.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return { cookies, xsrfToken };
}

async function apiGet<T>(session: Session, p: string): Promise<T> {
  const resp = await fetch(`${BASE_URL}${p}`, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json, text/plain, */*",
      Cookie: session.cookies,
      "X-XSRF-TOKEN": session.xsrfToken,
    },
  });
  if (!resp.ok) {
    throw new Error(`ASSIST ${p}: HTTP ${resp.status}`);
  }
  return resp.json() as Promise<T>;
}

async function apiGetText(session: Session, p: string): Promise<string> {
  const resp = await fetch(`${BASE_URL}${p}`, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json, text/plain, */*",
      Cookie: session.cookies,
      "X-XSRF-TOKEN": session.xsrfToken,
    },
  });
  if (!resp.ok) {
    throw new Error(`ASSIST ${p}: HTTP ${resp.status}`);
  }
  return resp.text();
}

// ---------------------------------------------------------------------------
// Phase A — coverage map
// ---------------------------------------------------------------------------

interface PhaseAResult {
  entries: CoverageEntry[];
  errors: string[];
}

async function phaseA(
  session: Session,
  ccs: Array<{ assistId: number; assistName: string; ourSlug: string }>,
  receivers: AssistInstitution[],
): Promise<PhaseAResult> {
  const pairs: Array<{
    cc: (typeof ccs)[number];
    receiver: AssistInstitution;
  }> = [];
  for (const cc of ccs) for (const r of receivers) pairs.push({ cc, receiver: r });

  console.log(
    `Phase A: ${pairs.length} pairs (${ccs.length} CCs × ${receivers.length} receivers)`,
  );

  const entries: CoverageEntry[] = [];
  const errors: string[] = [];
  let done = 0;
  const t0 = Date.now();

  // Simple worker-pool: split pairs across CONCURRENCY tasks
  const queue = pairs.slice();
  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      const url =
        `/api/agreements?receivingInstitutionId=${item.receiver.id}` +
        `&sendingInstitutionId=${item.cc.assistId}` +
        `&academicYearId=${ACADEMIC_YEAR_ID}&categoryCode=major`;
      try {
        const data = await apiGet<AssistAgreementsResponse>(session, url);
        const reports = data.reports ?? [];
        const recvName = item.receiver.names[0]?.name ?? item.receiver.code.trim();
        entries.push({
          ccSlug: item.cc.ourSlug,
          ccAssistId: item.cc.assistId,
          receiverCode: item.receiver.code.trim(),
          receiverName: recvName,
          receiverCategory: receiverCategory(item.receiver.code),
          receiverSlug: slugify(recvName),
          majorCount: reports.length,
          majors: reports.map((r) => ({ label: r.label, key: r.key })),
        });
      } catch (err: any) {
        errors.push(
          `${item.cc.ourSlug}/${item.receiver.code.trim()}: ${err.message}`,
        );
      }
      done++;
      if (done % 100 === 0) {
        const elapsed = (Date.now() - t0) / 1000;
        const rate = done / elapsed;
        const eta = (pairs.length - done) / rate;
        console.log(
          `  [A] ${done}/${pairs.length} (${rate.toFixed(1)}/s, ETA ${Math.round(eta / 60)}m)`,
        );
      }
      await sleep(DELAY_MS);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  return { entries, errors };
}

// ---------------------------------------------------------------------------
// Phase B — per-major detail for top 5 UCs
// ---------------------------------------------------------------------------

interface PhaseBResult {
  fetched: number;
  skipped: number;
  errors: string[];
}

// NOTE on rate-limiting (2026-05-28): the /api/articulation/Agreements?Key=…
// endpoint is rate-limited aggressively (allows ~50 calls then returns HTTP 429
// with NO Retry-After header; subsequent retries within 5s also 429). The
// /api/agreements index endpoint used in Phase A is NOT subject to the same
// limit. Until 429-handling + session rotation is implemented, treat Phase B
// as experimental — see issue tracker. Phase A's coverage map is the shippable
// deliverable from this script.
async function phaseB(
  session: Session,
  coverage: CoverageEntry[],
): Promise<PhaseBResult> {
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });

  // Filter to top-5 UC receivers only
  const targets = coverage.filter((e) =>
    TOP_RECEIVERS.has(e.receiverCode.toUpperCase()),
  );
  const totalMajors = targets.reduce((s, e) => s + e.majorCount, 0);
  console.log(
    `Phase B: ${targets.length} (CC×receiver) pairs, ${totalMajors} major reports`,
  );

  const queue: Array<{
    entry: CoverageEntry;
    major: { label: string; key: string };
  }> = [];
  for (const e of targets) {
    for (const m of e.majors) queue.push({ entry: e, major: m });
  }

  let fetched = 0;
  let skipped = 0;
  const errors: string[] = [];
  const t0 = Date.now();
  let processed = 0;

  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      const ccSlug = item.entry.ccSlug;
      const uniSlug = item.entry.receiverSlug;
      const majorSlug = slugify(item.major.label);
      const filename = `${ccSlug}__${uniSlug}__${majorSlug}.json`;
      const out = path.join(FIXTURES_DIR, filename);

      if (fs.existsSync(out)) {
        skipped++;
        processed++;
        continue;
      }

      try {
        const text = await apiGetText(
          session,
          `/api/articulation/Agreements?Key=${encodeURIComponent(item.major.key)}`,
        );
        fs.writeFileSync(out, text);
        fetched++;
      } catch (err: any) {
        errors.push(`${filename}: ${err.message}`);
      }
      processed++;
      if (processed % 250 === 0) {
        const elapsed = (Date.now() - t0) / 1000;
        const rate = processed / elapsed;
        console.log(
          `  [B] ${processed} processed (${fetched} fetched, ${skipped} skipped, ${rate.toFixed(1)}/s, ${queue.length} remaining)`,
        );
      }
      await sleep(DELAY_MS);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { fetched, skipped, errors };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("ASSIST.org — Per-Receiver Articulation Scraper");
  console.log(`  phase=${PHASE} concurrency=${CONCURRENCY} delay=${DELAY_MS}ms`);
  if (CC_FILTER) console.log(`  cc filter: ${CC_FILTER}`);
  console.log();

  const session = await startSession();
  console.log(`Session: XSRF=${session.xsrfToken.slice(0, 16)}…\n`);

  const allInsts = await apiGet<AssistInstitution[]>(session, "/api/institutions");
  const ccsRaw = allInsts.filter((i) => i.isCommunityCollege);
  const receivers = allInsts.filter((i) => !i.isCommunityCollege);
  console.log(
    `Institutions: ${ccsRaw.length} CCs, ${receivers.length} receivers\n`,
  );

  const ourInsts: OurInstitution[] = JSON.parse(
    fs.readFileSync(INST_FILE, "utf8"),
  );
  const ourSlugs = new Set(ourInsts.map((i) => i.id));

  const matched: Array<{
    assistId: number;
    assistName: string;
    ourSlug: string;
  }> = [];
  const unmatched: string[] = [];
  for (const cc of ccsRaw) {
    const assistName = cc.names[0]?.name ?? "";
    const ourSlug = matchAssistToOurSlug(assistName, ourSlugs);
    if (ourSlug) matched.push({ assistId: cc.id, assistName, ourSlug });
    else unmatched.push(assistName);
  }
  console.log(
    `Matched ${matched.length}/${ccsRaw.length} CCs to our slugs (${unmatched.length} unmatched)`,
  );

  const ccs = CC_FILTER
    ? matched.filter((m) => m.ourSlug === CC_FILTER)
    : matched;
  if (CC_FILTER && ccs.length === 0) {
    console.error(`No CC matched filter --cc=${CC_FILTER}`);
    process.exit(1);
  }
  console.log(`Will scrape ${ccs.length} CC(s)\n`);

  // -------- Phase A --------
  let coverage: CoverageEntry[] = [];
  if (PHASE === "a" || PHASE === "all") {
    const result = await phaseA(session, ccs, receivers);
    coverage = result.entries;
    const output: CoverageOutput = {
      generatedAt: new Date().toISOString(),
      academicYearId: ACADEMIC_YEAR_ID,
      pairsAttempted: ccs.length * receivers.length,
      pairsSucceeded: result.entries.length,
      totalMajors: result.entries.reduce((s, e) => s + e.majorCount, 0),
      entries: result.entries.sort((a, b) =>
        a.ccSlug === b.ccSlug
          ? a.receiverCode.localeCompare(b.receiverCode)
          : a.ccSlug.localeCompare(b.ccSlug),
      ),
    };
    fs.mkdirSync(path.dirname(COVERAGE_FILE), { recursive: true });
    fs.writeFileSync(COVERAGE_FILE, JSON.stringify(output, null, 2) + "\n");
    console.log(`\nPhase A complete:`);
    console.log(`  pairs: ${output.pairsSucceeded}/${output.pairsAttempted}`);
    console.log(`  total major reports: ${output.totalMajors}`);
    console.log(`  errors: ${result.errors.length}`);
    console.log(`  → ${COVERAGE_FILE}\n`);
  } else {
    // Phase B without A: load existing coverage
    if (!fs.existsSync(COVERAGE_FILE)) {
      console.error(
        `Phase B requires ${COVERAGE_FILE} — run phase=a first or phase=all`,
      );
      process.exit(1);
    }
    const loaded: CoverageOutput = JSON.parse(
      fs.readFileSync(COVERAGE_FILE, "utf8"),
    );
    coverage = loaded.entries;
    if (CC_FILTER) coverage = coverage.filter((e) => e.ccSlug === CC_FILTER);
    console.log(`Loaded coverage: ${coverage.length} entries\n`);
  }

  // -------- Phase B --------
  if (PHASE === "b" || PHASE === "all") {
    const result = await phaseB(session, coverage);
    console.log(`\nPhase B complete:`);
    console.log(`  fetched: ${result.fetched}`);
    console.log(`  skipped (already on disk): ${result.skipped}`);
    console.log(`  errors: ${result.errors.length}`);
    if (result.errors.length > 0 && result.errors.length <= 20) {
      for (const e of result.errors) console.log(`    ${e}`);
    }
  }

  console.log(
    `\nDone. Next: regenerate fixture index, then run scripts/import-assist-articulation.ts`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

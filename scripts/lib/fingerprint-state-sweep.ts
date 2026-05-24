/**
 * fingerprint-state-sweep.ts
 *
 * Iterates the states NOT currently shipping data, discovers their public
 * 2-year + 4-year-with-CC-mission colleges via IPEDS, and fingerprints each
 * to identify the SIS platform. Writes aggregated per-state and per-platform
 * counts to tmp/sweep-results.json.
 *
 * Decision input for issue #289 — which scraper template (PeopleSoft /
 * Jenzabar / etc.) to build next, based on real distribution rather than
 * speculation.
 *
 * Read-only: no course data scraped, no files committed beyond the JSON
 * output in tmp/.
 *
 * Usage:
 *   npx tsx scripts/lib/fingerprint-state-sweep.ts
 *   npx tsx scripts/lib/fingerprint-state-sweep.ts --states oh,tx,ca
 *   npx tsx scripts/lib/fingerprint-state-sweep.ts --concurrency 4
 *   npx tsx scripts/lib/fingerprint-state-sweep.ts --resume
 */

import fs from "fs";
import path from "path";
import { discoverPublicCommunityColleges } from "./discover-colleges.js";
import { fingerprint, type Platform } from "./fingerprint-college.js";

// Default sweep targets: 30 states explicitly listed in issue #289 plus the
// three currently-in-flight partial states (ky/al/wv) for completeness. ms
// is in both lists; dedupe.
const DEFAULT_STATES = [
  "ak", "al", "ar", "az", "ca", "co", "hi", "ia", "id", "il", "in", "ks",
  "ky", "la", "mi", "mn", "mo", "ms", "mt", "nd", "ne", "nm", "nv", "oh",
  "ok", "or", "sd", "tx", "ut", "wa", "wi", "wv", "wy",
];

const COLLEGE_CONCURRENCY = 8;
const OUT_FILE = path.join(process.cwd(), "tmp", "sweep-results.json");

interface CollegeRecord {
  slug: string;
  name: string;
  primaryUrl: string;
  platform: Platform;
  confidence: "high" | "medium" | "low";
  courseSearchUrl: string | null;
  authGated: boolean;
  evidence: string[];
}

interface StateResult {
  totalColleges: number;
  platforms: Partial<Record<Platform, number>>;
  byCollege: CollegeRecord[];
  errors: Array<{ slug: string; message: string }>;
}

interface SweepOutput {
  generatedAt: string;
  perState: Record<string, StateResult>;
  totals: {
    byPlatform: Partial<Record<Platform, number>>;
    templateCovered: number;
    untemplated: number;
    authGated: number;
    custom: number;
    unknown: number;
  };
}

const TEMPLATED: Platform[] = ["banner-ssb-9", "banner-8", "colleague"];

async function pmap<T, U>(
  items: T[],
  fn: (item: T, idx: number) => Promise<U>,
  concurrency: number
): Promise<U[]> {
  const out: U[] = new Array(items.length);
  let next = 0;
  const workers: Promise<void>[] = [];
  for (let w = 0; w < Math.min(concurrency, items.length); w++) {
    workers.push(
      (async () => {
        while (true) {
          const i = next++;
          if (i >= items.length) return;
          out[i] = await fn(items[i], i);
        }
      })()
    );
  }
  await Promise.all(workers);
  return out;
}

function parseArgs(argv: string[]): {
  states: string[];
  concurrency: number;
  resume: boolean;
} {
  let states = DEFAULT_STATES;
  let concurrency = COLLEGE_CONCURRENCY;
  let resume = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--states") {
      states = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    } else if (a === "--concurrency") {
      concurrency = Number(argv[++i]);
    } else if (a === "--resume") {
      resume = true;
    }
  }
  return { states, concurrency, resume };
}

function loadExisting(): SweepOutput | null {
  try {
    const raw = fs.readFileSync(OUT_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeOutput(data: SweepOutput): void {
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(data, null, 2));
}

function recomputeTotals(perState: Record<string, StateResult>): SweepOutput["totals"] {
  const byPlatform: Partial<Record<Platform, number>> = {};
  for (const s of Object.values(perState)) {
    for (const [p, n] of Object.entries(s.platforms) as [Platform, number][]) {
      byPlatform[p] = (byPlatform[p] ?? 0) + n;
    }
  }
  const get = (p: Platform) => byPlatform[p] ?? 0;
  const templateCovered = TEMPLATED.reduce((acc, p) => acc + get(p), 0);
  const knownPlatforms = new Set<Platform>([
    ...TEMPLATED,
    "auth-gated",
    "custom",
    "unknown",
  ]);
  let untemplated = 0;
  for (const [p, n] of Object.entries(byPlatform) as [Platform, number][]) {
    if (!knownPlatforms.has(p)) untemplated += n;
  }
  return {
    byPlatform,
    templateCovered,
    untemplated,
    authGated: get("auth-gated"),
    custom: get("custom"),
    unknown: get("unknown"),
  };
}

async function sweepState(state: string, concurrency: number): Promise<StateResult> {
  const colleges = await discoverPublicCommunityColleges(state);
  const records: CollegeRecord[] = [];
  const errors: Array<{ slug: string; message: string }> = [];

  await pmap(
    colleges,
    async (c) => {
      if (!c.primaryUrl) {
        errors.push({ slug: c.slug, message: "no primary URL" });
        return;
      }
      try {
        const r = await fingerprint(`https://${c.primaryUrl}`, { stateHint: state });
        records.push({
          slug: c.slug,
          name: c.name,
          primaryUrl: c.primaryUrl,
          platform: r.platform,
          confidence: r.confidence,
          courseSearchUrl: r.courseSearchUrl,
          authGated: r.authGated,
          evidence: r.evidence.slice(0, 3),
        });
      } catch (err) {
        errors.push({
          slug: c.slug,
          message: (err as Error).message ?? String(err),
        });
      }
    },
    concurrency
  );

  const platforms: Partial<Record<Platform, number>> = {};
  for (const r of records) {
    platforms[r.platform] = (platforms[r.platform] ?? 0) + 1;
  }
  records.sort((a, b) => a.slug.localeCompare(b.slug));
  return { totalColleges: records.length, platforms, byCollege: records, errors };
}

function printSummary(out: SweepOutput): void {
  const lines: string[] = [];
  lines.push(`# Fingerprint sweep — ${out.generatedAt}`);
  lines.push("");
  lines.push("## Totals across swept states");
  lines.push("");
  lines.push("| Platform | Colleges |");
  lines.push("|---|---:|");
  const sorted = Object.entries(out.totals.byPlatform).sort(
    (a, b) => (b[1] as number) - (a[1] as number)
  );
  for (const [p, n] of sorted) {
    lines.push(`| ${p} | ${n} |`);
  }
  lines.push("");
  lines.push(`- **Template-covered (banner-ssb-9 + banner-8 + colleague):** ${out.totals.templateCovered}`);
  lines.push(`- **Untemplated (peoplesoft / jenzabar / coursedog / workday / etc.):** ${out.totals.untemplated}`);
  lines.push(`- **Auth-gated:** ${out.totals.authGated}`);
  lines.push(`- **Custom HTML:** ${out.totals.custom}`);
  lines.push(`- **Unknown / unreachable:** ${out.totals.unknown}`);
  lines.push("");
  lines.push("## Per-state breakdown");
  lines.push("");
  lines.push("| State | Colleges | Top platforms |");
  lines.push("|---|---:|---|");
  const states = Object.keys(out.perState).sort();
  for (const s of states) {
    const sr = out.perState[s];
    const top = (Object.entries(sr.platforms) as [string, number][])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([p, n]) => `${p}=${n}`)
      .join(", ");
    lines.push(`| ${s} | ${sr.totalColleges} | ${top} |`);
  }
  console.log(lines.join("\n"));
}

async function main() {
  const { states, concurrency, resume } = parseArgs(process.argv.slice(2));

  const existing = resume ? loadExisting() : null;
  const perState: Record<string, StateResult> = existing?.perState ?? {};

  console.error(
    `Fingerprint sweep: ${states.length} states, concurrency=${concurrency}${
      resume ? `, resuming with ${Object.keys(perState).length} states already done` : ""
    }`
  );

  for (const state of states) {
    if (resume && perState[state]) {
      console.error(`[${state}] skip (already in tmp/sweep-results.json)`);
      continue;
    }
    const t0 = Date.now();
    try {
      const sr = await sweepState(state, concurrency);
      perState[state] = sr;
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      const summary = (Object.entries(sr.platforms) as [string, number][])
        .sort((a, b) => b[1] - a[1])
        .map(([p, n]) => `${p}=${n}`)
        .join(" ");
      console.error(`[${state}] ${sr.totalColleges} colleges in ${dt}s — ${summary}`);
    } catch (err) {
      console.error(`[${state}] FAILED: ${(err as Error).message}`);
      perState[state] = {
        totalColleges: 0,
        platforms: {},
        byCollege: [],
        errors: [{ slug: "*state*", message: (err as Error).message }],
      };
    }
    // Persist after every state so a long sweep is resumable.
    writeOutput({
      generatedAt: new Date().toISOString(),
      perState,
      totals: recomputeTotals(perState),
    });
  }

  const final: SweepOutput = {
    generatedAt: new Date().toISOString(),
    perState,
    totals: recomputeTotals(perState),
  };
  writeOutput(final);
  printSummary(final);
}

const isMain =
  import.meta.url.startsWith("file:") &&
  process.argv[1] &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}

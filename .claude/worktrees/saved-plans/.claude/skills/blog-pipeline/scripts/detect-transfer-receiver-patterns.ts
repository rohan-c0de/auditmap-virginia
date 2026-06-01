#!/usr/bin/env tsx
/**
 * Trigger I — transfer-receiver patterns (data-driven).
 *
 * Mines `data/{state}/transfer-equiv.json` for each covered state and
 * emits a candidate when the state has enough qualifying in-state
 * receiver universities to support a "[state] transfer receivers
 * compared" spoke article. The spoke pattern is per-state, not
 * per-(state × university) — one article that compares the major
 * receivers within a state side by side, anchored by direct-match %,
 * elective %, and no-credit % per receiver.
 *
 * Threshold logic: a state qualifies when
 *   - ≥ 3 universities have ≥ 200 individual course-transfer mappings
 *     each (the data-sufficiency floor — fewer than 200 mappings is
 *     too small to draw conclusions from)
 *   - aggregate mapping count across qualifying receivers ≥ 1,000
 *
 * Slice file (.blog-pipeline/slices/transfer-receivers/<state>.json)
 * contains the per-receiver stats the drafter must cite — no LLM
 * speculation about transfer outcomes.
 *
 * Spoke ranking: prioritize states where receiver variance is high
 * (gives the article a story) over states where every receiver looks
 * the same. Florida (all 100% direct match) is technically interesting
 * but the article has nothing to compare. Georgia (UGA 9.8% vs UWG 7.0%
 * vs different patterns across receivers) makes a stronger spoke.
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { articles } from "../../../../content/blog/index";
import { getAllStates } from "../../../../lib/states/registry";

const REPO_ROOT = resolve(__dirname, "../../../..");
const DISABLED = resolve(REPO_ROOT, ".blog-pipeline/DISABLED");
const CLUSTER = "transfer-receiver-patterns-guide";
const SLICE_OUT_DIR = resolve(REPO_ROOT, ".blog-pipeline/slices/transfer-receivers");

// Per-receiver data-sufficiency floor — universities with fewer than
// this many course-mapping entries don't have enough data to compare
// meaningfully against peers.
const MIN_MAPPINGS_PER_RECEIVER = 200;
// Per-state coverage floor — drop states whose qualifying receivers
// together don't add up to enough mapping volume to be authoritative.
const MIN_AGG_MAPPINGS = 1000;
// Need at least this many qualifying receivers in a state for the
// "compare receivers within state" spoke pattern to have material.
const MIN_QUALIFYING_RECEIVERS = 3;

type TransferMapping = {
  university?: string;
  university_name?: string;
  is_elective?: boolean;
  no_credit?: boolean;
  // (other fields ignored — only the classification matters here)
};

type ReceiverStats = {
  universitySlug: string;
  universityName: string;
  totalMappings: number;
  directCount: number;
  electiveCount: number;
  noCreditCount: number;
  directPct: number;
  electivePct: number;
  noCreditPct: number;
};

type StateStats = {
  state: string;
  qualifyingReceivers: ReceiverStats[];
  aggregateMappings: number;
  /** Highest direct% minus lowest direct% — proxy for "story richness". */
  directPctRange: number;
  /** Toughest receiver (lowest direct%) in the state. */
  toughest: ReceiverStats;
  /** Most-generous receiver (highest direct%) in the state. */
  mostGenerous: ReceiverStats;
};

type Candidate = {
  triggerSource: "transfer-receiver-patterns";
  topic: string;
  targetReader: string;
  searchIntentHypothesis: string;
  articleType: "state-spoke";
  state: string;
  cluster: string;
  nonDuplicateRationale: string;
  dataSlicePaths: string[];
  rankScore: number;
};

function readMappings(stateSlug: string): TransferMapping[] | null {
  const path = resolve(REPO_ROOT, `data/${stateSlug}/transfer-equiv.json`);
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    if (!Array.isArray(data)) return null;
    return data as TransferMapping[];
  } catch {
    return null;
  }
}

function aggregateByReceiver(
  mappings: TransferMapping[]
): Map<string, ReceiverStats> {
  // Key is the receiver's university slug (stable). Name is preserved
  // separately for display because some universities have multiple
  // name spellings in the data over time.
  const grouped = new Map<string, ReceiverStats>();

  for (const m of mappings) {
    const slug = (m.university ?? "").trim();
    const name = (m.university_name ?? "").trim();
    if (!slug || !name) continue;

    let entry = grouped.get(slug);
    if (!entry) {
      entry = {
        universitySlug: slug,
        universityName: name,
        totalMappings: 0,
        directCount: 0,
        electiveCount: 0,
        noCreditCount: 0,
        directPct: 0,
        electivePct: 0,
        noCreditPct: 0,
      };
      grouped.set(slug, entry);
    }
    entry.totalMappings += 1;
    if (m.no_credit) entry.noCreditCount += 1;
    else if (m.is_elective) entry.electiveCount += 1;
    else entry.directCount += 1;
  }

  // Compute percentages once aggregation is complete
  for (const r of grouped.values()) {
    if (r.totalMappings === 0) continue;
    r.directPct = (r.directCount / r.totalMappings) * 100;
    r.electivePct = (r.electiveCount / r.totalMappings) * 100;
    r.noCreditPct = (r.noCreditCount / r.totalMappings) * 100;
  }

  return grouped;
}

function computeStats(stateSlug: string): StateStats | null {
  const mappings = readMappings(stateSlug);
  if (!mappings || mappings.length === 0) return null;

  const grouped = aggregateByReceiver(mappings);

  // Filter to receivers that meet the data-sufficiency floor
  const qualifying: ReceiverStats[] = [];
  for (const r of grouped.values()) {
    if (r.totalMappings >= MIN_MAPPINGS_PER_RECEIVER) qualifying.push(r);
  }
  if (qualifying.length < MIN_QUALIFYING_RECEIVERS) return null;

  qualifying.sort((a, b) => b.totalMappings - a.totalMappings);

  const aggregateMappings = qualifying.reduce(
    (sum, r) => sum + r.totalMappings,
    0
  );
  if (aggregateMappings < MIN_AGG_MAPPINGS) return null;

  // Story-richness metric: spread of direct% across qualifying receivers
  const directPcts = qualifying.map((r) => r.directPct);
  const directPctRange =
    Math.max(...directPcts) - Math.min(...directPcts);

  const toughest = qualifying.reduce((a, b) =>
    a.directPct < b.directPct ? a : b
  );
  const mostGenerous = qualifying.reduce((a, b) =>
    a.directPct > b.directPct ? a : b
  );

  return {
    state: stateSlug,
    qualifyingReceivers: qualifying,
    aggregateMappings,
    directPctRange,
    toughest,
    mostGenerous,
  };
}

function detect(): Candidate[] {
  const states = getAllStates();
  const candidates: Candidate[] = [];

  // Already-covered states (existing spokes in this cluster)
  const existingSpokes = articles.filter(
    (a) => a.cluster === CLUSTER && a.clusterRole === "spoke"
  );
  const coveredStates = new Set(
    existingSpokes
      .map((s) => s.state)
      .filter((s): s is string => s !== null)
  );

  mkdirSync(SLICE_OUT_DIR, { recursive: true });

  for (const s of states) {
    if (coveredStates.has(s.slug)) continue;
    const stats = computeStats(s.slug);
    if (!stats) continue;

    const slicePath = resolve(SLICE_OUT_DIR, `${s.slug}.json`);
    writeFileSync(slicePath, JSON.stringify(stats, null, 2));

    candidates.push({
      triggerSource: "transfer-receiver-patterns",
      topic: `${s.name} transfer receivers compared: which in-state universities accept the most community college credits as direct matches`,
      targetReader: `${s.name} community college student deciding among in-state public universities to transfer to, who hasn't realized that the receivers vary dramatically in how they classify community college credits`,
      searchIntentHypothesis: `User searching "${s.name.toLowerCase()} community college transfer" or "best transfer university ${s.name.toLowerCase()}" wants to know which receiving universities will accept their credits cleanly and which will force them to retake courses`,
      articleType: "state-spoke",
      state: s.slug,
      cluster: CLUSTER,
      nonDuplicateRationale: `Cluster "${CLUSTER}" has ${existingSpokes.length} spoke(s), none for ${s.name}. Detector confirmed ${stats.qualifyingReceivers.length} qualifying receivers (≥${MIN_MAPPINGS_PER_RECEIVER} mappings each) across ${stats.aggregateMappings} total mappings. Direct-match % range: ${stats.toughest.directPct.toFixed(1)}% (${stats.toughest.universityName}) to ${stats.mostGenerous.directPct.toFixed(1)}% (${stats.mostGenerous.universityName}).`,
      dataSlicePaths: [
        `data/${s.slug}/transfer-equiv.json`,
        `lib/states/${s.slug}/config.ts`,
        `.blog-pipeline/slices/transfer-receivers/${s.slug}.json`,
      ],
      // Rank score: prioritize states with high direct% spread (good story)
      // and high data volume (authoritative). Range counts more than
      // volume to surface stories like Georgia over Maryland.
      rankScore:
        stats.directPctRange * 10 + Math.log10(stats.aggregateMappings) * 20,
    });
  }

  candidates.sort((a, b) => b.rankScore - a.rankScore);
  return candidates;
}

function main() {
  if (existsSync(DISABLED)) {
    process.stdout.write(JSON.stringify({ candidates: [], disabled: true }));
    process.exit(0);
  }
  try {
    const candidates = detect();
    process.stderr.write(
      `[detect-transfer-receiver-patterns] found ${candidates.length} candidate(s)\n`
    );
    process.stdout.write(JSON.stringify({ candidates }, null, 2));
    process.exit(0);
  } catch (err) {
    process.stderr.write(
      `[detect-transfer-receiver-patterns] error: ${String(err)}\n`
    );
    process.stdout.write(
      JSON.stringify({ candidates: [], error: String(err) })
    );
    process.exit(1);
  }
}

main();

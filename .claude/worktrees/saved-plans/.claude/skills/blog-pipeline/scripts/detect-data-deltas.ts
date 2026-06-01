#!/usr/bin/env tsx
/**
 * Trigger A — site data deltas.
 * Diffs current registry/data state against the last committed snapshot.
 * See ../references/triggers.md §"Trigger A"
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAllStates, getStateConfig } from "../../../../lib/states/registry";

const REPO_ROOT = resolve(__dirname, "../../../..");
const DISABLED = resolve(REPO_ROOT, ".blog-pipeline/DISABLED");
const SNAPSHOT_PATH = resolve(REPO_ROOT, ".blog-pipeline/snapshot.json");

type Snapshot = {
  version: 1;
  states: string[];
  transferPairs: Record<string, string[]>;
  seniorWaivers: Record<string, unknown>;
  institutions: Record<string, string[]>;
};

type Candidate = {
  triggerSource: "data-delta";
  deltaType:
    | "new-state"
    | "new-transfer-pair"
    | "senior-waiver-change"
    | "new-institution";
  topic: string;
  targetReader: string;
  searchIntentHypothesis: string;
  articleType: "state-spoke" | "general";
  state: string | null;
  cluster: string | null;
  nonDuplicateRationale: string;
  dataSlicePaths: string[];
};

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

function transferPairsForState(stateSlug: string): string[] {
  const path = resolve(REPO_ROOT, `data/${stateSlug}/transfer-equiv.json`);
  const data = readJson<Array<Record<string, string>>>(path) ?? [];
  return Array.from(
    new Set(
      data
        .map((e) => {
          const sender = e.sendingCollege ?? e.sending;
          const receiver = e.receivingUniversity ?? e.receiving;
          return sender && receiver ? `${sender}->${receiver}` : null;
        })
        .filter((p): p is string => p !== null)
    )
  ).sort();
}

function institutionsForState(stateSlug: string): string[] {
  const path = resolve(REPO_ROOT, `data/${stateSlug}/institutions.json`);
  const data = readJson<Array<{ slug: string }>>(path) ?? [];
  return Array.from(new Set(data.map((i) => i.slug))).sort();
}

function detect(): Candidate[] {
  const snap = readJson<Snapshot>(SNAPSHOT_PATH);
  const candidates: Candidate[] = [];

  if (!snap) {
    process.stderr.write(
      `[detect-data-deltas] no snapshot at ${SNAPSHOT_PATH}; bootstrap with snapshot-state.ts before running detection\n`
    );
    return candidates;
  }

  const currentStates = getAllStates().map((s) => s.slug);
  const previousStates = new Set(snap.states);

  // Delta type 1: new state
  for (const slug of currentStates) {
    if (!previousStates.has(slug)) {
      const cfg = getStateConfig(slug);
      candidates.push({
        triggerSource: "data-delta",
        deltaType: "new-state",
        topic: `${cfg.name} community college guide: how the state system works`,
        targetReader: `Prospective ${cfg.name} community college student or transfer planner`,
        searchIntentHypothesis: `New visitor searching "${cfg.name.toLowerCase()} community college transfer" or "${cfg.name.toLowerCase()} community college list"`,
        articleType: "state-spoke",
        state: slug,
        cluster: "transfer-credit-guide",
        nonDuplicateRationale: `${cfg.name} (${slug}) was not in the previous snapshot — it's brand new to the site, so no existing post covers it.`,
        dataSlicePaths: [
          `data/${slug}/institutions.json`,
          `data/${slug}/transfer-equiv.json`,
          `lib/states/${slug}/config.ts`,
        ],
      });
    }
  }

  // Delta type 2: new transfer pairs
  for (const slug of currentStates) {
    const previousPairs = new Set(snap.transferPairs[slug] ?? []);
    const currentPairs = transferPairsForState(slug);
    const newPairs = currentPairs.filter((p) => !previousPairs.has(p));
    if (newPairs.length >= 3) {
      // 3+ new pairs = a meaningful articulation event, not a single-course tweak
      const cfg = getStateConfig(slug);
      candidates.push({
        triggerSource: "data-delta",
        deltaType: "new-transfer-pair",
        topic: `${cfg.name} community college transfer: ${newPairs.length} new articulation pathways`,
        targetReader: `${cfg.name} community college student exploring transfer options`,
        searchIntentHypothesis: `Student looking up specific course transferability between newly-articulated college pairs`,
        articleType: "state-spoke",
        state: slug,
        cluster: "transfer-credit-guide",
        nonDuplicateRationale: `${newPairs.length} new transfer pair(s) added since last snapshot: ${newPairs.slice(0, 3).join(", ")}${newPairs.length > 3 ? "..." : ""}`,
        dataSlicePaths: [`data/${slug}/transfer-equiv.json`],
      });
    }
  }

  // Delta type 3: senior-waiver changes
  for (const slug of currentStates) {
    const cfg = getStateConfig(slug);
    const current = cfg.seniorWaiver
      ? JSON.stringify(cfg.seniorWaiver)
      : null;
    const previous = snap.seniorWaivers[slug]
      ? JSON.stringify(snap.seniorWaivers[slug])
      : null;
    if (current && current !== previous) {
      candidates.push({
        triggerSource: "data-delta",
        deltaType: "senior-waiver-change",
        topic: `${cfg.name} senior tuition waiver: updated rules and what changed`,
        targetReader: `${cfg.name} resident 60+ considering senior tuition benefits`,
        searchIntentHypothesis: `Senior or family member searching "${cfg.name.toLowerCase()} senior college tuition waiver"`,
        articleType: "state-spoke",
        state: slug,
        cluster: "senior-waivers-guide",
        nonDuplicateRationale: `seniorWaiver config for ${slug} changed since last snapshot.`,
        dataSlicePaths: [`lib/states/${slug}/config.ts`],
      });
    }
  }

  // Delta type 4: new institutions (only if 3+ added — single college additions are too small)
  for (const slug of currentStates) {
    const previousInst = new Set(snap.institutions[slug] ?? []);
    const currentInst = institutionsForState(slug);
    const newInst = currentInst.filter((i) => !previousInst.has(i));
    if (newInst.length >= 3) {
      const cfg = getStateConfig(slug);
      candidates.push({
        triggerSource: "data-delta",
        deltaType: "new-institution",
        topic: `${cfg.name} community college network expanded: ${newInst.length} new colleges`,
        targetReader: `Student researching ${cfg.name} community college options`,
        searchIntentHypothesis: `Student searching for the full list of ${cfg.name.toLowerCase()} community colleges`,
        articleType: "state-spoke",
        state: slug,
        cluster: null,
        nonDuplicateRationale: `${newInst.length} institutions added since last snapshot: ${newInst.slice(0, 3).join(", ")}${newInst.length > 3 ? "..." : ""}`,
        dataSlicePaths: [`data/${slug}/institutions.json`],
      });
    }
  }

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
      `[detect-data-deltas] found ${candidates.length} candidate(s)\n`
    );
    process.stdout.write(JSON.stringify({ candidates }, null, 2));
    process.exit(0);
  } catch (err) {
    process.stderr.write(`[detect-data-deltas] error: ${String(err)}\n`);
    process.stdout.write(JSON.stringify({ candidates: [], error: String(err) }));
    process.exit(1);
  }
}

main();

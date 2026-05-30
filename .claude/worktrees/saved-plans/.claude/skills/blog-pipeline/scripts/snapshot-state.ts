#!/usr/bin/env tsx
/**
 * Capture the current state of the registry/data into snapshot.json.
 * The data-delta detector diffs current state against this snapshot.
 *
 * Usage: npx tsx .claude/skills/blog-pipeline/scripts/snapshot-state.ts > .blog-pipeline/snapshot.json
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAllStates } from "../../../../lib/states/registry";

const REPO_ROOT = resolve(__dirname, "../../../..");

type Snapshot = {
  version: 1;
  capturedAt: string;
  states: string[];
  transferPairs: Record<string, string[]>;
  seniorWaivers: Record<string, unknown>;
  institutions: Record<string, string[]>;
};

type TransferEquivEntry = {
  sendingCollege?: string;
  sending?: string;
  receivingUniversity?: string;
  receiving?: string;
};

type Institution = { slug: string };

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

function pairKey(e: TransferEquivEntry): string | null {
  const sender = e.sendingCollege ?? e.sending ?? null;
  const receiver = e.receivingUniversity ?? e.receiving ?? null;
  if (!sender || !receiver) return null;
  return `${sender}->${receiver}`;
}

function build(): Snapshot {
  const states = getAllStates();
  const snap: Snapshot = {
    version: 1,
    capturedAt: new Date().toISOString(),
    states: states.map((s) => s.slug).sort(),
    transferPairs: {},
    seniorWaivers: {},
    institutions: {},
  };

  for (const s of states) {
    const equivPath = resolve(REPO_ROOT, `data/${s.slug}/transfer-equiv.json`);
    const equiv = readJson<TransferEquivEntry[]>(equivPath) ?? [];
    const pairs = Array.from(
      new Set(equiv.map(pairKey).filter((p): p is string => p !== null))
    ).sort();
    if (pairs.length) snap.transferPairs[s.slug] = pairs;

    if (s.seniorWaiver) {
      snap.seniorWaivers[s.slug] = s.seniorWaiver;
    }

    const instPath = resolve(REPO_ROOT, `data/${s.slug}/institutions.json`);
    const inst = readJson<Institution[]>(instPath) ?? [];
    const slugs = Array.from(new Set(inst.map((i) => i.slug))).sort();
    if (slugs.length) snap.institutions[s.slug] = slugs;
  }

  return snap;
}

function main() {
  try {
    const snapshot = build();
    process.stderr.write(
      `[snapshot-state] captured ${snapshot.states.length} states\n`
    );
    process.stdout.write(JSON.stringify(snapshot, null, 2));
    process.exit(0);
  } catch (err) {
    process.stderr.write(`[snapshot-state] error: ${String(err)}\n`);
    process.exit(1);
  }
}

main();

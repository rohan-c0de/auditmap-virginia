/**
 * check-prereq-regression.ts
 *
 * Guards prereq-scraper freshness runs against silent regressions. Run
 * AFTER the scraper has written `data/<state>/prereqs.json` but BEFORE
 * committing it back to the repo.
 *
 * Compares the newly-written JSON against the version committed at
 * git HEAD. Exits non-zero if the new file:
 *   1. Is missing or malformed
 *   2. Has zero entries (HEAD had some → total breakage)
 *   3. Has <80% of HEAD's entry count (>20% drop → likely schema change
 *      upstream; human should look)
 *
 * A strictly non-decreasing key set is NOT required. Schools occasionally
 * retire courses, and a handful of deletions is normal.
 *
 * Usage:
 *   npx tsx scripts/lib/check-prereq-regression.ts ny
 *   npx tsx scripts/lib/check-prereq-regression.ts ny --threshold=0.7
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

interface PrereqEntry {
  text: string;
  courses: string[];
}
type Prereqs = Record<string, PrereqEntry>;

function loadFromDisk(p: string): Prereqs | null {
  if (!fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p, "utf8");
    const j = JSON.parse(raw);
    if (j && typeof j === "object" && !Array.isArray(j)) return j as Prereqs;
    return null;
  } catch {
    return null;
  }
}

function loadFromGitHead(relPath: string): Prereqs | null {
  try {
    const raw = execSync(`git show HEAD:${relPath}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const j = JSON.parse(raw);
    if (j && typeof j === "object" && !Array.isArray(j)) return j as Prereqs;
    return null;
  } catch {
    // File not tracked in HEAD yet (first run) → no baseline to compare.
    return null;
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const state = args.find((a) => !a.startsWith("--"));
  const thresholdArg = args.find((a) => a.startsWith("--threshold="));
  const threshold = thresholdArg
    ? parseFloat(thresholdArg.split("=")[1])
    : 0.8;

  if (!state) {
    console.error("usage: check-prereq-regression <state> [--threshold=0.8]");
    process.exit(2);
  }

  const relPath = `data/${state}/prereqs.json`;
  const absPath = path.join(process.cwd(), relPath);

  const next = loadFromDisk(absPath);
  if (!next) {
    console.error(`✗ ${relPath} missing or malformed`);
    process.exit(1);
  }
  const nextCount = Object.keys(next).length;
  if (nextCount === 0) {
    console.error(`✗ ${relPath} has zero entries`);
    process.exit(1);
  }

  const prev = loadFromGitHead(relPath);
  if (!prev) {
    console.log(
      `✓ ${relPath}: ${nextCount} entries (no HEAD baseline — first run, skipping regression check)`,
    );
    return;
  }
  const prevCount = Object.keys(prev).length;

  const ratio = nextCount / prevCount;
  const pct = (ratio * 100).toFixed(1);
  if (ratio < threshold) {
    console.error(
      `✗ ${relPath}: ${nextCount} entries vs HEAD ${prevCount} (${pct}% — below ${(threshold * 100).toFixed(0)}% threshold)`,
    );
    process.exit(1);
  }

  const delta = nextCount - prevCount;
  const sign = delta >= 0 ? "+" : "";
  console.log(
    `✓ ${relPath}: ${nextCount} entries vs HEAD ${prevCount} (${sign}${delta}, ${pct}%)`,
  );
}

main();

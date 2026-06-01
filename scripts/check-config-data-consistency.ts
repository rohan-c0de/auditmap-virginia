/**
 * check-config-data-consistency.ts — CI guard for StateConfig flags that
 * disagree with the data actually on disk.
 *
 * Motivated by the 2026-05-31 data-foundation audit (issue #937), which found
 * Hawaii shipping `transferSupported: false` while 15,649 in-state transfer
 * equivalencies sat unused on disk (the route was hidden for no reason). This
 * check fails CI on that class of drift so a flag and its backing data can
 * never silently diverge again.
 *
 * Checks (CLAUDE.md invariant #1 — no hardcoded state lists; derive from the
 * registry):
 *
 *   FAIL  transferSupported ⇎ transfer-equiv.json
 *         - flag is false but data/{state}/transfer-equiv.json has > 0 rows
 *           → the transfer route is hidden despite having data (the HI bug).
 *         - flag is true but the file is missing / has 0 rows
 *           → the UI promises a transfer page with nothing behind it.
 *
 *   WARN  prereqs coverage declared but no backing file
 *         - hasPrereqsCoverage(state) is true but data/{state}/prereqs.json is
 *           missing or empty. Non-fatal: some states (e.g. WA) intentionally
 *           declare `aggregate-from-courses` against a source that currently
 *           yields nothing, and the planner degrades gracefully. Surfaced so
 *           the list stays visible, not so it blocks a PR.
 *
 * Usage: npx tsx scripts/check-config-data-consistency.ts
 * Exits 1 if any FAIL; 0 otherwise (warnings never fail the run).
 */

import * as fs from "fs";
import * as path from "path";
import { getAllStates, hasPrereqsCoverage } from "../lib/states/registry";

function jsonRowCount(file: string): number {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (Array.isArray(parsed)) return parsed.length;
    if (parsed && typeof parsed === "object") return Object.keys(parsed).length;
    return 0;
  } catch {
    return 0; // missing or unparseable → treat as no data
  }
}

const root = process.cwd();
const failures: string[] = [];
const warnings: string[] = [];

for (const cfg of getAllStates()) {
  const slug = cfg.slug;

  // --- transferSupported ⇎ transfer-equiv.json (FAIL) ---
  const transferRows = jsonRowCount(
    path.join(root, "data", slug, "transfer-equiv.json"),
  );
  if (transferRows > 0 && !cfg.transferSupported) {
    failures.push(
      `${slug}: transferSupported=false but data/${slug}/transfer-equiv.json has ${transferRows} rows — ` +
        `the transfer route is hidden despite having data. Set transferSupported: true.`,
    );
  }
  if (transferRows === 0 && cfg.transferSupported) {
    failures.push(
      `${slug}: transferSupported=true but data/${slug}/transfer-equiv.json is missing/empty — ` +
        `the UI promises a transfer page with no data. Set transferSupported: false (and document the ceiling).`,
    );
  }

  // --- prereqs coverage declared but no backing file (WARN) ---
  if (hasPrereqsCoverage(slug)) {
    const prereqRows = jsonRowCount(
      path.join(root, "data", slug, "prereqs.json"),
    );
    if (prereqRows === 0) {
      warnings.push(
        `${slug}: hasPrereqsCoverage=true but data/${slug}/prereqs.json is missing/empty ` +
          `(declared coverage with nothing behind it — verify the prereq UI degrades gracefully).`,
      );
    }
  }
}

if (warnings.length > 0) {
  console.warn(`\n⚠  ${warnings.length} prereq-coverage warning(s):`);
  for (const w of warnings) console.warn(`   - ${w}`);
}

if (failures.length > 0) {
  console.error(`\n✖ config/data consistency: ${failures.length} failure(s):`);
  for (const f of failures) console.error(`   - ${f}`);
  process.exit(1);
}

console.log(
  `\n✔ config/data consistency OK — ${getAllStates().length} states; transferSupported matches transfer-equiv.json data for all.`,
);

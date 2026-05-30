/**
 * reapply-program-matcher.ts
 *
 * One-shot utility: walks every data/{state}/programs/*.json file and
 * recomputes `matched_program_slug` for each program by running the
 * current matcher (lib/programs/matcher.ts) against each program title.
 *
 * Use after adding new slugs to the registry or new rules to the matcher
 * so existing scraped data picks them up without re-scraping. Idempotent —
 * running it again with no rule changes produces no diff.
 *
 * Usage:
 *   npx tsx scripts/reapply-program-matcher.ts
 *   npx tsx scripts/reapply-program-matcher.ts --dry-run
 */

import * as fs from "fs";
import * as path from "path";
import { matchProgramSlug } from "../lib/programs/matcher.js";

interface ProgramFile {
  programs: Array<{
    title: string;
    matched_program_slug: string | null;
    [k: string]: unknown;
  }>;
  [k: string]: unknown;
}

const DATA_ROOT = path.join(process.cwd(), "data");
const dryRun = process.argv.includes("--dry-run");

function listProgramFiles(): string[] {
  const out: string[] = [];
  for (const stateEntry of fs.readdirSync(DATA_ROOT, { withFileTypes: true })) {
    if (!stateEntry.isDirectory()) continue;
    const programsDir = path.join(DATA_ROOT, stateEntry.name, "programs");
    if (!fs.existsSync(programsDir)) continue;
    for (const f of fs.readdirSync(programsDir)) {
      if (f.endsWith(".json")) out.push(path.join(programsDir, f));
    }
  }
  return out;
}

let totalPrograms = 0;
let totalChanged = 0;
let filesChanged = 0;
const changesByTransition = new Map<string, number>();

for (const file of listProgramFiles().sort()) {
  let data: ProgramFile;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (e) {
    console.warn(`! could not parse ${file}: ${(e as Error).message}`);
    continue;
  }

  let fileChanged = false;
  for (const program of data.programs ?? []) {
    totalPrograms += 1;
    const newSlug = matchProgramSlug(program.title ?? "");
    if (newSlug !== program.matched_program_slug) {
      const before = program.matched_program_slug ?? "null";
      const after = newSlug ?? "null";
      const key = `${before} → ${after}`;
      changesByTransition.set(key, (changesByTransition.get(key) ?? 0) + 1);
      program.matched_program_slug = newSlug;
      totalChanged += 1;
      fileChanged = true;
    }
  }

  if (fileChanged) {
    filesChanged += 1;
    if (!dryRun) {
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
    }
    console.log(
      `${dryRun ? "[dry-run] " : ""}${path.relative(process.cwd(), file)}`,
    );
  }
}

console.log(
  `\n${totalChanged} of ${totalPrograms} programs reassigned across ${filesChanged} file(s).`,
);
if (changesByTransition.size > 0) {
  console.log(`\nTransitions:`);
  const sorted = [...changesByTransition.entries()].sort((a, b) => b[1] - a[1]);
  for (const [transition, count] of sorted) {
    console.log(`  ${count.toString().padStart(5)}  ${transition}`);
  }
}
if (dryRun) {
  console.log(`\n(dry run — no files written)`);
}

/**
 * Grade snapshot test for the state-audit rubric.
 *
 * Asserts expected per-dim and composite grades for a curated set of
 * states that exercise the rubric's branches. Grades drift as data lands,
 * so the curated examples are re-baselined periodically (last: 2026-06-23,
 * the same commit that fixed the lexicographic isStale bug — see
 * collect-audit-data.ts). Branches currently covered:
 *
 *   - Wide-and-deep coverage (NC) → composite A
 *   - Documented course ceilings (FL, AR, AZ, MI, TX, CA) → courses on adj. coverage
 *   - Documented transfer ceiling (NH) → transfers capped at B
 *   - Improving / thin transfers (OH, VT, WV, WA) → transfers A or B
 *   - Course coverage gaps (NY, OH, WV) → courses C/D
 *   - All-dims-wired flagship (VA) → composite A
 *
 * When the data legitimately shifts a grade, update the expected value
 * in the same commit with a one-line justification — the snapshot is a
 * tripwire, not a wall.
 *
 * Usage:
 *   npx tsx .claude/skills/state-audit/scripts/grade-snapshot.test.ts
 *
 * Exits 0 on pass, 1 on fail.
 */

import { execSync } from "child_process";
import * as path from "path";

interface Expectation {
  slug: string;
  composite?: string;
  limitedBy?: string;
  courses?: string;
  prereqs?: string;
  transfers?: string;
  scorecard?: string;
  config?: string;
  ceilingsDimensions?: string[]; // which dimensions should have ceilings applied
  note: string;
}

const EXPECTATIONS: Expectation[] = [
  {
    slug: "nc",
    composite: "A",
    courses: "A",
    transfers: "A",
    note: "58/58 colleges, 25K transfers across 20 unis, all wired — flagship A",
  },
  {
    slug: "ny",
    composite: "C",
    limitedBy: "courses",
    courses: "C",
    prereqs: "A",
    transfers: "A",
    note: "re-baseline 2026-06-23: NY courses recovered to C (62%, 23/37) and prereqs HTML cleaned → A; composite C (courses-limited). Was D.",
  },
  {
    slug: "nh",
    composite: "B",
    limitedBy: "transfers",
    transfers: "B",
    ceilingsDimensions: ["transfers"],
    note: "1-university ceiling documented (USNH) — capped at B floor, would be C otherwise",
  },
  {
    slug: "oh",
    composite: "D",
    limitedBy: "courses",
    courses: "D",
    transfers: "A",
    note: "re-baseline 2026-06-23: OH transfers now A (was thin C); composite still D (courses 41%, 9/22, dominates).",
  },
  {
    slug: "vt",
    composite: "B",
    limitedBy: "transfers",
    transfers: "B",
    courses: "A",
    note: "drift re-baseline (unrelated to collector fix): VT transfers now grade B → composite B.",
  },
  {
    slug: "fl",
    composite: "A",
    limitedBy: "courses",
    courses: "A",
    ceilingsDimensions: ["courses"],
    note: "collector fix: fscj+pensacolastate documented course ceilings now correctly excused (26/26=100%) instead of double-subtracted (was 24/26) → courses A, composite A",
  },
  {
    slug: "mi",
    composite: "B",
    limitedBy: "courses",
    courses: "B",
    transfers: "A",
    ceilingsDimensions: ["courses"],
    note: "re-baseline 2026-06-23: MI's blocked colleges now documented course ceilings → courses B (94% adj, 16/17); composite B. Was C.",
  },
  {
    slug: "tx",
    composite: "B",
    limitedBy: "courses",
    courses: "B",
    transfers: "A",
    scorecard: "A",
    ceilingsDimensions: ["courses"],
    note: "re-baseline 2026-06-23: TX blocked colleges now documented course ceilings → courses B (100% adj) capped by term-code hygiene; scorecard A; composite B. Was C. (stale-fix removed its false 2025FA flag; the genuine 2024FA remains.)",
  },
  {
    slug: "va",
    composite: "A",
    limitedBy: "courses",
    transfers: "A",
    courses: "A",
    note: "drift re-baseline: VA transfer scrapers now wired (PR #972 merged) → transfers A, composite A (all five dims A).",
  },
  {
    slug: "ca",
    composite: "B",
    limitedBy: "courses",
    transfers: "A",
    courses: "B",
    ceilingsDimensions: ["courses"],
    note: "re-baseline 2026-06-23: CA blocked colleges now documented course ceilings → courses B (100% adj) capped by suspicious term codes; composite B. Was C. (stale-fix removed its false 2025FA flag.)",
  },
  {
    slug: "wv",
    composite: "D",
    limitedBy: "courses",
    courses: "D",
    transfers: "B",
    note: "re-baseline 2026-06-23: WV transfers now B (was thin C); composite still D (courses 33%, 3/9).",
  },
  {
    slug: "ar",
    composite: "A",
    limitedBy: "courses",
    courses: "A",
    ceilingsDimensions: ["courses"],
    note: "collector fix: 2 documented course ceilings (HSU/UAPB) now excused (12/12=100%) instead of double-subtracted (was 10/12=83% C) → courses A, composite A",
  },
  {
    slug: "az",
    composite: "B",
    limitedBy: "courses",
    courses: "B",
    ceilingsDimensions: ["courses"],
    note: "collector fix: 2 documented course ceilings excused → coverage 18/19=95% (was 16/19=84% C) → courses B, composite B",
  },
  {
    slug: "wa",
    composite: "B",
    limitedBy: "transfers",
    courses: "A",
    prereqs: "A",
    transfers: "B",
    note: "re-baseline 2026-06-23: WA now has prereqs (A) and wired transfers (B) → composite B, transfers-limited. Was F (prereqs missing).",
  },
];

interface AuditState {
  slug: string;
  grades: {
    courses: { grade: string; reason: string };
    prereqs: { grade: string; reason: string };
    transfers: { grade: string; reason: string };
    scorecard: { grade: string; reason: string };
    config: { grade: string; reason: string };
    composite: string;
    limitedBy: string;
    ceilingsApplied: Array<{ dimension: string; reason: string }>;
  };
}

function runAudit(): AuditState[] {
  const collector = path.join(
    process.cwd(),
    ".claude/skills/state-audit/scripts/collect-audit-data.ts",
  );
  const json = execSync(`npx tsx ${collector}`, {
    encoding: "utf-8",
    maxBuffer: 50 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
  return JSON.parse(json);
}

function main() {
  console.log("Running state-audit grade snapshot test…\n");
  const audit = runAudit();
  const bySlug = new Map(audit.map((s) => [s.slug, s]));

  let pass = 0;
  let fail = 0;
  const failures: string[] = [];

  for (const exp of EXPECTATIONS) {
    const state = bySlug.get(exp.slug);
    if (!state) {
      fail++;
      failures.push(`${exp.slug}: not found in audit output`);
      continue;
    }
    const g = state.grades;
    const checks: Array<[string, string | undefined, string]> = [
      ["composite", exp.composite, g.composite],
      ["limitedBy", exp.limitedBy, g.limitedBy],
      ["courses", exp.courses, g.courses.grade],
      ["prereqs", exp.prereqs, g.prereqs.grade],
      ["transfers", exp.transfers, g.transfers.grade],
      ["scorecard", exp.scorecard, g.scorecard.grade],
      ["config", exp.config, g.config.grade],
    ];
    const errs: string[] = [];
    for (const [field, expected, actual] of checks) {
      if (expected !== undefined && expected !== actual) {
        errs.push(`${field}: expected ${expected}, got ${actual}`);
      }
    }
    if (exp.ceilingsDimensions) {
      const appliedDims = new Set(g.ceilingsApplied.map((c) => c.dimension));
      for (const dim of exp.ceilingsDimensions) {
        if (!appliedDims.has(dim)) {
          errs.push(`ceilings: expected ${dim} exemption, none applied`);
        }
      }
    }
    if (errs.length === 0) {
      pass++;
      console.log(`  ✓ ${exp.slug.padEnd(4)} ${g.composite} (${g.limitedBy}) — ${exp.note}`);
    } else {
      fail++;
      failures.push(`  ✗ ${exp.slug}: ${errs.join("; ")} (note: ${exp.note})`);
    }
  }

  console.log(`\n${pass} passed, ${fail} failed (${EXPECTATIONS.length} total)`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(f);
    process.exit(1);
  }
  process.exit(0);
}

main();

/**
 * Evaluate the search-intent LLM classifier against the fixture in
 * lib/search-intent/eval/cases.ts and print a report.
 *
 * Usage:
 *   npm run eval:search                # full run, all 62 cases
 *   npm run eval:search -- --filter=tr # only cases whose id starts with "tr"
 *   npm run eval:search -- --no-cache  # bypass in-memory cache (re-classify
 *                                        every case — useful after prompt edits)
 *
 * Requires ANTHROPIC_API_KEY in the environment. Reads .env.local
 * automatically via the Next runtime convention; for raw tsx execution we
 * use dotenv. If you don't have a key set, the script exits early with a
 * clear message rather than failing partway through.
 *
 * The eval uses an in-memory cache scoped to a single process run — so
 * repeated invocations always hit the LLM fresh. This is intentional for
 * baseline measurement; you don't want yesterday's cached answer to mask a
 * regression after a prompt edit.
 */

import { existsSync, readFileSync } from "node:fs";
import { llmClassifier } from "../lib/search-intent/classify-llm";
import { inMemoryClassifier } from "../lib/search-intent/classify";
import { EVAL_CASES } from "../lib/search-intent/eval/cases";
import { runEval, formatReport } from "../lib/search-intent/eval/runner";

// Tiny .env.local loader so we don't need dotenv as a dep — matches the
// pattern used by scripts/bench-transfer-lookup.ts.
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  }
}

function parseArgs(argv: string[]): { filter: string | null; noCache: boolean } {
  let filter: string | null = null;
  let noCache = false;
  for (const a of argv) {
    if (a.startsWith("--filter=")) filter = a.slice("--filter=".length);
    if (a === "--no-cache") noCache = true;
  }
  return { filter, noCache };
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local before running the eval.",
    );
    process.exit(2);
  }

  const { filter, noCache } = parseArgs(process.argv.slice(2));

  const cases = filter
    ? EVAL_CASES.filter((c) => c.id.startsWith(filter))
    : EVAL_CASES;
  if (cases.length === 0) {
    console.error(`No cases matched filter "${filter}".`);
    process.exit(2);
  }

  const llm = llmClassifier();
  // In-memory cache lets repeat queries within a single run dedupe (rare in
  // EVAL_CASES — every query is unique — but useful when --filter narrows
  // and the same query appears under multiple ids in future fixture edits).
  const classifier = noCache ? llm : inMemoryClassifier({ llm });

  console.log(
    `Evaluating ${cases.length} case${cases.length === 1 ? "" : "s"} against ${
      noCache ? "fresh LLM (no cache)" : "LLM with in-memory cache"
    }…`,
  );
  console.log("");

  const start = Date.now();
  const report = await runEval(classifier, cases);
  const wallSec = ((Date.now() - start) / 1000).toFixed(1);

  console.log(formatReport(report));
  console.log("");
  console.log(`Wall time: ${wallSec}s`);
}

main().catch((err) => {
  console.error("Eval failed:", err);
  process.exit(1);
});

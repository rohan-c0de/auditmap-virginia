/**
 * triage-scraper-health.ts
 *
 * Deterministic triage classifier for scraper health records.
 * Reads history.jsonl + the state registry, applies an 11-category
 * decision tree, and outputs JSON + markdown suitable for a GitHub issue.
 *
 * Usage (CLI):
 *   npx tsx scripts/lib/triage-scraper-health.ts \
 *     --history data/state-health/history.jsonl \
 *     --window-days 14 \
 *     --out /tmp/triage.json
 *
 * Usage (workflow post-step):
 *   Called after check-scrape-health.ts appends to history.jsonl.
 */

import * as fs from "node:fs";
import { join } from "node:path";
import { getAllStates } from "../../lib/states/registry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HistoryRecord {
  ts: string;
  run_id: string;
  run_url: string;
  datatype: string;
  state: string;
  job_index: number;
  scripts: string[];
  conclusion: string | null;
  status: "healthy" | "empty" | "failed" | "unknown";
  detail: string;
  colleges_missing?: string[];
}

type Classification =
  | "known-acceptable"
  | "registry-evolution"
  | "new-scraper-no-history"
  | "infrastructure-incident"
  | "persistent-broken"
  | "regression"
  | "transient"
  | "recovered"
  | "partial-coverage-degraded"
  | "stable-healthy"
  | "external-issue-resolved";

type RecommendedAction =
  | "no-action"
  | "watch"
  | "open-investigation-issue"
  | "comment-on-existing-issue"
  | "close-existing-issue"
  | "note-in-rollup";

interface TriageResult {
  state: string;
  datatype: string;
  job_index: number;
  classification: Classification;
  reasoning: string;
  key_signals: string[];
  recommended_action: RecommendedAction;
  issue_scope: string;
}

interface DeclaredScraper {
  state: string;
  datatype: string;
  job_index: number;
  scripts: string[];
  manualOnly: boolean;
}

// ---------------------------------------------------------------------------
// Registry helpers
// ---------------------------------------------------------------------------

function getDeclaredScrapers(): DeclaredScraper[] {
  const states = getAllStates();
  const declared: DeclaredScraper[] = [];

  for (const st of states) {
    const configPath = join(
      process.cwd(),
      "lib",
      "states",
      st.slug,
      "config.ts"
    );
    let configText = "";
    try {
      configText = fs.readFileSync(configPath, "utf-8");
    } catch {
      continue;
    }

    const scrapers = (st as { scrapers?: Record<string, Array<{ scripts: string[] }>> }).scrapers;
    if (!scrapers) continue;

    for (const [datatype, jobs] of Object.entries(scrapers)) {
      const manualOnlyRe = new RegExp(
        `//\\s*manual-only:\\s*${datatype}`,
        "i"
      );
      const manualOnly = manualOnlyRe.test(configText);

      for (let i = 0; i < jobs.length; i++) {
        declared.push({
          state: st.slug,
          datatype,
          job_index: i,
          scripts: jobs[i].scripts,
          manualOnly,
        });
      }
    }
  }

  return declared;
}

// ---------------------------------------------------------------------------
// History helpers
// ---------------------------------------------------------------------------

function loadHistory(filePath: string, windowDays: number): HistoryRecord[] {
  if (!fs.existsSync(filePath)) return [];
  const cutoff = new Date(
    Date.now() - windowDays * 24 * 60 * 60 * 1000
  ).toISOString();
  const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n");
  const records: HistoryRecord[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line) as HistoryRecord;
    if (rec.ts >= cutoff) records.push(rec);
  }
  return records;
}

function key(state: string, datatype: string, jobIndex: number): string {
  return `${state}|${datatype}|${jobIndex}`;
}

function isFailed(rec: HistoryRecord): boolean {
  if (rec.status === "failed" || rec.status === "empty") return true;
  if (rec.conclusion === "cancelled") return true;
  return false;
}

function isSuccess(rec: HistoryRecord): boolean {
  return !isFailed(rec);
}

// ---------------------------------------------------------------------------
// Core triage logic
// ---------------------------------------------------------------------------

function classifyOne(
  scraper: DeclaredScraper,
  records: HistoryRecord[],
  allRecords: HistoryRecord[]
): TriageResult {
  const { state, datatype, job_index } = scraper;
  const scope = `${state}-${datatype}-${job_index}`;

  // Step 1: known-acceptable
  if (scraper.manualOnly) {
    return {
      state,
      datatype,
      job_index,
      classification: "known-acceptable",
      reasoning: `Registry has manual-only marker for ${state}/${datatype}.`,
      key_signals: ["manual-only marker in config"],
      recommended_action: "no-action",
      issue_scope: scope,
    };
  }

  // Step 3: new-scraper-no-history (step 2 is handled by the caller)
  if (records.length === 0) {
    return {
      state,
      datatype,
      job_index,
      classification: "new-scraper-no-history",
      reasoning: `Registry declares this scraper but no history records exist within the window.`,
      key_signals: ["zero history records"],
      recommended_action: "watch",
      issue_scope: scope,
    };
  }

  // Sort by ts descending (most recent first)
  const sorted = [...records].sort(
    (a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()
  );
  const trailing = sorted.slice(0, 8);

  // Step 4: infrastructure-incident check
  // Look at the most recent tick — if it failed, check if ≥2 unrelated states
  // also failed at the same ts with identical detail
  const latestTs = sorted[0].ts;
  if (isFailed(sorted[0])) {
    const sameTickFailures = allRecords.filter(
      (r) => r.ts === latestTs && isFailed(r) && r.state !== state
    );
    const freshFailures = sameTickFailures.filter((r) => {
      const priorRecords = allRecords
        .filter(
          (h) =>
            h.state === r.state &&
            h.datatype === r.datatype &&
            h.job_index === r.job_index &&
            h.ts < r.ts
        )
        .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
      return priorRecords.length === 0 || isSuccess(priorRecords[0]);
    });

    if (freshFailures.length >= 2) {
      // Check if all recovered by next tick
      const nextTickRecords = allRecords.filter(
        (r) => r.ts > latestTs && r.state === state && r.datatype === datatype
      );
      const recovered =
        nextTickRecords.length > 0 && isSuccess(nextTickRecords[0]);
      if (recovered) {
        return {
          state,
          datatype,
          job_index,
          classification: "infrastructure-incident",
          reasoning: `${freshFailures.length + 1} unrelated states failed at ${latestTs} and recovered by the next tick.`,
          key_signals: [
            `${freshFailures.length + 1} fresh failures at same timestamp`,
            "all recovered next tick",
          ],
          recommended_action: "note-in-rollup",
          issue_scope: `infrastructure-${sorted[0].run_id}`,
        };
      }
    }
  }

  // Step 5: trailing-edge analysis
  const trailingStatuses = trailing.map((r) => isFailed(r));
  const allHealthy = trailingStatuses.every((f) => !f);
  const trailingFailCount = trailingStatuses.filter(Boolean).length;

  // All healthy
  if (allHealthy) {
    // Check if there were earlier failures in the window
    const hasEarlierFailures = sorted
      .slice(trailing.length)
      .some((r) => isFailed(r));
    if (hasEarlierFailures && trailing.length >= 3) {
      return {
        state,
        datatype,
        job_index,
        classification: "recovered",
        reasoning: `Last ${trailing.length} ticks healthy; earlier failures exist in window.`,
        key_signals: [
          `${trailing.length} consecutive successes`,
          "prior failures in window",
        ],
        recommended_action: "close-existing-issue",
        issue_scope: scope,
      };
    }
    return {
      state,
      datatype,
      job_index,
      classification: "stable-healthy",
      reasoning: `All ${trailing.length} ticks in trailing window are healthy.`,
      key_signals: [`${trailing.length} consecutive successes`],
      recommended_action: "no-action",
      issue_scope: scope,
    };
  }

  // Count consecutive failures from the trailing edge
  let consecutiveFailures = 0;
  for (const f of trailingStatuses) {
    if (f) consecutiveFailures++;
    else break;
  }

  // Count consecutive successes before the failure streak
  let priorSuccesses = 0;
  for (let i = consecutiveFailures; i < trailingStatuses.length; i++) {
    if (!trailingStatuses[i]) priorSuccesses++;
    else break;
  }

  // Persistent broken: ≥3 consecutive failures at trailing edge
  if (consecutiveFailures >= 3) {
    const firstFailTs = trailing[consecutiveFailures - 1].ts;
    return {
      state,
      datatype,
      job_index,
      classification: "persistent-broken",
      reasoning: `${consecutiveFailures} consecutive failures since ${firstFailTs}. No recovery observed.`,
      key_signals: [
        `${consecutiveFailures} consecutive failures`,
        `failing since ${firstFailTs}`,
      ],
      recommended_action: "open-investigation-issue",
      issue_scope: scope,
    };
  }

  // Regression: 1-2 trailing failures with ≥3 prior successes
  if (consecutiveFailures >= 1 && priorSuccesses >= 3) {
    return {
      state,
      datatype,
      job_index,
      classification: "regression",
      reasoning: `Last ${consecutiveFailures} tick(s) failed after ${priorSuccesses} consecutive successes.`,
      key_signals: [
        `${consecutiveFailures} recent failure(s)`,
        `${priorSuccesses} prior consecutive successes`,
      ],
      recommended_action: "watch",
      issue_scope: scope,
    };
  }

  // Transient: single failure surrounded by successes
  if (trailingFailCount === 1) {
    return {
      state,
      datatype,
      job_index,
      classification: "transient",
      reasoning: `Single isolated failure in trailing window; surrounded by successes.`,
      key_signals: ["1 failure in window", "successes before and after"],
      recommended_action: "no-action",
      issue_scope: scope,
    };
  }

  // Partial-coverage-degraded: this job failed but sibling jobs at same tick succeeded
  if (consecutiveFailures >= 1) {
    const siblings = allRecords.filter(
      (r) =>
        r.state === state &&
        r.datatype === datatype &&
        r.ts === latestTs &&
        r.job_index !== job_index
    );
    const siblingsHealthy =
      siblings.length > 0 && siblings.every((r) => isSuccess(r));
    if (siblingsHealthy) {
      return {
        state,
        datatype,
        job_index,
        classification: "partial-coverage-degraded",
        reasoning: `Job ${job_index} failed but ${siblings.length} sibling job(s) for ${state}/${datatype} are healthy.`,
        key_signals: [
          `job ${job_index} failed`,
          `${siblings.length} sibling(s) healthy`,
        ],
        recommended_action: "open-investigation-issue",
        issue_scope: scope,
      };
    }
  }

  // Fallback: regression with fewer prior successes
  if (consecutiveFailures >= 1) {
    return {
      state,
      datatype,
      job_index,
      classification: "regression",
      reasoning: `Last ${consecutiveFailures} tick(s) failed with only ${priorSuccesses} prior success(es).`,
      key_signals: [
        `${consecutiveFailures} recent failure(s)`,
        `${priorSuccesses} prior success(es)`,
      ],
      recommended_action: "watch",
      issue_scope: scope,
    };
  }

  return {
    state,
    datatype,
    job_index,
    classification: "stable-healthy",
    reasoning: "No failure pattern detected.",
    key_signals: [],
    recommended_action: "no-action",
    issue_scope: scope,
  };
}

// ---------------------------------------------------------------------------
// Rollup: classify all declared scrapers
// ---------------------------------------------------------------------------

const CLASSIFICATION_ORDER: Classification[] = [
  "persistent-broken",
  "regression",
  "partial-coverage-degraded",
  "infrastructure-incident",
  "external-issue-resolved",
  "new-scraper-no-history",
  "recovered",
  "transient",
  "known-acceptable",
  "registry-evolution",
  "stable-healthy",
];

function triageAll(
  historyPath: string,
  windowDays: number
): { results: TriageResult[]; markdown: string } {
  const allRecords = loadHistory(historyPath, windowDays);
  const declared = getDeclaredScrapers();

  // Index history by (state, datatype, job_index)
  const byKey = new Map<string, HistoryRecord[]>();
  for (const rec of allRecords) {
    const k = key(rec.state, rec.datatype, rec.job_index);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(rec);
  }

  const results: TriageResult[] = [];

  // Classify declared scrapers
  for (const scraper of declared) {
    const k = key(scraper.state, scraper.datatype, scraper.job_index);
    const records = byKey.get(k) || [];
    results.push(classifyOne(scraper, records, allRecords));
  }

  // Step 2: registry-evolution — history keys not in declared set
  const declaredKeys = new Set(
    declared.map((s) => key(s.state, s.datatype, s.job_index))
  );
  const seenHistoryKeys = new Set<string>();
  for (const rec of allRecords) {
    const k = key(rec.state, rec.datatype, rec.job_index);
    if (!declaredKeys.has(k) && !seenHistoryKeys.has(k)) {
      seenHistoryKeys.add(k);
      results.push({
        state: rec.state,
        datatype: rec.datatype,
        job_index: rec.job_index,
        classification: "registry-evolution",
        reasoning: `History has records but registry no longer declares this scraper.`,
        key_signals: ["scraper removed from registry"],
        recommended_action: "no-action",
        issue_scope: `${rec.state}-${rec.datatype}-${rec.job_index}`,
      });
    }
  }

  // Sort by classification priority, then state, then datatype
  results.sort((a, b) => {
    const ai = CLASSIFICATION_ORDER.indexOf(a.classification);
    const bi = CLASSIFICATION_ORDER.indexOf(b.classification);
    if (ai !== bi) return ai - bi;
    if (a.state !== b.state) return a.state.localeCompare(b.state);
    return a.datatype.localeCompare(b.datatype);
  });

  // Build markdown
  const markdown = buildMarkdown(results);

  return { results, markdown };
}

function buildMarkdown(results: TriageResult[]): string {
  const counts = new Map<Classification, number>();
  for (const r of results) {
    counts.set(r.classification, (counts.get(r.classification) || 0) + 1);
  }

  const lines: string[] = [];
  lines.push("# Scraper Health Triage");
  lines.push("");
  lines.push(
    `> Auto-generated at ${new Date().toISOString()} · ${results.length} scrapers classified`
  );
  lines.push("");

  // Summary counts
  lines.push("## Summary");
  lines.push("");
  const actionable = (counts.get("persistent-broken") || 0) +
    (counts.get("regression") || 0) +
    (counts.get("partial-coverage-degraded") || 0);
  lines.push(
    `**${actionable} actionable** · ${counts.get("stable-healthy") || 0} stable · ${counts.get("known-acceptable") || 0} manual-only`
  );
  lines.push("");

  for (const cls of CLASSIFICATION_ORDER) {
    const count = counts.get(cls) || 0;
    if (count === 0) continue;
    const emoji = cls === "persistent-broken" ? "🔴" :
      cls === "regression" ? "🟡" :
      cls === "partial-coverage-degraded" ? "🟠" :
      cls === "recovered" ? "🟢" :
      cls === "stable-healthy" ? "✅" :
      cls === "known-acceptable" ? "⏸️" :
      "ℹ️";
    lines.push(`${emoji} **${cls}**: ${count}`);
  }
  lines.push("");

  // Detail sections for actionable items only
  const actionableResults = results.filter(
    (r) =>
      r.classification === "persistent-broken" ||
      r.classification === "regression" ||
      r.classification === "partial-coverage-degraded" ||
      r.classification === "infrastructure-incident"
  );

  if (actionableResults.length > 0) {
    lines.push("## Needs Attention");
    lines.push("");
    lines.push("| State | Datatype | Job | Classification | Signals |");
    lines.push("|-------|----------|-----|----------------|---------|");
    for (const r of actionableResults) {
      lines.push(
        `| ${r.state.toUpperCase()} | ${r.datatype} | ${r.job_index} | \`${r.classification}\` | ${r.key_signals.join("; ")} |`
      );
    }
    lines.push("");
  }

  // Recovered
  const recoveredResults = results.filter(
    (r) => r.classification === "recovered"
  );
  if (recoveredResults.length > 0) {
    lines.push("## Recovered");
    lines.push("");
    for (const r of recoveredResults) {
      lines.push(
        `- **${r.state.toUpperCase()}/${r.datatype}** (job ${r.job_index}): ${r.reasoning}`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const historyIdx = args.indexOf("--history");
  const windowIdx = args.indexOf("--window-days");
  const outIdx = args.indexOf("--out");

  const historyPath = historyIdx >= 0
    ? args[historyIdx + 1]
    : join(process.cwd(), "data", "state-health", "history.jsonl");
  const windowDays = windowIdx >= 0 ? parseInt(args[windowIdx + 1], 10) : 14;
  const outPath = outIdx >= 0 ? args[outIdx + 1] : null;

  const { results, markdown } = triageAll(historyPath, windowDays);

  const output = { results, markdown, generatedAt: new Date().toISOString() };

  if (outPath) {
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
    console.log(`Triage report written to ${outPath}`);
  } else {
    console.log(JSON.stringify(output, null, 2));
  }

  // Print markdown summary to stderr for CI visibility
  console.error(markdown);

  // Exit with non-zero if any persistent-broken found
  const hasBroken = results.some(
    (r) => r.classification === "persistent-broken"
  );
  if (hasBroken) {
    console.error(
      "\n⚠️  Persistent-broken scrapers detected. See triage report."
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

export { triageAll, classifyOne, loadHistory, getDeclaredScrapers };
export type { TriageResult, Classification, HistoryRecord };

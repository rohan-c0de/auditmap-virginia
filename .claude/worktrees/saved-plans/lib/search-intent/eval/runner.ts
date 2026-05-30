import type { Classifier } from "../types";
import { EVAL_CASES, type EvalCase } from "./cases";
import { matchesExpected } from "./matcher";

export interface CaseResult {
  case: EvalCase;
  passed: boolean;
  reason?: string;
  // Wall-clock latency of the classifier call, in ms.
  latencyMs: number;
  // Confidence as reported by the classifier.
  confidence: number;
  // Actual intent type the classifier produced. Useful for confusion-matrix
  // style reporting in later PRs.
  actualType: string;
}

export interface CategoryStats {
  category: EvalCase["category"];
  total: number;
  passed: number;
  passRate: number;
}

export interface EvalReport {
  total: number;
  passed: number;
  passRate: number;
  // Per-category breakdown so we can spot regressions in a single bucket
  // even when the overall rate looks fine.
  byCategory: CategoryStats[];
  // p50 / p95 classifier latency. Matters once LLM tier ships.
  latencyMsP50: number;
  latencyMsP95: number;
  results: CaseResult[];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export async function runEval(
  classifier: Classifier,
  cases: EvalCase[] = EVAL_CASES,
): Promise<EvalReport> {
  const results: CaseResult[] = [];

  for (const c of cases) {
    const start = performance.now();
    const classified = await classifier(c.query, c.state ?? "va");
    const latencyMs = performance.now() - start;
    const match = matchesExpected(classified.intent, c.expected);
    results.push({
      case: c,
      passed: match.matched,
      reason: match.reason,
      latencyMs,
      confidence: classified.confidence,
      actualType: classified.intent.type,
    });
  }

  const byCategoryMap = new Map<EvalCase["category"], { total: number; passed: number }>();
  for (const r of results) {
    const slot = byCategoryMap.get(r.case.category) ?? { total: 0, passed: 0 };
    slot.total += 1;
    if (r.passed) slot.passed += 1;
    byCategoryMap.set(r.case.category, slot);
  }
  const byCategory: CategoryStats[] = [...byCategoryMap.entries()].map(
    ([category, { total, passed }]) => ({
      category,
      total,
      passed,
      passRate: total === 0 ? 0 : passed / total,
    }),
  );

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const sortedLatencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);

  return {
    total,
    passed,
    passRate: total === 0 ? 0 : passed / total,
    byCategory,
    latencyMsP50: percentile(sortedLatencies, 50),
    latencyMsP95: percentile(sortedLatencies, 95),
    results,
  };
}

/** Render an EvalReport as a console-friendly multi-line string. */
export function formatReport(report: EvalReport): string {
  const lines: string[] = [];
  lines.push(
    `Overall: ${report.passed}/${report.total} (${(report.passRate * 100).toFixed(1)}%)  p50=${report.latencyMsP50.toFixed(1)}ms p95=${report.latencyMsP95.toFixed(1)}ms`,
  );
  lines.push("");
  lines.push("By category:");
  for (const c of report.byCategory) {
    lines.push(
      `  ${c.category.padEnd(22)} ${c.passed}/${c.total}  (${(c.passRate * 100).toFixed(1)}%)`,
    );
  }
  const failures = report.results.filter((r) => !r.passed);
  if (failures.length > 0) {
    lines.push("");
    lines.push("Failures:");
    for (const f of failures) {
      lines.push(`  [${f.case.id}] "${f.case.query}"`);
      lines.push(`    → ${f.reason ?? "(no reason given)"}`);
    }
  }
  return lines.join("\n");
}

import { describe, expect, it } from "vitest";
import type { Classifier, SearchIntent } from "../types";
import { formatReport, runEval } from "../eval/runner";
import type { EvalCase } from "../eval/cases";

// Minimal fixture used to exercise the runner without depending on the full
// EVAL_CASES list. Each case here has a known, unambiguous expected intent
// so we can write a hand-crafted "perfect" classifier and a dumb one and
// verify the runner reports them correctly.
const TINY_CASES: EvalCase[] = [
  {
    id: "tiny-transfer",
    query: "Does ENG 111 transfer to GMU?",
    category: "transfer",
    expected: {
      type: "transfer",
      course: { prefix: "ENG", number: "111" },
      university: "gmu",
    },
  },
  {
    id: "tiny-prereqs",
    query: "prereqs for BIO 256",
    category: "prereqs",
    expected: {
      type: "prereqs",
      course: { prefix: "BIO", number: "256" },
    },
  },
  {
    id: "tiny-unknown",
    query: "what should I take",
    category: "vague",
    expected: { type: "unknown" },
  },
];

const BASE_ENRICHMENT = {
  secondaryIntent: null,
  studentSummary: "test summary",
  clarifyingQuestion: null,
  sourceCollege: null,
  suggestedFollowups: [] as string[],
};

const PERFECT_CLASSIFIER: Classifier = (q, _state) => {
  let intent: SearchIntent;
  if (q.includes("transfer")) {
    intent = {
      type: "transfer",
      course: { prefix: "ENG", number: "111" },
      subjectPrefix: null,
      university: "gmu",
    };
  } else if (q.includes("prereqs")) {
    intent = {
      type: "prereqs",
      course: { prefix: "BIO", number: "256" },
      direction: "forward",
    };
  } else {
    intent = { type: "unknown", raw: q };
  }
  return { intent, confidence: 1, ...BASE_ENRICHMENT };
};

const ALWAYS_UNKNOWN: Classifier = (q, _state) => ({
  intent: { type: "unknown", raw: q },
  confidence: 0,
  ...BASE_ENRICHMENT,
});

describe("runEval", () => {
  it("reports 100% pass for a classifier that gets everything right", async () => {
    const report = await runEval(PERFECT_CLASSIFIER, TINY_CASES);
    expect(report.total).toBe(3);
    expect(report.passed).toBe(3);
    expect(report.passRate).toBe(1);
  });

  it("reports partial pass for a stub classifier", async () => {
    const report = await runEval(ALWAYS_UNKNOWN, TINY_CASES);
    // Only the "tiny-unknown" case passes; transfer and prereqs fail.
    expect(report.passed).toBe(1);
    expect(report.total).toBe(3);
  });

  it("breaks down by category", async () => {
    const report = await runEval(PERFECT_CLASSIFIER, TINY_CASES);
    const transferStats = report.byCategory.find((c) => c.category === "transfer");
    expect(transferStats).toEqual({
      category: "transfer",
      total: 1,
      passed: 1,
      passRate: 1,
    });
  });

  it("captures latency percentiles", async () => {
    const report = await runEval(PERFECT_CLASSIFIER, TINY_CASES);
    expect(report.latencyMsP50).toBeGreaterThanOrEqual(0);
    expect(report.latencyMsP95).toBeGreaterThanOrEqual(report.latencyMsP50);
  });

  it("formatReport renders without throwing", async () => {
    const report = await runEval(ALWAYS_UNKNOWN, TINY_CASES);
    const text = formatReport(report);
    expect(text).toContain("Overall:");
    expect(text).toContain("By category:");
    expect(text).toContain("Failures:");
  });

  it("supports async classifiers", async () => {
    const asyncClassifier: Classifier = async (q, _state) => ({
      intent: { type: "unknown", raw: q },
      confidence: 0,
      ...BASE_ENRICHMENT,
    });
    const report = await runEval(asyncClassifier, TINY_CASES);
    expect(report.total).toBe(3);
  });
});

import { describe, expect, it } from "vitest";
import {
  parseAndValidateDraft,
  upsertPlan,
  planDedupKey,
  ANON_DRAFT_VERSION,
  ANON_DRAFT_MAX_AGE_MS,
  type AnonDraft,
  type AnonPlanDraft,
} from "@/lib/anon-draft";

const NOW = 1_750_000_000_000;
const plan = (over: Partial<AnonPlanDraft> = {}): AnonPlanDraft => ({
  state: "va",
  name: "My Plan",
  targetCourses: ["BIO 101"],
  kind: "semester",
  dedupKey: "va::BIO 101",
  ...over,
});
const draft = (over: Partial<AnonDraft> = {}): AnonDraft => ({
  v: ANON_DRAFT_VERSION,
  plans: [plan()],
  savedAt: NOW,
  ...over,
});

describe("parseAndValidateDraft", () => {
  it("returns a valid, current-version, fresh draft", () => {
    expect(parseAndValidateDraft(JSON.stringify(draft()), NOW)).toEqual(draft());
  });

  it("rejects a wrong-version payload", () => {
    expect(parseAndValidateDraft(JSON.stringify(draft({ v: 99 })), NOW)).toBeNull();
  });

  it("rejects a stale payload (> 30 days old)", () => {
    const old = draft({ savedAt: NOW - ANON_DRAFT_MAX_AGE_MS - 1 });
    expect(parseAndValidateDraft(JSON.stringify(old), NOW)).toBeNull();
  });

  it("accepts a payload exactly at the age boundary", () => {
    const edge = draft({ savedAt: NOW - ANON_DRAFT_MAX_AGE_MS });
    expect(parseAndValidateDraft(JSON.stringify(edge), NOW)).not.toBeNull();
  });

  it("rejects null / malformed / empty-plans", () => {
    expect(parseAndValidateDraft(null, NOW)).toBeNull();
    expect(parseAndValidateDraft("{not json", NOW)).toBeNull();
    expect(parseAndValidateDraft(JSON.stringify(draft({ plans: [] })), NOW)).toBeNull();
  });
});

describe("upsertPlan", () => {
  it("replaces an entry with the same dedupKey and keeps each entry's own state", () => {
    const a = plan({ dedupKey: "k1", state: "va" });
    const b = plan({ dedupKey: "k2", state: "tx" });
    const aPrime = plan({ dedupKey: "k1", state: "va", name: "Renamed" });
    const out = upsertPlan(upsertPlan([a], b), aPrime);
    expect(out).toHaveLength(2);
    expect(out.find((p) => p.dedupKey === "k1")?.name).toBe("Renamed");
    expect(out.find((p) => p.dedupKey === "k2")?.state).toBe("tx");
  });
});

describe("planDedupKey", () => {
  it("is stable regardless of target order", () => {
    expect(planDedupKey("va", ["B", "A"])).toBe(planDedupKey("va", ["A", "B"]));
  });
  it("differs by state and by target set", () => {
    expect(planDedupKey("va", ["A"])).not.toBe(planDedupKey("tx", ["A"]));
    expect(planDedupKey("va", ["A"])).not.toBe(planDedupKey("va", ["A", "B"]));
  });
});

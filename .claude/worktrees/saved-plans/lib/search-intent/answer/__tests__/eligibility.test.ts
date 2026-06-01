import { describe, expect, it } from "vitest";
import { lookupEligibility } from "../eligibility";
import type { EligibilityIntent } from "../../types";

// Eligibility runs against statically-bundled institutions data, so no
// mocking is needed — these are integration tests against real fixtures
// in data/{state}/institutions.json.

describe("lookupEligibility", () => {
  it("returns NoAnswer for veteran (no schema support)", async () => {
    const intent: EligibilityIntent = {
      type: "eligibility",
      topic: "veteran",
      age: null,
    };
    const result = await lookupEligibility(intent, "va");
    expect(result.type).toBe("none");
    if (result.type !== "none") return;
    expect(result.message).toMatch(/veteran/i);
  });

  it("returns NoAnswer for an invalid state slug", async () => {
    const intent: EligibilityIntent = {
      type: "eligibility",
      topic: "senior",
      age: 65,
    };
    const result = await lookupEligibility(intent, "xx");
    expect(result.type).toBe("none");
    if (result.type !== "none") return;
    expect(result.reason).toBe("no-state-data");
  });

  it("returns senior eligibility for VA with state-level summary", async () => {
    const intent: EligibilityIntent = {
      type: "eligibility",
      topic: "senior",
      age: 65,
    };
    const result = await lookupEligibility(intent, "va");
    if (result.type !== "eligibility") throw new Error("wrong type");
    expect(result.topic).toBe("senior");
    expect(result.state).toBe("va");
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.colleges.length).toBeGreaterThan(0);
    // Summary should reference age-65 user meeting the 60+ threshold.
    expect(result.summary.toLowerCase()).toMatch(/\b6[05]\b/);
  });

  it("notes when user's age is below the threshold", async () => {
    const intent: EligibilityIntent = {
      type: "eligibility",
      topic: "senior",
      age: 50,
    };
    const result = await lookupEligibility(intent, "va");
    if (result.type !== "eligibility") throw new Error("wrong type");
    expect(result.summary.toLowerCase()).toMatch(/below/);
  });

  it("returns audit-policy breakdown for topic 'audit'", async () => {
    const intent: EligibilityIntent = {
      type: "eligibility",
      topic: "audit",
      age: null,
    };
    const result = await lookupEligibility(intent, "va");
    if (result.type !== "eligibility") throw new Error("wrong type");
    expect(result.topic).toBe("audit");
    // Each college entry should have a cost + name.
    expect(result.colleges[0]).toHaveProperty("name");
    expect(result.colleges[0]).toHaveProperty("cost");
  });

  it("includes a SourceCitation pointing to institutions.json", async () => {
    const intent: EligibilityIntent = {
      type: "eligibility",
      topic: "senior",
      age: null,
    };
    const result = await lookupEligibility(intent, "va");
    if (result.type !== "eligibility") throw new Error("wrong type");
    expect(result.source.source).toBe("institutions");
    expect(result.source.reference).toBe("data/va/institutions.json");
  });

  it("includes senior followups for topic 'senior'", async () => {
    const result = await lookupEligibility(
      { type: "eligibility", topic: "senior", age: 65 },
      "va",
    );
    if (result.type !== "eligibility") throw new Error("wrong type");
    expect(result.followups).toContain("How do I register to audit a course?");
    expect(result.followups).toContain("What courses are available online?");
  });

  it("includes generic followups for topic 'audit'", async () => {
    const result = await lookupEligibility(
      { type: "eligibility", topic: "audit", age: null },
      "va",
    );
    if (result.type !== "eligibility") throw new Error("wrong type");
    expect(result.followups).toContain("What courses are available online?");
    expect(result.followups).toContain("How much does a course cost?");
  });
});

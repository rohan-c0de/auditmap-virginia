import { describe, expect, it, vi } from "vitest";

vi.mock("../transfer", () => ({
  lookupTransfer: vi.fn().mockResolvedValue({ type: "transfer", status: "yes" }),
}));
vi.mock("../prereqs", () => ({
  lookupPrereqs: vi.fn().mockResolvedValue({ type: "prereqs", status: "found" }),
}));
vi.mock("../eligibility", () => ({
  lookupEligibility: vi.fn().mockResolvedValue({ type: "eligibility", topic: "senior" }),
}));
vi.mock("../pathway", () => ({
  lookupPathway: vi.fn().mockResolvedValue({ type: "pathway", status: "no-data" }),
}));

import { lookupAnswer, lookupAnswers } from "..";
import { lookupTransfer } from "../transfer";
import { lookupPrereqs } from "../prereqs";
import { lookupEligibility } from "../eligibility";
import { lookupPathway } from "../pathway";
import type { ClassifiedIntent } from "../../types";

const BASE_CLASSIFICATION = {
  confidence: 0.95,
  studentSummary: "test",
  clarifyingQuestion: null,
  sourceCollege: null,
  suggestedFollowups: [],
};

describe("lookupAnswer dispatch", () => {
  it("dispatches transfer intents to lookupTransfer", async () => {
    await lookupAnswer(
      { type: "transfer", course: { prefix: "ENG", number: "111" }, subjectPrefix: null, university: "gmu" },
      "va",
    );
    expect(lookupTransfer).toHaveBeenCalled();
  });

  it("dispatches prereqs intents to lookupPrereqs", async () => {
    await lookupAnswer(
      { type: "prereqs", course: { prefix: "BIO", number: "256" }, direction: "forward" },
      "va",
    );
    expect(lookupPrereqs).toHaveBeenCalled();
  });

  it("dispatches pathway intents to lookupPathway", async () => {
    await lookupAnswer(
      { type: "pathway", university: "gmu", major: "computer-science", college: null, credential: null },
      "va",
    );
    expect(lookupPathway).toHaveBeenCalled();
  });

  it("dispatches eligibility intents to lookupEligibility", async () => {
    await lookupAnswer(
      { type: "eligibility", topic: "senior", age: null },
      "va",
    );
    expect(lookupEligibility).toHaveBeenCalled();
  });

  it("returns NoAnswer with intent-not-supported for course intents", async () => {
    const result = await lookupAnswer(
      { type: "course", keyword: "biology", filters: {} },
      "va",
    );
    expect(result.type).toBe("none");
    if (result.type !== "none") return;
    expect(result.reason).toBe("intent-not-supported");
  });

  it("returns NoAnswer with out-of-scope for unknown intents whose pathway lookup also misses", async () => {
    // Mocked lookupPathway returns no-data above, so the fallback short-circuits
    // back to the unknown out-of-scope copy.
    const result = await lookupAnswer(
      { type: "unknown", raw: "good professors" },
      "va",
    );
    expect(result.type).toBe("none");
    if (result.type !== "none") return;
    expect(result.reason).toBe("out-of-scope");
  });

  it("unknown intent with field-of-study-like raw query falls back to pathway lookup", async () => {
    const lookupPathwayMock = vi.mocked(lookupPathway);
    lookupPathwayMock.mockResolvedValueOnce({

      type: "pathway",
      status: "found-related",
      university: null,
      major: "premed",
      college: null,
      degreeRequirements: [
        {
          title: "Health Science (A.S.)",
          credential: "AS",
          total_credits: 60,
          gpa_minimum: 2.0,
          catalog_url: "",
          groups: [],
        },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const result = await lookupAnswer(
      { type: "unknown", raw: "premed" },
      "va",
    );

    expect(lookupPathwayMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "pathway", major: "premed" }),
      "va",
    );
    expect(result.type).toBe("pathway");
    if (result.type !== "pathway") return;
    expect(result.status).toBe("found-related");
  });

  it("unknown intent does NOT call pathway when raw doesn't look like a field of study", async () => {
    const lookupPathwayMock = vi.mocked(lookupPathway);
    lookupPathwayMock.mockClear();

    // Has digits → fails the field-of-study heuristic
    const result1 = await lookupAnswer(
      { type: "unknown", raw: "blah 123" },
      "va",
    );
    expect(result1.type).toBe("none");

    // Too many words
    const result2 = await lookupAnswer(
      { type: "unknown", raw: "the quick brown fox jumps" },
      "va",
    );
    expect(result2.type).toBe("none");

    // Stop-words only
    const result3 = await lookupAnswer(
      { type: "unknown", raw: "hi" },
      "va",
    );
    expect(result3.type).toBe("none");

    // The pathway lookup must NOT have been invoked for any of these
    expect(lookupPathwayMock).not.toHaveBeenCalled();
  });
});

describe("lookupAnswers (multi-intent)", () => {
  it("returns only primary when secondaryIntent is null", async () => {
    const classification: ClassifiedIntent = {
      ...BASE_CLASSIFICATION,
      intent: { type: "prereqs", course: { prefix: "BIO", number: "256" }, direction: "forward" },
      secondaryIntent: null,
    };
    const result = await lookupAnswers(classification, "va");
    expect(result.primary).toBeDefined();
    expect(result.secondary).toBeUndefined();
  });

  it("returns both when secondaryIntent is set", async () => {
    const classification: ClassifiedIntent = {
      ...BASE_CLASSIFICATION,
      intent: { type: "prereqs", course: { prefix: "ENG", number: "111" }, direction: "forward" },
      secondaryIntent: {
        type: "transfer",
        course: { prefix: "ENG", number: "111" },
        subjectPrefix: null,
        university: "gmu",
      },
    };
    const result = await lookupAnswers(classification, "va");
    expect(result.primary).toBeDefined();
    expect(result.secondary).toBeDefined();
  });

  it("filters out secondary when it's an intent-not-supported NoAnswer", async () => {
    // Course intent as secondary always returns intent-not-supported. The
    // wrapper should hide it — we don't want a confusing empty card.
    const classification: ClassifiedIntent = {
      ...BASE_CLASSIFICATION,
      intent: { type: "prereqs", course: { prefix: "ENG", number: "111" }, direction: "forward" },
      secondaryIntent: { type: "course", keyword: "biology", filters: {} },
    };
    const result = await lookupAnswers(classification, "va");
    expect(result.primary).toBeDefined();
    expect(result.secondary).toBeUndefined();
  });

  it("filters out secondary when it's an out-of-scope NoAnswer", async () => {
    const classification: ClassifiedIntent = {
      ...BASE_CLASSIFICATION,
      intent: { type: "prereqs", course: { prefix: "ENG", number: "111" }, direction: "forward" },
      secondaryIntent: { type: "unknown", raw: "good professors" },
    };
    const result = await lookupAnswers(classification, "va");
    expect(result.primary).toBeDefined();
    expect(result.secondary).toBeUndefined();
  });

  // ---- #266: bare-word course intents synthesize a pathway secondary -------

  it("bare-word course intent ('biology') synthesizes a pathway secondary", async () => {
    const lookupPathwayMock = vi.mocked(lookupPathway);
    lookupPathwayMock.mockResolvedValue({
      type: "pathway",
      status: "found-related",
      university: null,
      major: "biology",
      college: null,
      degreeRequirements: [
        {
          title: "Health Science (A.S.)",
          credential: "AS",
          total_credits: 60,
          gpa_minimum: 2.0,
          catalog_url: "",
          groups: [],
        },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const classification: ClassifiedIntent = {
      ...BASE_CLASSIFICATION,
      intent: { type: "course", keyword: "biology", filters: {} },
      secondaryIntent: null,
    };
    const result = await lookupAnswers(classification, "vt");

    // Pathway lookup must have been invoked with the synthesized intent
    expect(lookupPathwayMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "pathway", major: "biology" }),
      "vt",
    );
    // Primary stays course (intent-not-supported); secondary is the pathway result
    expect(result.primary.type).toBe("none");
    expect(result.secondary?.type).toBe("pathway");
  });

  it("course intent WITH a specific course code does NOT synthesize pathway", async () => {
    const lookupPathwayMock = vi.mocked(lookupPathway);
    lookupPathwayMock.mockClear();

    const classification: ClassifiedIntent = {
      ...BASE_CLASSIFICATION,
      intent: {
        type: "course",
        keyword: "biology",
        filters: { course: { prefix: "BIO", number: "101" } },
      },
      secondaryIntent: null,
    };
    await lookupAnswers(classification, "vt");
    expect(lookupPathwayMock).not.toHaveBeenCalled();
  });

  it("course intent WITH scheduling filters does NOT synthesize pathway", async () => {
    const lookupPathwayMock = vi.mocked(lookupPathway);
    lookupPathwayMock.mockClear();

    const classification: ClassifiedIntent = {
      ...BASE_CLASSIFICATION,
      intent: {
        type: "course",
        keyword: "biology",
        filters: { days: ["W"], mode: "online" },
      },
      secondaryIntent: null,
    };
    await lookupAnswers(classification, "vt");
    expect(lookupPathwayMock).not.toHaveBeenCalled();
  });

  it("synthetic pathway secondary that returns no-data is dropped", async () => {
    const lookupPathwayMock = vi.mocked(lookupPathway);
    lookupPathwayMock.mockResolvedValue({
      type: "pathway",
      status: "no-data",
      university: null,
      major: "biology",
      college: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const classification: ClassifiedIntent = {
      ...BASE_CLASSIFICATION,
      intent: { type: "course", keyword: "biology", filters: {} },
      secondaryIntent: null,
    };
    const result = await lookupAnswers(classification, "vt");
    // The pathway lookup ran...
    expect(lookupPathwayMock).toHaveBeenCalled();
    // ...but its empty result is hidden so we don't surface a confusing
    // "no degree info" card next to course search results.
    expect(result.secondary).toBeUndefined();
  });

  it("does NOT synthesize for non-field-like keywords (digits, too long, etc.)", async () => {
    const lookupPathwayMock = vi.mocked(lookupPathway);
    lookupPathwayMock.mockClear();

    const classification: ClassifiedIntent = {
      ...BASE_CLASSIFICATION,
      intent: {
        type: "course",
        keyword: "the quick brown fox jumps over",
        filters: {},
      },
      secondaryIntent: null,
    };
    await lookupAnswers(classification, "vt");
    expect(lookupPathwayMock).not.toHaveBeenCalled();
  });
});

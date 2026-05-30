import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  semanticResolveMajor,
  _resetSemanticCache,
} from "../semantic-resolve";

// Lightweight stand-in for the Anthropic SDK shape we use. Only the
// `messages.create` method is exercised in production code.
function makeFakeClient(text: string) {
  const create = vi.fn(async () => ({
    content: [{ type: "text", text }],
  }));
  const client = { messages: { create } } as unknown as NonNullable<
    Parameters<typeof semanticResolveMajor>[2]
  >["client"];
  return { client, create };
}

// Inline test vocab — keeps fixtures out of data/ where they'd ship to prod.
const FIXTURE_VOCAB = {
  state: "test-vocab",
  generated_at: "2026-05-07T00:00:00Z",
  subjects: [
    {
      prefix: "BIO",
      name: "Biology",
      course_count: 5,
      section_count: 50,
      colleges: ["fakecollege"],
      sample_titles: ["Biology I", "Biology II"],
    },
    {
      prefix: "HLT",
      name: "Health",
      course_count: 3,
      section_count: 20,
      colleges: ["fakecollege"],
      sample_titles: ["Intro to Health"],
    },
  ],
  program_titles: [
    "Behavioral Science (A.S.)",
    "Health Science (A.S.)",
    "Liberal Arts (A.A.)",
  ],
};

const STATE = "test-vocab";

beforeEach(() => {
  _resetSemanticCache();
});

describe("semanticResolveMajor", () => {
  it("returns null when no vocab is available (state has none on disk and none injected)", async () => {
    const { client } = makeFakeClient("{}");
    const result = await semanticResolveMajor("nonexistent-state", "biology", {
      client,
    });
    expect(result).toBeNull();
  });

  it("returns null when major term is empty", async () => {
    const { client } = makeFakeClient("{}");
    const result = await semanticResolveMajor(STATE, "", {
      client,
      vocab: FIXTURE_VOCAB,
    });
    expect(result).toBeNull();
  });

  it("calls the LLM and returns parsed program titles + subject prefixes", async () => {
    const { client, create } = makeFakeClient(
      JSON.stringify({
        program_titles: ["Health Science (A.S.)"],
        subject_prefixes: ["BIO", "HLT"],
        rationale: "premed = biology + health",
      }),
    );

    const result = await semanticResolveMajor(STATE, "premed", {
      client,
      vocab: FIXTURE_VOCAB,
    });

    expect(result).not.toBeNull();
    expect(result!.programTitles).toEqual(["Health Science (A.S.)"]);
    expect(result!.subjectPrefixes).toEqual(["BIO", "HLT"]);
    expect(result!.rationale).toContain("premed");
    expect(result!.source).toBe("llm");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("validates LLM-returned titles against the vocab (drops hallucinations)", async () => {
    const { client } = makeFakeClient(
      JSON.stringify({
        // First entry exists in vocab; second is invented.
        program_titles: [
          "Behavioral Science (A.S.)",
          "Underwater Basketweaving (A.A.S.)",
        ],
        subject_prefixes: ["BIO", "FAKE"], // FAKE not in vocab
        rationale: "test",
      }),
    );

    const result = await semanticResolveMajor(STATE, "test", {
      client,
      vocab: FIXTURE_VOCAB,
    });
    expect(result!.programTitles).toEqual(["Behavioral Science (A.S.)"]);
    expect(result!.subjectPrefixes).toEqual(["BIO"]);
  });

  it("strips code fences around JSON output", async () => {
    const { client } = makeFakeClient(
      "```json\n" +
        JSON.stringify({
          program_titles: ["Liberal Arts (A.A.)"],
          subject_prefixes: [],
          rationale: "fenced",
        }) +
        "\n```",
    );

    const result = await semanticResolveMajor(STATE, "humanities", {
      client,
      vocab: FIXTURE_VOCAB,
    });
    expect(result!.programTitles).toEqual(["Liberal Arts (A.A.)"]);
  });

  it("returns empty arrays (not null) when LLM returns malformed JSON", async () => {
    const { client } = makeFakeClient("not json at all");
    const result = await semanticResolveMajor(STATE, "test", {
      client,
      vocab: FIXTURE_VOCAB,
    });
    // Letting the caller distinguish "we tried but found nothing" from
    // "we couldn't try". null is reserved for the latter.
    expect(result).not.toBeNull();
    expect(result!.programTitles).toEqual([]);
    expect(result!.subjectPrefixes).toEqual([]);
  });

  it("returns null when the LLM call throws", async () => {
    const create = vi.fn(async () => {
      throw new Error("network down");
    });
    const client = {
      messages: { create },
    } as unknown as NonNullable<
      Parameters<typeof semanticResolveMajor>[2]
    >["client"];

    const result = await semanticResolveMajor(STATE, "test", {
      client,
      vocab: FIXTURE_VOCAB,
    });
    expect(result).toBeNull();
  });

  it("caches results — second call with the same term skips the LLM", async () => {
    const { client, create } = makeFakeClient(
      JSON.stringify({
        program_titles: ["Health Science (A.S.)"],
        subject_prefixes: [],
        rationale: "cached",
      }),
    );

    const first = await semanticResolveMajor(STATE, "premed", {
      client,
      vocab: FIXTURE_VOCAB,
    });
    const second = await semanticResolveMajor(STATE, "premed", {
      client,
      vocab: FIXTURE_VOCAB,
    });

    expect(first!.source).toBe("llm");
    expect(second!.source).toBe("cache");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("cache key is case-insensitive and whitespace-normalized", async () => {
    const { client, create } = makeFakeClient(
      JSON.stringify({
        program_titles: [],
        subject_prefixes: [],
        rationale: "",
      }),
    );

    await semanticResolveMajor(STATE, "Computer Science", {
      client,
      vocab: FIXTURE_VOCAB,
    });
    await semanticResolveMajor(STATE, "  computer  science  ", {
      client,
      vocab: FIXTURE_VOCAB,
    });
    await semanticResolveMajor(STATE, "COMPUTER SCIENCE", {
      client,
      vocab: FIXTURE_VOCAB,
    });

    expect(create).toHaveBeenCalledTimes(1);
  });
});

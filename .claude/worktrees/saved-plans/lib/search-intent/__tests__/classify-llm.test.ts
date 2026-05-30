import { describe, expect, it, vi } from "vitest";

// State-context lookups for the classifier hit Supabase in production. Tests
// run with a dummy Supabase URL, so the real calls hang. Stub them at module
// boundary — these helpers don't change classifier output, only the prompt
// grounding (which the fakeClient ignores).
vi.mock("../../courses", () => ({
  getDistinctSubjects: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../terms", () => ({
  getCurrentTerm: vi.fn().mockResolvedValue("2026SP"),
}));

import { llmClassifier, toClassifiedIntent } from "../classify-llm";
import type { ClassifierToolInput } from "../prompt";

// A "fake Anthropic" — only implements the surface our classifier touches.
function fakeClient(toolInput: Partial<ClassifierToolInput>) {
  const create = vi.fn().mockResolvedValue({
    content: [
      {
        type: "tool_use",
        name: "classify_intent",
        input: {
          confidence: 0.95,
          reasoning: "test reasoning",
          student_summary: "You're asking a question about your coursework.",
          clarifying_question: null,
          source_college: null,
          suggested_followups: ["What are the prereqs?", "Are there online sections?"],
          ...toolInput,
        },
      },
    ],
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { messages: { create } } as any;
}

describe("llmClassifier", () => {
  it("converts a transfer tool call into a TransferIntent", async () => {
    const classifier = llmClassifier({
      client: fakeClient({
        type: "transfer",
        course_prefix: "ENG",
        course_number: "111",
        university: "gmu",
      }),
    });
    const result = await classifier("Does ENG 111 transfer to GMU?", "va");
    expect(result.intent).toEqual({
      type: "transfer",
      course: { prefix: "ENG", number: "111" },
      subjectPrefix: null,
      university: "gmu",
    });
    expect(result.confidence).toBe(0.95);
  });

  it("extracts subjectPrefix when course_prefix set but course_number absent", async () => {
    const classifier = llmClassifier({
      client: fakeClient({
        type: "transfer",
        course_prefix: "eng",
        course_number: null,
        university: "uva",
      }),
    });
    const result = await classifier("English courses that transfer to UVA", "va");
    expect(result.intent).toEqual({
      type: "transfer",
      course: null,
      subjectPrefix: "ENG",
      university: "uva",
    });
  });

  it("uppercases course prefix even when LLM returned lowercase", async () => {
    const classifier = llmClassifier({
      client: fakeClient({
        type: "prereqs",
        course_prefix: "bio",
        course_number: "256",
      }),
    });
    const result = await classifier("prereqs for bio 256", "va");
    expect(result.intent).toEqual({
      type: "prereqs",
      course: { prefix: "BIO", number: "256" },
      direction: "forward",
    });
  });

  it("extracts inverse direction for prereqs", async () => {
    const classifier = llmClassifier({
      client: fakeClient({
        type: "prereqs",
        course_prefix: "ENG",
        course_number: "111",
        prereq_direction: "inverse",
      }),
    });
    const result = await classifier("what can I take after ENG 111?", "va");
    expect(result.intent).toEqual({
      type: "prereqs",
      course: { prefix: "ENG", number: "111" },
      direction: "inverse",
    });
  });

  it("preserves a course-number string with leading zero", async () => {
    const classifier = llmClassifier({
      client: fakeClient({
        type: "course",
        course_prefix: "ENGL",
        course_number: "0095",
      }),
    });
    const result = await classifier("ENGL 0095", "va");
    if (result.intent.type !== "course") throw new Error("wrong type");
    expect(result.intent.filters.course?.number).toBe("0095");
  });

  it("clamps an out-of-range confidence into [0,1]", async () => {
    const classifier = llmClassifier({
      client: fakeClient({
        type: "unknown",
        confidence: 1.5,
      }),
    });
    const result = await classifier("???", "va");
    expect(result.confidence).toBe(1);
  });

  it("falls back to confidence=0 if LLM returned NaN", async () => {
    const classifier = llmClassifier({
      client: fakeClient({
        type: "unknown",
        confidence: Number.NaN,
      }),
    });
    const result = await classifier("???", "va");
    expect(result.confidence).toBe(0);
  });

  it("defaults eligibility topic to 'senior' if LLM omitted it", async () => {
    const classifier = llmClassifier({
      client: fakeClient({
        type: "eligibility",
        // topic intentionally absent
        age: 65,
      }),
    });
    const result = await classifier("free college if I'm 65", "va");
    if (result.intent.type !== "eligibility") throw new Error("wrong type");
    expect(result.intent.topic).toBe("senior");
    expect(result.intent.age).toBe(65);
  });

  it("expands course filters into the CourseIntent shape", async () => {
    const classifier = llmClassifier({
      client: fakeClient({
        type: "course",
        keyword: "biology",
        mode: "online",
        time_of_day: "evening",
        days: ["S", "U"],
        term: "Summer 2026",
      }),
    });
    const result = await classifier("online evening biology weekend summer 2026", "va");
    if (result.intent.type !== "course") throw new Error("wrong type");
    expect(result.intent.filters).toEqual({
      course: undefined,
      mode: "online",
      timeOfDay: "evening",
      days: ["S", "U"],
      term: "Summer 2026",
    });
    expect(result.intent.keyword).toBe("biology");
  });

  it("converts a pathway tool call into a PathwayIntent", async () => {
    const classifier = llmClassifier({
      client: fakeClient({
        type: "pathway",
        university: "gmu",
        major: "computer-science",
      }),
    });
    const result = await classifier("what do I need to transfer to GMU for CS?", "va");
    expect(result.intent).toEqual({
      type: "pathway",
      university: "gmu",
      major: "computer-science",
      college: null,
      credential: null,
    });
  });

  it("handles pathway with no major", async () => {
    const classifier = llmClassifier({
      client: fakeClient({
        type: "pathway",
        university: "vt",
      }),
    });
    const result = await classifier("courses needed to transfer to Virginia Tech", "va");
    expect(result.intent).toEqual({
      type: "pathway",
      university: "vt",
      major: null,
      college: null,
      credential: null,
    });
  });

  it("represents unknown intents with the raw query echoed back", async () => {
    const classifier = llmClassifier({
      client: fakeClient({ type: "unknown", confidence: 0.2 }),
    });
    const result = await classifier("good professors", "va");
    expect(result.intent).toEqual({ type: "unknown", raw: "good professors" });
  });

  it("classifies 'courses that do require prerequisites' as a course search (not inverted)", async () => {
    const classifier = llmClassifier({
      client: fakeClient({
        type: "course",
        keyword: "history",
        student_summary: "You're looking for history courses that have prerequisites.",
      }),
    });
    const result = await classifier(
      "are there any history courses that do require any pre requisit?",
      "ga",
    );
    expect(result.intent.type).toBe("course");
    if (result.intent.type !== "course") throw new Error("wrong type");
    expect(result.intent.keyword).toBe("history");
    expect(result.studentSummary).toContain("have prerequisites");
    expect(result.studentSummary).not.toContain("don't");
  });

  it("throws if the LLM did not call the classify_intent tool", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "Sorry I cannot do that." }],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const badClient = { messages: { create } } as any;
    const classifier = llmClassifier({ client: badClient });
    await expect(classifier("anything", "va")).rejects.toThrow(/did not return a classify_intent/);
  });
});

describe("toClassifiedIntent", () => {
  it("ignores course fields when type is 'unknown'", () => {
    const result = toClassifiedIntent("test", {
      type: "unknown",
      course_prefix: "ENG",
      course_number: "111",
      confidence: 0.1,
      reasoning: "x",
      student_summary: "You're asking an unknown question.",
      suggested_followups: [],
    });
    expect(result.intent).toEqual({ type: "unknown", raw: "test" });
  });

  it("returns null course when one of prefix/number is missing", () => {
    const result = toClassifiedIntent("test", {
      type: "transfer",
      course_prefix: "ENG",
      course_number: null,
      confidence: 0.5,
      reasoning: "x",
      student_summary: "You're asking about transfer.",
      suggested_followups: [],
    });
    if (result.intent.type !== "transfer") throw new Error("wrong type");
    expect(result.intent.course).toBeNull();
  });

  it("maps new enrichment fields onto ClassifiedIntent", () => {
    const result = toClassifiedIntent("Does ENG 111 transfer to GMU? I'm at NOVA.", {
      type: "transfer",
      course_prefix: "ENG",
      course_number: "111",
      university: "gmu",
      confidence: 0.6,
      reasoning: "low confidence",
      student_summary: "You're asking whether ENG 111 transfers to George Mason.",
      clarifying_question: "Which campus of NOVA are you attending?",
      source_college: "nova",
      suggested_followups: ["What are the prereqs for ENG 111?", "Does ENG 111 transfer to VCU?"],
    });
    expect(result.studentSummary).toBe("You're asking whether ENG 111 transfers to George Mason.");
    expect(result.clarifyingQuestion).toBe("Which campus of NOVA are you attending?");
    expect(result.sourceCollege).toBe("nova");
    expect(result.suggestedFollowups).toEqual(["What are the prereqs for ENG 111?", "Does ENG 111 transfer to VCU?"]);
  });

  it("defaults clarifyingQuestion to null and suggestedFollowups to [] when LLM omits them", () => {
    const result = toClassifiedIntent("test", {
      type: "unknown",
      confidence: 0.9,
      reasoning: "x",
      student_summary: "You're asking something unclear.",
    });
    expect(result.clarifyingQuestion).toBeNull();
    expect(result.sourceCollege).toBeNull();
    expect(result.suggestedFollowups).toEqual([]);
  });

  it("leaves secondaryIntent null when the LLM omits secondary", () => {
    const result = toClassifiedIntent("Does ENG 111 transfer to GMU?", {
      type: "transfer",
      course_prefix: "ENG",
      course_number: "111",
      university: "gmu",
      confidence: 0.95,
      reasoning: "x",
      student_summary: "x",
    });
    expect(result.secondaryIntent).toBeNull();
  });

  it("populates secondaryIntent when LLM emits a secondary block", () => {
    const result = toClassifiedIntent(
      "What are the prereqs for ENG 111 and does it transfer to GMU?",
      {
        type: "prereqs",
        course_prefix: "ENG",
        course_number: "111",
        confidence: 0.95,
        reasoning: "two intents",
        student_summary: "You're asking about prereqs and transfer for ENG 111.",
        secondary: {
          type: "transfer",
          course_prefix: "ENG",
          course_number: "111",
          university: "gmu",
        },
      },
    );
    expect(result.intent).toEqual({
      type: "prereqs",
      course: { prefix: "ENG", number: "111" },
      direction: "forward",
    });
    expect(result.secondaryIntent).toEqual({
      type: "transfer",
      course: { prefix: "ENG", number: "111" },
      subjectPrefix: null,
      university: "gmu",
    });
  });

  it("uppercases secondary course prefix", () => {
    const result = toClassifiedIntent("test", {
      type: "transfer",
      course_prefix: "ENG",
      course_number: "111",
      university: "gmu",
      confidence: 0.95,
      reasoning: "x",
      student_summary: "x",
      secondary: {
        type: "prereqs",
        course_prefix: "bio",
        course_number: "256",
      },
    });
    if (result.secondaryIntent?.type !== "prereqs") throw new Error("wrong type");
    expect(result.secondaryIntent.course?.prefix).toBe("BIO");
  });
});

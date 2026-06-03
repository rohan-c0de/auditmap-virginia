import { afterEach, describe, expect, it, vi } from "vitest";

// buildUserMessage hits Supabase for prefix grounding in prod; stub like the
// classify-llm tests so it doesn't hang under the dummy test env.
vi.mock("../../courses", () => ({ getDistinctSubjects: vi.fn().mockResolvedValue([]) }));
vi.mock("../../terms", () => ({ getCurrentTerm: vi.fn().mockResolvedValue("2026SP") }));

import { localClassifier } from "../classify-local";
import { allFieldsRequired, type JsonChatConfig } from "../../llm/json-chat";
import { CLASSIFY_TOOL } from "../prompt";

const TOOL_INPUT = {
  type: "transfer",
  course_prefix: "ENG",
  course_number: "111",
  university: "gmu",
  confidence: 0.96,
  reasoning: "course + destination",
  student_summary: "You're asking whether ENG 111 transfers to George Mason.",
  clarifying_question: null,
  source_college: null,
  suggested_followups: ["Online ENG courses"],
  secondary: null,
};

function mockFetch(payload: object, ok = true) {
  const fn = vi.fn().mockResolvedValue({
    ok,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

const CF: JsonChatConfig = {
  wire: "openai",
  baseUrl: "https://api.cloudflare.com/client/v4/accounts/acct/ai/v1",
  apiKey: "tok",
  model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
};

describe("allFieldsRequired", () => {
  it("forces every entity field into the top-level required list", () => {
    const schema = allFieldsRequired(CLASSIFY_TOOL.input_schema) as {
      required: string[];
    };
    for (const f of ["course_prefix", "course_number", "university", "mode", "days", "age", "topic"]) {
      expect(schema.required).toContain(f);
    }
  });
  it("does not mutate the source schema", () => {
    const before = JSON.stringify(CLASSIFY_TOOL.input_schema.required);
    allFieldsRequired(CLASSIFY_TOOL.input_schema);
    expect(JSON.stringify(CLASSIFY_TOOL.input_schema.required)).toBe(before);
  });
});

describe("localClassifier (openai wire — Cloudflare/Groq)", () => {
  it("POSTs /chat/completions with response_format and maps the result", async () => {
    const fetchFn = mockFetch({ choices: [{ message: { content: JSON.stringify(TOOL_INPUT) } }] });
    const result = await localClassifier(CF)("does ENG 111 transfer to GMU?", "va");

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`${CF.baseUrl}/chat/completions`);
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe(CF.model);
    expect(body.temperature).toBe(0);
    expect(body.response_format.type).toBe("json_schema");
    // the entity-required fix is applied to the schema we send
    expect(body.response_format.json_schema.schema.required).toContain("course_prefix");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer tok" });

    expect(result.intent).toEqual({
      type: "transfer",
      course: { prefix: "ENG", number: "111" },
      subjectPrefix: null,
      courseTitle: null,
      university: "gmu",
    });
    expect(result.studentSummary).toContain("ENG 111");
  });

  it("handles Cloudflare's already-parsed object content (not a JSON string)", async () => {
    // Cloudflare Workers AI json_schema mode returns message.content as an
    // OBJECT, unlike OpenAI/Groq which return a JSON string. Both must work.
    mockFetch({ choices: [{ message: { content: TOOL_INPUT } }] });
    const result = await localClassifier(CF)("does ENG 111 transfer to GMU?", "va");
    expect(result.intent).toEqual({
      type: "transfer",
      course: { prefix: "ENG", number: "111" },
      subjectPrefix: null,
      courseTitle: null,
      university: "gmu",
    });
  });

  it("strips a ```json fence when a model wraps its output", async () => {
    mockFetch({
      choices: [{ message: { content: "```json\n" + JSON.stringify(TOOL_INPUT) + "\n```" } }],
    });
    const result = await localClassifier(CF)("does ENG 111 transfer to GMU?", "va");
    expect(result.intent.type).toBe("transfer");
  });
});

describe("localClassifier (ollama wire)", () => {
  it("POSTs the native /api/chat with `format` and reads message.content", async () => {
    const fetchFn = mockFetch({ message: { content: JSON.stringify(TOOL_INPUT) } });
    const cfg: JsonChatConfig = { wire: "ollama", baseUrl: "http://127.0.0.1:11434", model: "qwen2.5:7b-instruct" };
    const result = await localClassifier(cfg)("does ENG 111 transfer to GMU?", "va");

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.format.required).toContain("course_prefix"); // native schema enforcement
    expect(body.response_format).toBeUndefined();
    expect(result.intent.type).toBe("transfer");
  });
});

describe("localClassifier error handling", () => {
  it("throws on a non-OK response (so the route returns 503 → UI falls back)", async () => {
    mockFetch({ errors: [{ message: "bad token" }] }, false);
    await expect(localClassifier(CF)("anything", "va")).rejects.toThrow(/json-chat openai/);
  });
});

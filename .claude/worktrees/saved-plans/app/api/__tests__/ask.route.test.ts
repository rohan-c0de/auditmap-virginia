import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Answer } from "@/lib/search-intent/answer";

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({ allowed: true, remaining: 99 })),
  getClientKey: vi.fn(() => "ip:1.2.3.4"),
}));
vi.mock("@/lib/search-intent/classify", () => ({
  classifyQuery: vi.fn(),
}));
vi.mock("@/lib/search-intent/answer", () => ({
  lookupAnswer: vi.fn(),
  lookupAnswers: vi.fn(),
}));

import { GET } from "../[state]/ask/route";
import { rateLimit } from "@/lib/rate-limit";
import { classifyQuery } from "@/lib/search-intent/classify";
import { lookupAnswer, lookupAnswers } from "@/lib/search-intent/answer";

const rateLimitMock = vi.mocked(rateLimit);
const classifyMock = vi.mocked(classifyQuery);
const lookupAnswerMock = vi.mocked(lookupAnswer);
const lookupAnswersMock = vi.mocked(lookupAnswers);

function makeRequest(state: string, query: Record<string, string>): {
  req: NextRequest;
  ctx: { params: Promise<{ state: string }> };
} {
  const url = new URL(`http://localhost/api/${state}/ask`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return {
    req: new NextRequest(url),
    ctx: { params: Promise.resolve({ state }) },
  };
}

beforeEach(() => {
  rateLimitMock.mockReset();
  rateLimitMock.mockReturnValue({ allowed: true, remaining: 99 });
  classifyMock.mockReset();
  lookupAnswerMock.mockReset();
  lookupAnswersMock.mockReset();
});

describe("GET /api/[state]/ask", () => {
  it("returns 404 for an unknown state", async () => {
    const { req, ctx } = makeRequest("xx", { q: "Does ENG 111 transfer to GMU?" });
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
    expect(classifyMock).not.toHaveBeenCalled();
  });

  it("returns 429 when rate-limited and never calls the classifier", async () => {
    rateLimitMock.mockReturnValueOnce({ allowed: false, remaining: 0 });
    const { req, ctx } = makeRequest("va", { q: "Does ENG 111 transfer to GMU?" });
    const res = await GET(req, ctx);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(classifyMock).not.toHaveBeenCalled();
  });

  it("returns 400 when q is missing", async () => {
    const { req, ctx } = makeRequest("va", {});
    const res = await GET(req, ctx);
    expect(res.status).toBe(400);
    expect(classifyMock).not.toHaveBeenCalled();
  });

  it("returns 400 when q is shorter than 2 chars", async () => {
    const { req, ctx } = makeRequest("va", { q: "a" });
    const res = await GET(req, ctx);
    expect(res.status).toBe(400);
    expect(classifyMock).not.toHaveBeenCalled();
  });

  it("returns 400 when q exceeds 500 chars", async () => {
    const { req, ctx } = makeRequest("va", { q: "x".repeat(501) });
    const res = await GET(req, ctx);
    expect(res.status).toBe(400);
    expect(classifyMock).not.toHaveBeenCalled();
  });

  it("returns 200 with classification and answer on the happy path", async () => {
    const classification = {
      intent: {
        type: "transfer" as const,
        course: { prefix: "ENG", number: "111" },
        subjectPrefix: null,
        university: "gmu",
      },
      secondaryIntent: null,
      confidence: 0.95,
      reasoning: "test",
      studentSummary: "You're asking whether ENG 111 transfers to George Mason.",
      clarifyingQuestion: null,
      sourceCollege: null,
      suggestedFollowups: ["What are the prereqs for ENG 111?"],
    };
    const answer: Answer = {
      type: "transfer",
      status: "yes",
      course: { prefix: "ENG", number: "111" },
      university: { slug: "gmu", name: "George Mason University" },
      equivalency: {
        univ_course: "ENGH 101",
        univ_title: "Composition",
        univ_credits: "3",
        is_elective: false,
        no_credit: false,
        notes: "",
      },
      source: {
        source: "transfer-equiv",
        state: "va",
        reference: "data/va/transfer-equiv.json",
      },
    };
    classifyMock.mockResolvedValue(classification);
    lookupAnswersMock.mockResolvedValue({ primary: answer });

    const { req, ctx } = makeRequest("va", { q: "Does ENG 111 transfer to GMU?" });
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ classification, answer });
  });

  it("passes the user's state into lookupAnswers (not a hardcoded one)", async () => {
    const classification = {
      intent: { type: "unknown" as const, raw: "x" },
      secondaryIntent: null,
      confidence: 0.1,
      studentSummary: "test",
      clarifyingQuestion: null,
      sourceCollege: null,
      suggestedFollowups: [],
    };
    classifyMock.mockResolvedValue(classification);
    lookupAnswersMock.mockResolvedValue({
      primary: { type: "none", reason: "out-of-scope", message: "x" },
    });
    const { req, ctx } = makeRequest("nc", { q: "asdf" });
    await GET(req, ctx);
    expect(lookupAnswersMock).toHaveBeenCalledWith(classification, "nc");
  });

  it("returns 503 when the classifier throws", async () => {
    classifyMock.mockRejectedValue(new Error("Anthropic API down"));
    const { req, ctx } = makeRequest("va", { q: "Does ENG 111 transfer to GMU?" });
    const res = await GET(req, ctx);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/Classifier service unavailable/);
    expect(body.cause).toBe("Anthropic API down");
    expect(lookupAnswersMock).not.toHaveBeenCalled();
  });

  it("sets Cache-Control + X-RateLimit-Remaining headers on 200 responses", async () => {
    classifyMock.mockResolvedValue({
      intent: { type: "unknown", raw: "x" },
      secondaryIntent: null,
      confidence: 0.1,
      studentSummary: "test",
      clarifyingQuestion: null,
      sourceCollege: null,
      suggestedFollowups: [],
    });
    lookupAnswersMock.mockResolvedValue({
      primary: { type: "none", reason: "out-of-scope", message: "x" },
    });
    rateLimitMock.mockReturnValueOnce({ allowed: true, remaining: 12 });
    const { req, ctx } = makeRequest("va", { q: "anything" });
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toMatch(/max-age=300/);
    expect(res.headers.get("Cache-Control")).toMatch(/s-maxage=3600/);
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("12");
  });

  it("trims whitespace from q before length validation", async () => {
    classifyMock.mockResolvedValue({
      intent: { type: "unknown", raw: "x" },
      secondaryIntent: null,
      confidence: 0,
      studentSummary: "test",
      clarifyingQuestion: null,
      sourceCollege: null,
      suggestedFollowups: [],
    });
    lookupAnswersMock.mockResolvedValue({
      primary: { type: "none", reason: "out-of-scope", message: "x" },
    });
    // 10 spaces + "ENG 111" + 5 spaces — trims to 7 chars, valid
    const { req, ctx } = makeRequest("va", { q: "          ENG 111     " });
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    expect(classifyMock).toHaveBeenCalledWith("ENG 111", "va");
  });
});

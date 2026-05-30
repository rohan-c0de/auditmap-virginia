import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/schedule", () => ({
  generateSchedules: vi.fn(),
}));
vi.mock("@/lib/transfer-scoped", () => ({
  buildTransferLookupForSubjects: vi.fn(),
}));
vi.mock("@/lib/institutions", () => ({
  loadInstitutions: vi.fn(() => []),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({ allowed: true, remaining: 19 })),
  getClientKey: vi.fn(() => "ip:1.2.3.4"),
}));

import { POST } from "../[state]/schedule/build/route";
import { generateSchedules } from "@/lib/schedule";
import { rateLimit } from "@/lib/rate-limit";

const generateMock = vi.mocked(generateSchedules);
const rateLimitMock = vi.mocked(rateLimit);

function makeRequest(state: string, body: unknown): {
  req: Request;
  ctx: { params: Promise<{ state: string }> };
} {
  return {
    req: new Request(`http://localhost/api/${state}/schedule/build`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    ctx: { params: Promise.resolve({ state }) },
  };
}

const validBody = {
  subjects: ["ENG 111"],
  daysAvailable: ["M", "W", "F"],
  maxCourses: 2,
};

beforeEach(() => {
  generateMock.mockReset();
  generateMock.mockResolvedValue({
    schedules: [],
    meta: {
      candidateSections: 0,
      candidateCourses: 0,
      combinationsEvaluated: 0,
      timeTakenMs: 1,
    },
  });
  rateLimitMock.mockReset();
  rateLimitMock.mockReturnValue({ allowed: true, remaining: 19 });
});

describe("POST /api/[state]/schedule/build", () => {
  it("returns 404 for an unknown state", async () => {
    const { req, ctx } = makeRequest("xx", validBody);
    const res = await POST(req, ctx);
    expect(res.status).toBe(404);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("returns 429 when rate-limited", async () => {
    rateLimitMock.mockReturnValueOnce({ allowed: false, remaining: 0 });
    const { req, ctx } = makeRequest("va", validBody);
    const res = await POST(req, ctx);
    expect(res.status).toBe(429);
  });

  it("returns 400 when subjects array is missing", async () => {
    const { req, ctx } = makeRequest("va", { daysAvailable: ["M"], maxCourses: 1 });
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
  });

  it("returns 400 when subjects is empty", async () => {
    const { req, ctx } = makeRequest("va", { ...validBody, subjects: [] });
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
  });

  it("returns 400 when a subject is not a string", async () => {
    const { req, ctx } = makeRequest("va", { ...validBody, subjects: [123] });
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
  });

  it("returns 400 when daysAvailable is missing", async () => {
    const { req, ctx } = makeRequest("va", { subjects: ["ENG 111"], maxCourses: 1 });
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
  });

  it("returns 400 when daysAvailable contains an invalid day code", async () => {
    const { req, ctx } = makeRequest("va", { ...validBody, daysAvailable: ["Mo"] });
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
  });

  it("returns 400 when maxCourses is outside 1-5", async () => {
    const { req, ctx } = makeRequest("va", { ...validBody, maxCourses: 6 });
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
  });

  it("returns 200 with the schedule result on a valid request", async () => {
    const { req, ctx } = makeRequest("va", validBody);
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    expect(generateMock).toHaveBeenCalledOnce();
    const body = await res.json();
    expect(body.meta).toBeDefined();
  });

  it("forwards the state slug to generateSchedules", async () => {
    const { req, ctx } = makeRequest("nc", validBody);
    await POST(req, ctx);
    // generateSchedules signature: (request, institutions, state, ...)
    expect(generateMock.mock.calls[0][2]).toBe("nc");
  });

  it("returns 500 when the body cannot be parsed as JSON", async () => {
    const req = new Request("http://localhost/api/va/schedule/build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const ctx = { params: Promise.resolve({ state: "va" }) };
    const res = await POST(req, ctx);
    expect(res.status).toBe(500);
  });
});

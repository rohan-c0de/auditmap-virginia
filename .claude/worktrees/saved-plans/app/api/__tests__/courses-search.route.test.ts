import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock all heavy dependencies before importing the route. `vi.mock` is
// hoisted so this runs before the route module is evaluated.
vi.mock("@/lib/courses-search", () => ({
  searchCoursesAcrossColleges: vi.fn(),
}));
vi.mock("@/lib/institutions", () => ({
  loadInstitutions: vi.fn(() => []),
}));
vi.mock("@/lib/terms", () => ({
  getCurrentTerm: vi.fn(async () => "2026SP"),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({ allowed: true, remaining: 99 })),
  getClientKey: vi.fn(() => "ip:1.2.3.4"),
}));

import { GET } from "../[state]/courses/search/route";
import { searchCoursesAcrossColleges } from "@/lib/courses-search";
import { rateLimit } from "@/lib/rate-limit";

const searchMock = vi.mocked(searchCoursesAcrossColleges);
const rateLimitMock = vi.mocked(rateLimit);

function makeRequest(state: string, query: Record<string, string>): {
  req: NextRequest;
  ctx: { params: Promise<{ state: string }> };
} {
  const url = new URL(`http://localhost/api/${state}/courses/search`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return {
    req: new NextRequest(url),
    ctx: { params: Promise.resolve({ state }) },
  };
}

beforeEach(() => {
  searchMock.mockReset();
  searchMock.mockResolvedValue({
    courses: [],
    totalCourses: 0,
    totalSections: 0,
    totalColleges: 0,
  });
  rateLimitMock.mockReset();
  rateLimitMock.mockReturnValue({ allowed: true, remaining: 99 });
});

describe("GET /api/[state]/courses/search", () => {
  it("returns 404 for an unknown state", async () => {
    const { req, ctx } = makeRequest("xx", { q: "ENG 111" });
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("returns 400 when q is missing", async () => {
    const { req, ctx } = makeRequest("va", {});
    const res = await GET(req, ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when q is shorter than 2 chars", async () => {
    const { req, ctx } = makeRequest("va", { q: "a" });
    const res = await GET(req, ctx);
    expect(res.status).toBe(400);
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("returns 400 for an unknown timeOfDay value", async () => {
    const { req, ctx } = makeRequest("va", { q: "ENG 111", timeOfDay: "midnight" });
    const res = await GET(req, ctx);
    expect(res.status).toBe(400);
  });

  it("returns 429 when the rate limiter denies the request", async () => {
    rateLimitMock.mockReturnValueOnce({ allowed: false, remaining: 0 });
    const { req, ctx } = makeRequest("va", { q: "ENG 111" });
    const res = await GET(req, ctx);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("clamps limit to 100 when callers pass a larger value", async () => {
    const { req, ctx } = makeRequest("va", { q: "ENG 111", limit: "999" });
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    // searchCoursesAcrossColleges receives `limit` as the 5th positional arg.
    expect(searchMock.mock.calls[0][4]).toBe(100);
  });

  it("clamps negative limit to 1", async () => {
    const { req, ctx } = makeRequest("va", { q: "ENG 111", limit: "-5" });
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    expect(searchMock.mock.calls[0][4]).toBe(1);
  });

  it("falls back to default limit (10) when parseInt yields 0 or NaN", async () => {
    // `parseInt("0") || 10` short-circuits to 10 because 0 is falsy. Same
    // happens for non-numeric input. This documents that quirk.
    const { req, ctx } = makeRequest("va", { q: "ENG 111", limit: "0" });
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    expect(searchMock.mock.calls[0][4]).toBe(10);
  });

  it("parses comma-separated days param", async () => {
    const { req, ctx } = makeRequest("va", { q: "ENG 111", days: "M,W,F" });
    await GET(req, ctx);
    // 4th positional arg is the filters object.
    expect(searchMock.mock.calls[0][3]).toMatchObject({ days: ["M", "W", "F"] });
  });

  it("falls back to the legacy single 'day' param when 'days' is missing", async () => {
    const { req, ctx } = makeRequest("va", { q: "ENG 111", day: "Tu" });
    await GET(req, ctx);
    expect(searchMock.mock.calls[0][3]).toMatchObject({ days: ["Tu"] });
  });

  it("forwards the state slug to searchCoursesAcrossColleges", async () => {
    const { req, ctx } = makeRequest("nc", { q: "BIO" });
    await GET(req, ctx);
    expect(searchMock.mock.calls[0][6]).toBe("nc");
  });

  it("returns 200 with the search result body on a valid request", async () => {
    searchMock.mockResolvedValueOnce({
      courses: [{ prefix: "ENG", number: "111" } as never],
      totalCourses: 1,
      totalSections: 5,
      totalColleges: 3,
    });
    const { req, ctx } = makeRequest("va", { q: "ENG 111" });
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalSections).toBe(5);
    expect(body.totalColleges).toBe(3);
  });
});

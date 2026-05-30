import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/transfer", () => ({
  buildTransferLookup: vi.fn(),
  getUniversities: vi.fn(),
}));

beforeEach(async () => {
  // Module-level `cachedResponses` persists across imports of the route
  // module — so a previous test's data would leak into the next via cache.
  // Reset modules to give each test a fresh route + fresh cache.
  vi.resetModules();
  const transfer = await import("@/lib/transfer");
  vi.mocked(transfer.buildTransferLookup).mockReset();
  vi.mocked(transfer.getUniversities).mockReset();
});

function makeRequest(state: string): {
  req: NextRequest;
  ctx: { params: Promise<{ state: string }> };
} {
  return {
    req: new NextRequest(`http://localhost/api/${state}/transfer/lookup`),
    ctx: { params: Promise.resolve({ state }) },
  };
}

describe("GET /api/[state]/transfer/lookup", () => {
  it("returns 404 for an unknown state", async () => {
    const { GET } = await import("../[state]/transfer/lookup/route");
    const { req, ctx } = makeRequest("xx");
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
  });

  it("returns 500 when the underlying transfer load throws", async () => {
    const transfer = await import("@/lib/transfer");
    vi.mocked(transfer.buildTransferLookup).mockRejectedValueOnce(new Error("db down"));
    const { GET } = await import("../[state]/transfer/lookup/route");
    const { req, ctx } = makeRequest("va");
    const res = await GET(req, ctx);
    expect(res.status).toBe(500);
  });

  it("returns the lookup + universities payload on success", async () => {
    const transfer = await import("@/lib/transfer");
    vi.mocked(transfer.buildTransferLookup).mockResolvedValueOnce({
      "ENG-111": [{ university: "vt", type: "direct", course: "ENGL 1105" }],
    });
    vi.mocked(transfer.getUniversities).mockResolvedValueOnce([
      { slug: "vt", name: "Virginia Tech" },
    ]);

    const { GET } = await import("../[state]/transfer/lookup/route");
    const { req, ctx } = makeRequest("va");
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lookup["ENG-111"]).toBeDefined();
    expect(body.universities[0].slug).toBe("vt");
  });

  it("does NOT leak one state's data into another (cache is keyed per state)", async () => {
    const transfer = await import("@/lib/transfer");
    vi.mocked(transfer.buildTransferLookup).mockImplementation(async (state?: string) => ({
      [`${state}-COURSE`]: [{ university: "uni", type: "direct" as const, course: "X" }],
    }));
    vi.mocked(transfer.getUniversities).mockImplementation(async (state?: string) => [
      { slug: `${state}-uni`, name: `${state} university` },
    ]);

    const { GET } = await import("../[state]/transfer/lookup/route");

    const va = makeRequest("va");
    const vaRes = await GET(va.req, va.ctx);
    const vaBody = await vaRes.json();

    const nc = makeRequest("nc");
    const ncRes = await GET(nc.req, nc.ctx);
    const ncBody = await ncRes.json();

    // Critical: NC must NOT receive VA's lookup keys.
    expect(vaBody.lookup["va-COURSE"]).toBeDefined();
    expect(vaBody.lookup["nc-COURSE"]).toBeUndefined();
    expect(ncBody.lookup["nc-COURSE"]).toBeDefined();
    expect(ncBody.lookup["va-COURSE"]).toBeUndefined();
  });

  it("serves the cached response on a repeat call without re-loading", async () => {
    const transfer = await import("@/lib/transfer");
    vi.mocked(transfer.buildTransferLookup).mockResolvedValue({});
    vi.mocked(transfer.getUniversities).mockResolvedValue([]);

    const { GET } = await import("../[state]/transfer/lookup/route");
    const a = makeRequest("va");
    await GET(a.req, a.ctx);
    const b = makeRequest("va");
    await GET(b.req, b.ctx);

    expect(vi.mocked(transfer.buildTransferLookup)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(transfer.getUniversities)).toHaveBeenCalledTimes(1);
  });
});

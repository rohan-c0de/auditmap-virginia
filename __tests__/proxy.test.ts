import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the cookie-touching session refresh so we can assert exactly WHEN it
// runs. The whole point of this suite is the SEO-critical invariant: a public
// / pSEO route must NEVER reach updateSession, because updateSession writes the
// Supabase auth cookie, which flips an ISR response to
// `Cache-Control: private` and silently kills the edge cache on ~200
// prerendered pages. (See proxy.ts header comment.)
const SESSION_SENTINEL = Symbol("updateSession-result");
const updateSessionMock = vi.fn((_request?: unknown) => SESSION_SENTINEL);
vi.mock("@/lib/supabase/middleware", () => ({
  updateSession: (request: unknown) => updateSessionMock(request),
}));

// Deterministic registry: only "va" is a real state.
vi.mock("@/lib/states/registry", () => ({
  isValidState: (slug: string) => slug === "va",
}));

import { NextRequest } from "next/server";
import { proxy } from "../proxy";

function reqFor(path: string): NextRequest {
  return new NextRequest(new URL(`http://localhost${path}`));
}

beforeEach(() => {
  updateSessionMock.mockClear();
});

describe("proxy()", () => {
  it.each(["/va", "/va/colleges", "/va/course/bio-141", "/va/transfer"])(
    "never touches cookies (no session refresh, no Set-Cookie) for pSEO route %s",
    async (path) => {
      const res = await proxy(reqFor(path));
      expect(updateSessionMock).not.toHaveBeenCalled();
      expect(res.headers.get("set-cookie")).toBeNull();
    },
  );

  it("returns 404 for a malformed course code", async () => {
    const res = await proxy(reqFor("/va/course/esl-42:"));
    expect(res.status).toBe(404);
    expect(updateSessionMock).not.toHaveBeenCalled();
  });

  it("returns 404 for an unregistered state slug", async () => {
    const res = await proxy(reqFor("/xx/colleges"));
    expect(res.status).toBe(404);
    expect(updateSessionMock).not.toHaveBeenCalled();
  });

  it("lets a well-formed course code through", async () => {
    const res = await proxy(reqFor("/va/course/bio-141"));
    expect(res.status).toBe(200);
    expect(updateSessionMock).not.toHaveBeenCalled();
  });

  it.each(["/account", "/api/account/delete", "/auth/callback"])(
    "refreshes the session for auth route %s",
    async (path) => {
      await proxy(reqFor(path));
      expect(updateSessionMock).toHaveBeenCalledTimes(1);
    },
  );
});

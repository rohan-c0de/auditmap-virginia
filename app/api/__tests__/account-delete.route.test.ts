import { describe, it, expect, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();
const deleteUserMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
  })),
}));

vi.mock("@/lib/supabase", () => ({
  getServiceClient: vi.fn(() => ({
    auth: { admin: { deleteUser: deleteUserMock } },
  })),
}));

import { DELETE } from "../account/delete/route";

// Each request gets a unique client key so the module-level in-memory rate
// limiter doesn't bleed across tests (6 same-key calls would trip the limit).
let ipCounter = 0;
function makeRequest(
  opts: { fetchSite?: string; ip?: string } = {}
): Request {
  const headers = new Headers();
  headers.set("sec-fetch-site", opts.fetchSite ?? "same-origin");
  headers.set("x-forwarded-for", opts.ip ?? `10.0.0.${ipCounter++}`);
  return new Request("http://localhost/api/account/delete", {
    method: "DELETE",
    headers,
  });
}

beforeEach(() => {
  getUserMock.mockReset();
  deleteUserMock.mockReset();
});

describe("DELETE /api/account/delete", () => {
  it("returns 401 when the request has no authenticated user", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: null }, error: null });
    const res = await DELETE(makeRequest());
    expect(res.status).toBe(401);
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it("returns 401 when getUser surfaces an auth error", async () => {
    getUserMock.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "JWT expired" },
    });
    const res = await DELETE(makeRequest());
    expect(res.status).toBe(401);
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it("calls service-role deleteUser with the authenticated user's id", async () => {
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "user-123" } },
      error: null,
    });
    deleteUserMock.mockResolvedValueOnce({ error: null });

    const res = await DELETE(makeRequest());
    expect(res.status).toBe(200);
    expect(deleteUserMock).toHaveBeenCalledWith("user-123");
    expect(await res.json()).toEqual({ success: true });
  });

  it("returns 500 when the service-role deletion fails", async () => {
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "user-123" } },
      error: null,
    });
    deleteUserMock.mockResolvedValueOnce({
      error: { message: "Supabase admin error" },
    });

    const res = await DELETE(makeRequest());
    expect(res.status).toBe(500);
  });

  it("returns 500 when an unexpected exception is thrown", async () => {
    getUserMock.mockRejectedValueOnce(new Error("network down"));
    const res = await DELETE(makeRequest());
    expect(res.status).toBe(500);
  });

  it("never invokes deleteUser before getUser succeeds (auth-gate ordering)", async () => {
    // Belt-and-suspenders: the entire 401 case must skip service-role calls.
    // This guards the security-critical invariant that admin deletion
    // cannot happen without a verified user.
    getUserMock.mockResolvedValueOnce({ data: { user: null }, error: null });
    await DELETE(makeRequest());
    expect(deleteUserMock).toHaveBeenCalledTimes(0);
  });

  it("returns 403 and skips auth for a cross-site request (CSRF defense)", async () => {
    const res = await DELETE(makeRequest({ fetchSite: "cross-site" }));
    expect(res.status).toBe(403);
    // CSRF block happens before any auth/delete work.
    expect(getUserMock).not.toHaveBeenCalled();
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it("rate-limits repeated requests from the same client (429)", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const ip = "203.0.113.99";
    // Limit is 5/min; the 6th same-key request must be rejected.
    for (let i = 0; i < 5; i++) {
      const ok = await DELETE(makeRequest({ ip }));
      expect(ok.status).not.toBe(429);
    }
    const limited = await DELETE(makeRequest({ ip }));
    expect(limited.status).toBe(429);
  });
});

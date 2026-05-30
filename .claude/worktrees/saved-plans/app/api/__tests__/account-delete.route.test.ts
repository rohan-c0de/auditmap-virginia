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

beforeEach(() => {
  getUserMock.mockReset();
  deleteUserMock.mockReset();
});

describe("DELETE /api/account/delete", () => {
  it("returns 401 when the request has no authenticated user", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: null }, error: null });
    const res = await DELETE();
    expect(res.status).toBe(401);
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it("returns 401 when getUser surfaces an auth error", async () => {
    getUserMock.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "JWT expired" },
    });
    const res = await DELETE();
    expect(res.status).toBe(401);
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it("calls service-role deleteUser with the authenticated user's id", async () => {
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "user-123" } },
      error: null,
    });
    deleteUserMock.mockResolvedValueOnce({ error: null });

    const res = await DELETE();
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

    const res = await DELETE();
    expect(res.status).toBe(500);
  });

  it("returns 500 when an unexpected exception is thrown", async () => {
    getUserMock.mockRejectedValueOnce(new Error("network down"));
    const res = await DELETE();
    expect(res.status).toBe(500);
  });

  it("never invokes deleteUser before getUser succeeds (auth-gate ordering)", async () => {
    // Belt-and-suspenders: the entire 401 case must skip service-role calls.
    // This guards the security-critical invariant that admin deletion
    // cannot happen without a verified user.
    getUserMock.mockResolvedValueOnce({ data: { user: null }, error: null });
    await DELETE();
    expect(deleteUserMock).toHaveBeenCalledTimes(0);
  });
});

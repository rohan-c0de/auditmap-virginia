import { describe, expect, it } from "vitest";
import { buildAccountExport, escapeIlikePattern } from "@/lib/account-export";

describe("escapeIlikePattern", () => {
  it("escapes ILIKE wildcards so an email matches literally", () => {
    expect(escapeIlikePattern("a_b%c@x.com")).toBe("a\\_b\\%c@x.com");
    expect(escapeIlikePattern("a\\b@x.com")).toBe("a\\\\b@x.com");
  });
  it("leaves an ordinary email unchanged", () => {
    expect(escapeIlikePattern("foo.bar@example.com")).toBe("foo.bar@example.com");
  });
});

describe("buildAccountExport", () => {
  const base = {
    user: { id: "u1", email: "x@y.com" },
    profile: { id: "u1", display_name: "X" },
    savedPlans: [{ id: "p1" }],
    savedSchedules: [],
    savedCourses: [],
    savedTransfers: [],
    seatNotifications: [],
    emailSubscriptions: [{ email: "x@y.com" }],
  };

  it("assembles every section with a stable shape and the passed-in timestamp", () => {
    const out = buildAccountExport(base, "2026-06-04T00:00:00.000Z");
    expect(out.format).toBe("ccp-account-export");
    expect(out.version).toBe(1);
    expect(out.exportedAt).toBe("2026-06-04T00:00:00.000Z");
    expect(out.account).toEqual({ id: "u1", email: "x@y.com" });
    expect(out.profile).toEqual({ id: "u1", display_name: "X" });
    expect(out.savedPlans).toEqual([{ id: "p1" }]);
    expect(out.emailSubscriptions).toEqual([{ email: "x@y.com" }]);
  });

  it("is deterministic for the same input and timestamp", () => {
    const a = buildAccountExport(base, "2026-06-04T00:00:00.000Z");
    const b = buildAccountExport(base, "2026-06-04T00:00:00.000Z");
    expect(a).toEqual(b);
  });

  it("coerces a null profile and missing arrays to safe defaults", () => {
    const out = buildAccountExport(
      {
        user: { id: "u2", email: null },
        profile: null,
        savedPlans: [],
        savedSchedules: [],
        savedCourses: [],
        savedTransfers: [],
        seatNotifications: [],
        emailSubscriptions: [],
      },
      "2026-06-04T00:00:00.000Z"
    );
    expect(out.profile).toBeNull();
    expect(out.account.email).toBeNull();
    expect(out.savedCourses).toEqual([]);
  });
});

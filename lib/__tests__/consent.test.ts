import { describe, expect, it } from "vitest";
import { decideConsentAction, TOS_VERSION } from "@/lib/consent";

describe("decideConsentAction", () => {
  it("'none' when the profile already has an acceptance timestamp", () => {
    expect(decideConsentAction("2026-06-01T00:00:00Z", null)).toBe("none");
    // a prior acceptance wins even if a stale pending value is lying around
    expect(decideConsentAction("2026-06-01T00:00:00Z", TOS_VERSION)).toBe("none");
  });

  it("'record' for a fresh signup with pending consent and no prior acceptance", () => {
    expect(decideConsentAction(null, TOS_VERSION)).toBe("record");
    expect(decideConsentAction(undefined, "2026-06-04")).toBe("record");
  });

  it("'prompt' when authenticated but nothing accepted and nothing pending (pre-gate account / cross-device link)", () => {
    expect(decideConsentAction(null, null)).toBe("prompt");
    expect(decideConsentAction(undefined, undefined)).toBe("prompt");
    expect(decideConsentAction(null, "")).toBe("prompt"); // empty pending = nothing pending
  });

  it("ships a non-empty TOS_VERSION", () => {
    expect(typeof TOS_VERSION).toBe("string");
    expect(TOS_VERSION.length).toBeGreaterThan(0);
  });
});

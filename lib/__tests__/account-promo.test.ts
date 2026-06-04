import { describe, expect, it } from "vitest";
import { shouldShowAccountPromo, PROMO_DISMISS_KEY } from "@/lib/account-promo";

describe("shouldShowAccountPromo", () => {
  it("shows for a logged-out, resolved, not-dismissed visitor", () => {
    expect(shouldShowAccountPromo({ isLoading: false, user: null, dismissed: false })).toBe(true);
  });

  it("stays hidden while auth is still loading (no flash for a resolving session)", () => {
    expect(shouldShowAccountPromo({ isLoading: true, user: null, dismissed: false })).toBe(false);
  });

  it("stays hidden for a signed-in user", () => {
    expect(shouldShowAccountPromo({ isLoading: false, user: { id: "u1" }, dismissed: false })).toBe(false);
    // even if loading already flipped and not dismissed
    expect(shouldShowAccountPromo({ isLoading: false, user: { id: "u1" }, dismissed: true })).toBe(false);
  });

  it("stays hidden once dismissed", () => {
    expect(shouldShowAccountPromo({ isLoading: false, user: null, dismissed: true })).toBe(false);
  });

  it("exposes the tab-scoped dismiss key", () => {
    expect(PROMO_DISMISS_KEY).toBe("ccp:promo-dismissed");
  });
});

import { describe, expect, it } from "vitest";
import { isAdFreeRoute } from "@/lib/ad-free-routes";

describe("isAdFreeRoute", () => {
  it("is true for authenticated / private routes (account dashboard, saved-plan view)", () => {
    expect(isAdFreeRoute("/account")).toBe(true);
    expect(isAdFreeRoute("/account/settings")).toBe(true);
    expect(isAdFreeRoute("/plan")).toBe(true);
    expect(isAdFreeRoute("/plan/3f9c1b2a-0000-4000-8000-000000000000")).toBe(true);
  });

  it("is false for public, ad-bearing routes", () => {
    expect(isAdFreeRoute("/")).toBe(false);
    expect(isAdFreeRoute("/va")).toBe(false);
    expect(isAdFreeRoute("/va/courses")).toBe(false);
    expect(isAdFreeRoute("/va/transfer")).toBe(false);
    expect(isAdFreeRoute("/blog/some-post")).toBe(false);
    expect(isAdFreeRoute("/va/program/accounting")).toBe(false);
  });

  it("keeps the public per-state planner builder (/[state]/plan) ad-bearing — only the private /plan/[id] is ad-free", () => {
    // /va/plan is the public 'build a plan' page; ads are allowed there.
    expect(isAdFreeRoute("/va/plan")).toBe(false);
  });

  it("does not match lookalike prefixes", () => {
    expect(isAdFreeRoute("/accounts")).toBe(false);
    expect(isAdFreeRoute("/planning")).toBe(false);
  });

  it("handles null / undefined / empty pathnames", () => {
    expect(isAdFreeRoute(null)).toBe(false);
    expect(isAdFreeRoute(undefined)).toBe(false);
    expect(isAdFreeRoute("")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  getStateConfig,
  getAllStates,
  isValidState,
  getDefaultState,
} from "../states/registry";

describe("getAllStates", () => {
  it("returns the full set of registered configs", () => {
    const all = getAllStates();
    // Floor — registry only ever grows. Update only on intentional changes.
    expect(all.length).toBeGreaterThanOrEqual(18);
  });

  it("every config has the required identity fields", () => {
    for (const cfg of getAllStates()) {
      expect(cfg.slug).toMatch(/^[a-z]{2}$/);
      expect(cfg.name.length).toBeGreaterThan(0);
      expect(cfg.systemName.length).toBeGreaterThan(0);
      expect(cfg.collegeCount).toBeGreaterThan(0);
    }
  });

  it("every slug is unique", () => {
    const slugs = getAllStates().map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe("getStateConfig", () => {
  it("returns the config matching the slug", () => {
    const va = getStateConfig("va");
    expect(va.slug).toBe("va");
    expect(va.name).toBe("Virginia");
  });

  it("throws on unknown slugs (do not silently return undefined)", () => {
    expect(() => getStateConfig("xx")).toThrow(/Unknown state/);
  });
});

describe("isValidState", () => {
  it("agrees with getStateConfig for every registered state", () => {
    // Cross-check: any state in the array is reachable via isValidState.
    for (const cfg of getAllStates()) {
      expect(isValidState(cfg.slug)).toBe(true);
    }
  });

  it("returns false for unknown slugs", () => {
    expect(isValidState("xx")).toBe(false);
    expect(isValidState("")).toBe(false);
  });
});

describe("getDefaultState", () => {
  it("returns a slug that is itself registered", () => {
    const slug = getDefaultState();
    expect(isValidState(slug)).toBe(true);
  });
});

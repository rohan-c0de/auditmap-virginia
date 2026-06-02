import { describe, expect, it } from "vitest";
import { normalizeCtclinkMode } from "../scrape-ctclink";

describe("normalizeCtclinkMode", () => {
  // The full vocabulary observed in WA ctcLink data (2026-06-01), with the
  // canonical enum we expect each to map to.
  const cases: Array<[string, "in-person" | "online" | "hybrid" | "zoom"]> = [
    ["Online Asynchronous", "online"],
    ["Hybrid", "hybrid"],
    ["In-Person (Web Enhanced)", "in-person"],
    ["In Person", "in-person"],
    ["Online Scheduled", "online"],
    ["Online Asynchron. w/In-Person", "hybrid"],
    ["Flexible", "hybrid"],
    ["Online Scheduled w/In-Person", "hybrid"],
    ["Individualized Instruction", "in-person"],
    ["Other", "in-person"],
    ["Self-Paced", "online"],
    ["On-line", "online"],
  ];

  for (const [raw, expected] of cases) {
    it(`maps "${raw}" -> ${expected}`, () => {
      expect(normalizeCtclinkMode(raw)).toBe(expected);
    });
  }

  it("is case-insensitive", () => {
    expect(normalizeCtclinkMode("ONLINE ASYNCHRONOUS")).toBe("online");
    expect(normalizeCtclinkMode("hybrid")).toBe("hybrid");
  });

  it("defaults empty / unknown to in-person rather than guessing remote", () => {
    expect(normalizeCtclinkMode("")).toBe("in-person");
    expect(normalizeCtclinkMode("Some Future Mode")).toBe("in-person");
  });

  it("always returns a value in the canonical enum", () => {
    const allowed = new Set(["in-person", "online", "hybrid", "zoom"]);
    for (const [raw] of cases) {
      expect(allowed.has(normalizeCtclinkMode(raw))).toBe(true);
    }
  });
});

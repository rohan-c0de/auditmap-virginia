import { describe, expect, it } from "vitest";
import { termCodeFromLabel, termLabel } from "../term-label";

describe("termCodeFromLabel", () => {
  it("converts each season label to the right code", () => {
    expect(termCodeFromLabel("Spring 2026")).toBe("2026SP");
    expect(termCodeFromLabel("Summer 2026")).toBe("2026SU");
    expect(termCodeFromLabel("Fall 2026")).toBe("2026FA");
  });

  it("is case-insensitive and tolerant of whitespace", () => {
    expect(termCodeFromLabel("fall 2026")).toBe("2026FA");
    expect(termCodeFromLabel("  FALL 2026  ")).toBe("2026FA");
  });

  it("returns null for malformed input rather than guessing", () => {
    expect(termCodeFromLabel("Fall")).toBeNull();
    expect(termCodeFromLabel("Winter 2026")).toBeNull();
    expect(termCodeFromLabel("2026")).toBeNull();
    expect(termCodeFromLabel("")).toBeNull();
  });

  it("round-trips with termLabel", () => {
    for (const code of ["2026SP", "2026SU", "2026FA", "2027SP"]) {
      expect(termCodeFromLabel(termLabel(code))).toBe(code);
    }
  });
});

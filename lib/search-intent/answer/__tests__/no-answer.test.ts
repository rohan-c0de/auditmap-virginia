import { describe, expect, it } from "vitest";
import { buildFollowups, makeNoAnswer } from "../no-answer";

describe("makeNoAnswer", () => {
  it("returns a NoAnswer of the correct shape", () => {
    const a = makeNoAnswer({ reason: "missing-entity", message: "msg" });
    expect(a.type).toBe("none");
    expect(a.reason).toBe("missing-entity");
    expect(a.message).toBe("msg");
  });

  it("populates default followups when none provided", () => {
    const a = makeNoAnswer({ reason: "missing-entity", message: "msg" });
    expect(Array.isArray(a.followups)).toBe(true);
    expect(a.followups!.length).toBeGreaterThan(0);
    for (const f of a.followups!) {
      expect(typeof f).toBe("string");
      expect(f.length).toBeGreaterThan(0);
      // No leftover template placeholders.
      expect(f).not.toMatch(/\{.*\}/);
    }
  });

  it("respects an explicit followups override", () => {
    const a = makeNoAnswer({
      reason: "out-of-scope",
      message: "msg",
      followups: ["custom one?", "custom two?"],
    });
    expect(a.followups).toEqual(["custom one?", "custom two?"]);
  });

  it("passes through optional suggestions", () => {
    const a = makeNoAnswer({
      reason: "no-state-data",
      message: "msg",
      suggestions: ["try VA", "try MA"],
    });
    expect(a.suggestions).toEqual(["try VA", "try MA"]);
  });
});

describe("buildFollowups (NoAnswer)", () => {
  it("returns deterministic templates per reason", () => {
    expect(buildFollowups("missing-entity")).toEqual(
      buildFollowups("missing-entity"),
    );
    expect(buildFollowups("out-of-scope")).toEqual(
      buildFollowups("out-of-scope"),
    );
  });

  it("returns at least one concrete question per reason", () => {
    const reasons = [
      "missing-entity",
      "no-state-data",
      "out-of-scope",
      "intent-not-supported",
    ] as const;
    for (const r of reasons) {
      const list = buildFollowups(r);
      expect(list.length).toBeGreaterThan(0);
      for (const q of list) {
        expect(q).toMatch(/\?$/); // must look like a question
      }
    }
  });
});

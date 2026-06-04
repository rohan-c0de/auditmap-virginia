import { describe, expect, it } from "vitest";
import { toggleCompleted, completedCount } from "@/lib/transfer-tracker";

describe("toggleCompleted", () => {
  it("adds a course when absent", () => {
    expect(toggleCompleted(["ENG 111"], "MTH 154")).toEqual(["ENG 111", "MTH 154"]);
  });

  it("removes a course when present", () => {
    expect(toggleCompleted(["ENG 111", "MTH 154"], "ENG 111")).toEqual(["MTH 154"]);
  });

  it("never produces a duplicate", () => {
    const once = toggleCompleted(["ENG 111"], "MTH 154");
    expect(once.filter((c) => c === "MTH 154")).toHaveLength(1);
    // toggling the same code again removes it (not a second copy)
    expect(toggleCompleted(once, "MTH 154")).toEqual(["ENG 111"]);
  });

  it("does not mutate the input array", () => {
    const input = ["ENG 111"];
    toggleCompleted(input, "MTH 154");
    expect(input).toEqual(["ENG 111"]);
  });
});

describe("completedCount", () => {
  it("counts only target courses that are completed", () => {
    expect(completedCount(["ENG 111", "MTH 154", "BIO 101"], ["ENG 111", "BIO 101"])).toEqual({
      done: 2,
      total: 3,
    });
  });

  it("ignores completed codes that aren't in the targets", () => {
    expect(completedCount(["ENG 111"], ["ENG 111", "HIS 101"])).toEqual({ done: 1, total: 1 });
  });

  it("handles an empty plan", () => {
    expect(completedCount([], [])).toEqual({ done: 0, total: 0 });
  });
});

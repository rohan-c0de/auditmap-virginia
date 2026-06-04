import { describe, expect, it } from "vitest";
import {
  toggleCompleted,
  completedCount,
  transferVerdict,
  progressSummary,
} from "@/lib/transfer-tracker";
import type { TransferMapping } from "@/lib/types";

/** Minimal TransferMapping fixture — only the fields transferVerdict reads
 *  matter (cc_prefix, cc_number, no_credit, is_elective); the rest are filler. */
const m = (
  cc_prefix: string,
  cc_number: string,
  o: { no_credit?: boolean; is_elective?: boolean } = {},
): TransferMapping => ({
  cc_prefix,
  cc_number,
  cc_course: `${cc_prefix} ${cc_number}`,
  cc_title: "",
  cc_credits: "3",
  university: "u",
  university_name: "U",
  univ_course: "X 100",
  univ_title: "",
  univ_credits: "3",
  notes: "",
  no_credit: o.no_credit ?? false,
  is_elective: o.is_elective ?? false,
});

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

describe("transferVerdict", () => {
  it("picks the BEST outcome when a course has both elective + direct rows", () => {
    // one-to-many: same course, one elective row + one direct row → direct wins
    expect(transferVerdict([m("ENG", "111", { is_elective: true }), m("ENG", "111")], "ENG 111")).toBe(
      "direct",
    );
  });

  it("returns elective when only elective rows exist", () => {
    expect(transferVerdict([m("ENG", "111", { is_elective: true })], "ENG 111")).toBe("elective");
  });

  it("returns no-credit when only no_credit rows exist", () => {
    expect(transferVerdict([m("ENG", "111", { no_credit: true })], "ENG 111")).toBe("no-credit");
  });

  it("returns none when the course isn't mapped to this university", () => {
    expect(transferVerdict([m("MTH", "154")], "ENG 111")).toBe("none");
  });
});

describe("progressSummary", () => {
  it("buckets completed courses by verdict, no-data as its own bucket", () => {
    const verdicts = {
      "ENG 111": "direct",
      "MTH 154": "elective",
      "BIO 101": "no-credit",
      "HIS 101": "none",
    } as const;
    expect(progressSummary(["ENG 111", "MTH 154", "BIO 101", "HIS 101"], verdicts)).toEqual({
      direct: 1,
      elective: 1,
      noCredit: 1,
      noData: 1,
    });
  });

  it("treats a missing verdict as no-data", () => {
    expect(progressSummary(["ENG 111"], {})).toEqual({ direct: 0, elective: 0, noCredit: 0, noData: 1 });
  });

  it("handles no completed courses", () => {
    expect(progressSummary([], {})).toEqual({ direct: 0, elective: 0, noCredit: 0, noData: 0 });
  });
});

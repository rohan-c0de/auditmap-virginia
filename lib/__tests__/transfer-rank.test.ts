import { describe, expect, it } from "vitest";
import {
  rankTransferStatus,
  rankMapping,
  bestTransferEntry,
  bestMappingForUniversity,
} from "../transfer-rank";

describe("rankTransferStatus", () => {
  it("orders direct > elective > no-credit > unknown", () => {
    expect(rankTransferStatus("direct")).toBeGreaterThan(
      rankTransferStatus("elective"),
    );
    expect(rankTransferStatus("elective")).toBeGreaterThan(
      rankTransferStatus("no-credit"),
    );
    expect(rankTransferStatus("no-credit")).toBeGreaterThan(
      rankTransferStatus("unknown"),
    );
  });
});

describe("rankMapping", () => {
  it("orders direct > elective > no-credit from booleans", () => {
    expect(rankMapping({ no_credit: false, is_elective: false })).toBe(3);
    expect(rankMapping({ no_credit: false, is_elective: true })).toBe(2);
    expect(rankMapping({ no_credit: true, is_elective: false })).toBe(1);
    // no_credit dominates is_elective when both somehow set.
    expect(rankMapping({ no_credit: true, is_elective: true })).toBe(1);
  });
});

describe("bestTransferEntry", () => {
  const entry = (
    university: string,
    type: "direct" | "elective" | "no-credit",
    course = "",
  ) => ({ university, type, course });

  it("picks direct over a first-listed elective (first-wins bug)", () => {
    const entries = [
      entry("gatech", "elective", "FREE 1XXX"),
      entry("gatech", "direct", "ENGL 1101"),
    ];
    const best = bestTransferEntry(entries, "gatech");
    expect(best?.type).toBe("direct");
    expect(best?.course).toBe("ENGL 1101");
  });

  it("picks direct even when no-credit is listed first", () => {
    const entries = [
      entry("uga", "no-credit"),
      entry("uga", "direct", "MATH 1113"),
    ];
    expect(bestTransferEntry(entries, "uga")?.type).toBe("direct");
  });

  it("keeps direct when it is already first (no spurious downgrade)", () => {
    const entries = [
      entry("gmu", "direct", "ACCT 203"),
      entry("gmu", "elective", "FREE 2XXX"),
    ];
    expect(bestTransferEntry(entries, "gmu")?.course).toBe("ACCT 203");
  });

  it("ignores entries for other universities", () => {
    const entries = [
      entry("uga", "direct", "MATH 1113"),
      entry("gatech", "no-credit"),
    ];
    expect(bestTransferEntry(entries, "gatech")?.type).toBe("no-credit");
  });

  it("returns undefined when the university is absent", () => {
    expect(bestTransferEntry([entry("uga", "direct")], "gatech")).toBeUndefined();
  });

  it("is deterministic on ties — keeps the first matching row", () => {
    const a = entry("uga", "elective", "A 1XXX");
    const b = entry("uga", "elective", "B 1XXX");
    expect(bestTransferEntry([a, b], "uga")).toBe(a);
  });
});

describe("bestMappingForUniversity", () => {
  const m = (
    university: string,
    no_credit: boolean,
    is_elective: boolean,
    univ_course = "",
  ) => ({ university, no_credit, is_elective, univ_course });

  it("picks the direct mapping over a first-listed elective", () => {
    const mappings = [
      m("umass-boston", false, true, "FREE 1XXX"),
      m("umass-boston", false, false, "ACCT 201"),
    ];
    const best = bestMappingForUniversity(mappings, "umass-boston");
    expect(best?.is_elective).toBe(false);
    expect(best?.no_credit).toBe(false);
    expect(best?.univ_course).toBe("ACCT 201");
  });

  it("picks elective over a first-listed no-credit", () => {
    const mappings = [
      m("umass-boston", true, false),
      m("umass-boston", false, true, "FREE 1XXX"),
    ];
    const best = bestMappingForUniversity(mappings, "umass-boston");
    expect(best?.is_elective).toBe(true);
  });

  it("returns undefined when the university is absent", () => {
    expect(
      bestMappingForUniversity([m("uga", false, false)], "gatech"),
    ).toBeUndefined();
  });
});

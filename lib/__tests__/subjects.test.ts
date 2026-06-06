import { describe, expect, it } from "vitest";
import { subjectPrefixesForName, subjectName } from "../subjects";

describe("subjectPrefixesForName", () => {
  const sorted = (xs: string[]) => xs.slice().sort();

  it("resolves a subject name to every prefix that carries it", () => {
    expect(sorted(subjectPrefixesForName("history"))).toEqual(["AMH", "HIS", "HIST"]);
    expect(sorted(subjectPrefixesForName("mathematics"))).toEqual([
      "MAC",
      "MAT",
      "MATH",
      "MTH",
    ]);
    expect(sorted(subjectPrefixesForName("english"))).toEqual(["ENC", "ENG", "ENGL"]);
    expect(sorted(subjectPrefixesForName("biology"))).toEqual(["BIO", "BIOL", "BSC"]);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(sorted(subjectPrefixesForName("  History "))).toEqual(["AMH", "HIS", "HIST"]);
  });

  it("resolves colloquial aliases", () => {
    expect(sorted(subjectPrefixesForName("poli sci"))).toEqual(["POL", "POLS"]);
    expect(subjectPrefixesForName("psych")).toContain("PSY");
    expect(subjectPrefixesForName("stats")).toContain("STAT");
  });

  it("returns [] for unknown names or empty input", () => {
    expect(subjectPrefixesForName("nonsense")).toEqual([]);
    expect(subjectPrefixesForName("")).toEqual([]);
  });

  it("stays in sync with the new FL/TX prefixes added to SUBJECT_NAMES", () => {
    expect(subjectName("AMH")).toBe("History");
    expect(subjectName("MAC")).toBe("Mathematics");
    expect(subjectName("BSC")).toBe("Biology");
    expect(subjectName("ENC")).toBe("English");
    expect(subjectName("GOVT")).toBe("Government");
  });
});

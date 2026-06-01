import { describe, expect, it } from "vitest";
import {
  stemPrefix,
  tokenize,
  stemSet,
  titleMatchesMajor,
} from "../semantic-match";

describe("stemPrefix", () => {
  it("returns the whole word for short inputs", () => {
    expect(stemPrefix("art")).toBe("art");
    expect(stemPrefix("law")).toBe("law");
    expect(stemPrefix("math")).toBe("math");
  });

  it("returns first 5 chars for ≥6 char inputs", () => {
    expect(stemPrefix("history")).toBe("histo");
    expect(stemPrefix("biology")).toBe("biolo");
    expect(stemPrefix("geography")).toBe("geogr");
    expect(stemPrefix("computer")).toBe("compu");
    expect(stemPrefix("mathematics")).toBe("mathe");
  });

  it("collapses morphology variants of common subjects", () => {
    expect(stemPrefix("biological")).toBe(stemPrefix("biology"));
    expect(stemPrefix("geographic")).toBe(stemPrefix("geography"));
    expect(stemPrefix("historical")).toBe(stemPrefix("history"));
    expect(stemPrefix("chemical")).toBe(stemPrefix("chemistry"));
    expect(stemPrefix("psychological")).toBe(stemPrefix("psychology"));
  });

  it("strips non-alpha and lowercases", () => {
    expect(stemPrefix("Geography!")).toBe("geogr");
    expect(stemPrefix("123abc")).toBe("abc");
    expect(stemPrefix("")).toBe("");
  });
});

describe("tokenize", () => {
  it("drops fillers and short words", () => {
    expect(tokenize("the art of war")).toEqual(["art", "war"]);
    expect(tokenize("computer science and engineering")).toEqual([
      "computer",
      "science",
      "engineering",
    ]);
  });

  it("splits on punctuation", () => {
    expect(tokenize("Geographic Information Systems, C.S.C.")).toEqual([
      "geographic",
      "information",
      "systems",
    ]);
  });

  it("returns empty for empty input", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   ")).toEqual([]);
  });
});

describe("stemSet", () => {
  it("dedupes repeated stems", () => {
    const s = stemSet("Computer Computers Computing");
    expect(s.size).toBe(1);
    expect(s.has("compu")).toBe(true);
  });
});

describe("titleMatchesMajor", () => {
  it("matches geography/Geographic stem variant", () => {
    expect(
      titleMatchesMajor("Geographic Information Systems, C.S.C.", "geography"),
    ).toBe(true);
  });

  it("matches biology/Biological stem variant", () => {
    expect(titleMatchesMajor("Biological Sciences, A.S.", "biology")).toBe(
      true,
    );
  });

  it("matches history/Historical stem variant", () => {
    expect(
      titleMatchesMajor("Historical Preservation, C.S.C.", "history"),
    ).toBe(true);
  });

  it("requires ALL multi-word stems to match", () => {
    // "computer science" should match a CS-titled program ...
    expect(
      titleMatchesMajor("Computer Science Transfer, A.S.", "computer science"),
    ).toBe(true);
    // ... but should NOT match "Communication Science" (only "science"
    // matches; "computer" doesn't).
    expect(
      titleMatchesMajor("Communication Science", "computer science"),
    ).toBe(false);
    // ... and should NOT match "Computer Forensics" (only "computer"
    // matches; "science" doesn't).
    expect(titleMatchesMajor("Computer Forensics", "computer science")).toBe(
      false,
    );
  });

  it("returns false when no stems match", () => {
    expect(titleMatchesMajor("Welding Technology", "biology")).toBe(false);
    expect(titleMatchesMajor("Underwater Basketweaving", "computer")).toBe(
      false,
    );
  });

  it("returns false on empty inputs", () => {
    expect(titleMatchesMajor("", "biology")).toBe(false);
    expect(titleMatchesMajor("Biology", "")).toBe(false);
  });

  it("ignores filler-only tokens in the major term", () => {
    // "the of and" tokenizes to nothing significant → empty needles → false
    expect(titleMatchesMajor("Biology", "the of and")).toBe(false);
  });

  it("handles short single-word majors via exact stem match", () => {
    expect(titleMatchesMajor("Studio Art (Certificate)", "art")).toBe(true);
    expect(titleMatchesMajor("Mathematics, A.S.", "math")).toBe(true);
  });
});

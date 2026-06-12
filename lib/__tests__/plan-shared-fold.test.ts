import { describe, it, expect } from "vitest";
import { foldHonorsVariants } from "@/lib/programs/plan-shared";

const c = (
  prefix: string,
  number: string,
  title: string,
  credits: number | null = 3,
) => ({
  prefix,
  number,
  title,
  credits,
  or_alternatives: [] as Array<{ prefix: string; number: string; title: string }>,
});

describe("foldHonorsVariants", () => {
  it("folds 'Honors X' into X as an or-alternative (real Tri-C nursing shape)", () => {
    const out = foldHonorsVariants([
      c("ENG", "1010", "College Composition I", 0),
      c("ENG", "101H", "Honors College Composition I", 0),
      c("PSY", "1010", "General Psychology", 0),
      c("PSY", "101H", "Honors General Psychology", 0),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].number).toBe("1010");
    expect(out[0].or_alternatives).toEqual([
      { prefix: "ENG", number: "101H", title: "Honors College Composition I" },
    ]);
    expect(out[1].or_alternatives[0].number).toBe("101H");
  });

  it("folds regardless of row order (honors listed first)", () => {
    const out = foldHonorsVariants([
      c("ENG", "101H", "Honors College Composition I"),
      c("ENG", "1010", "College Composition I"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].number).toBe("1010");
    expect(out[0].or_alternatives).toHaveLength(1);
  });

  it("supports 'X (Honors)' suffix form", () => {
    const out = foldHonorsVariants([
      c("MATH", "1410", "Statistics I"),
      c("MATH", "141H", "Statistics I (Honors)"),
    ]);
    expect(out).toHaveLength(1);
  });

  it("does NOT fold across different prefixes or unrelated titles", () => {
    const input = [
      c("ENG", "1010", "College Composition I"),
      c("COMM", "101H", "Honors College Composition I"), // different prefix
      c("ENG", "2020", "College Composition II"),
    ];
    const out = foldHonorsVariants(input);
    expect(out).toHaveLength(3);
  });

  it("keeps a lone honors course (no base present) as-is", () => {
    const out = foldHonorsVariants([c("PHIL", "201H", "Honors Ethics")]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Honors Ethics");
  });

  it("recovers credits from the variant when the base lost them", () => {
    const out = foldHonorsVariants([
      c("ENG", "1010", "College Composition I", 0),
      c("ENG", "101H", "Honors College Composition I", 3),
    ]);
    expect(out[0].credits).toBe(3);
  });
});

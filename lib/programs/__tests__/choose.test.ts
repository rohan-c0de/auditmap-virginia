import { describe, expect, it } from "vitest";
import {
  recommend,
  matchesTime,
  availableFieldIds,
  relevantSlugs,
  FIELDS,
  GOALS,
  TIMES,
  type ChooseProgramFact,
  type QuizAnswers,
} from "../choose";
import { PROGRAMS } from "../registry";

// --- fixtures -------------------------------------------------------------

function fact(p: Partial<ChooseProgramFact> & { slug: string }): ChooseProgramFact {
  return {
    name: p.slug,
    blurb: "",
    collegeCount: 5,
    sectionCount: 50,
    onlinePct: 0,
    eveningAvailable: false,
    medianWage: null,
    careerOriented: false,
    ...p,
  };
}

// Business field = business-administration (career) + accounting (career).
const bizAdmin = fact({
  slug: "business-administration",
  careerOriented: true,
  medianWage: 80000,
  sectionCount: 300,
  collegeCount: 20,
});
const accounting = fact({
  slug: "accounting",
  careerOriented: true,
  medianWage: 60000,
  sectionCount: 100,
  collegeCount: 15,
});
// Health field mixes career (nursing) + transfer (psychology, biology).
const nursing = fact({
  slug: "nursing",
  careerOriented: true,
  medianWage: 85000,
  sectionCount: 90,
  collegeCount: 12,
  eveningAvailable: true,
});
const psychology = fact({
  slug: "psychology",
  careerOriented: false,
  medianWage: null,
  sectionCount: 200,
  collegeCount: 18,
  onlinePct: 40,
});
const biology = fact({
  slug: "biology",
  careerOriented: false,
  medianWage: null,
  sectionCount: 150,
  collegeCount: 16,
});

const ALL = [bizAdmin, accounting, nursing, psychology, biology];

const ans = (o: Partial<QuizAnswers>): QuizAnswers => ({
  field: "business",
  goal: "job",
  time: "fulltime",
  ...o,
});

// --- field filtering ------------------------------------------------------

describe("recommend — field filtering", () => {
  it("returns only programs in the chosen field", () => {
    const r = recommend(ALL, ans({ field: "business" }));
    expect(r.map((f) => f.slug).sort()).toEqual(["accounting", "business-administration"]);
  });

  it("returns [] for an unknown field id", () => {
    // @ts-expect-error — testing defensive runtime behavior
    expect(recommend(ALL, ans({ field: "nope" }))).toEqual([]);
  });

  it("returns [] when no facts are in the field", () => {
    expect(recommend([psychology, biology], ans({ field: "business" }))).toEqual([]);
  });

  it("includes a slug that belongs to multiple fields under each", () => {
    // biology is in both health and stem
    const health = recommend(ALL, ans({ field: "health" })).map((f) => f.slug);
    const stem = recommend(ALL, ans({ field: "stem" })).map((f) => f.slug);
    expect(health).toContain("biology");
    expect(stem).toContain("biology");
  });
});

// --- goal ordering --------------------------------------------------------

describe("recommend — goal: job", () => {
  it("orders career-oriented programs before transfer-oriented", () => {
    const r = recommend(ALL, ans({ field: "health", goal: "job" }));
    // nursing (career) should come before psychology/biology (transfer)
    const idxNursing = r.findIndex((f) => f.slug === "nursing");
    const idxPsych = r.findIndex((f) => f.slug === "psychology");
    expect(idxNursing).toBeLessThan(idxPsych);
  });

  it("within career programs, higher wage first", () => {
    const r = recommend(ALL, ans({ field: "business", goal: "job" }));
    expect(r[0].slug).toBe("business-administration"); // 80k > 60k
  });
});

describe("recommend — goal: transfer", () => {
  it("orders transfer-oriented programs before career programs", () => {
    const r = recommend(ALL, ans({ field: "health", goal: "transfer" }));
    const idxPsych = r.findIndex((f) => f.slug === "psychology");
    const idxNursing = r.findIndex((f) => f.slug === "nursing");
    expect(idxPsych).toBeLessThan(idxNursing);
  });

  it("within transfer programs, more colleges first", () => {
    const r = recommend(ALL, ans({ field: "health", goal: "transfer" }));
    // psychology (18 colleges) before biology (16)
    const transferOnly = r.filter((f) => !f.careerOriented).map((f) => f.slug);
    expect(transferOnly).toEqual(["psychology", "biology"]);
  });
});

describe("recommend — goal: pay", () => {
  it("orders by highest known wage, unknown-wage last", () => {
    const r = recommend(ALL, ans({ field: "health", goal: "pay" }));
    // nursing (85k) first; psychology & biology (null wage) last
    expect(r[0].slug).toBe("nursing");
    expect(r[r.length - 1].careerOriented).toBe(false); // a null-wage program trails
  });

  it("never floats a null-wage program above a real wage", () => {
    const r = recommend(ALL, ans({ field: "business", goal: "pay" }));
    expect(r.map((f) => f.slug)).toEqual(["business-administration", "accounting"]);
  });

  // Regression: two null-wage programs must not produce a NaN comparator
  // (Infinity - Infinity). They must fall through to the section tiebreak.
  it("orders two unknown-wage programs by sections (no NaN corruption)", () => {
    const r = recommend(ALL, ans({ field: "health", goal: "pay" }));
    const transferOnly = r.filter((f) => !f.careerOriented).map((f) => f.slug);
    // psychology (200 sections) before biology (150), both null wage
    expect(transferOnly).toEqual(["psychology", "biology"]);
  });
});

describe("recommend — goal: job with unknown-wage pairs (NaN regression)", () => {
  it("orders two unknown-wage transfer programs by sections under job goal", () => {
    const r = recommend(ALL, ans({ field: "health", goal: "job" }));
    const transferOnly = r.filter((f) => !f.careerOriented).map((f) => f.slug);
    // psychology (200) before biology (150) — would be unstable if NaN leaked
    expect(transferOnly).toEqual(["psychology", "biology"]);
  });

  // Strong form: reverse the input order. A NaN comparator (Infinity-Infinity)
  // makes V8 keep input order, so this would yield [biology, psychology] and
  // fail. The finite comparator sorts by sections regardless of input order.
  it("sorts unknown-wage pairs by the comparator, not input order", () => {
    const reversed = [biology, psychology]; // bio first on input
    const r = recommend(reversed, ans({ field: "health", goal: "pay" }));
    expect(r.map((f) => f.slug)).toEqual(["psychology", "biology"]); // 200 > 150
  });
});

// --- time annotation ------------------------------------------------------

describe("matchesTime", () => {
  it("evening matches only programs with evening sections", () => {
    expect(matchesTime(nursing, "evening")).toBe(true);
    expect(matchesTime(biology, "evening")).toBe(false);
  });
  it("online matches only programs with >0 online share", () => {
    expect(matchesTime(psychology, "online")).toBe(true);
    expect(matchesTime(biology, "online")).toBe(false);
  });
  it("fulltime and parttime match everything", () => {
    expect(matchesTime(biology, "fulltime")).toBe(true);
    expect(matchesTime(biology, "parttime")).toBe(true);
  });
});

describe("recommend — time floats matches up without dropping", () => {
  it("evening preference floats evening programs first but keeps the rest", () => {
    const r = recommend(ALL, ans({ field: "health", goal: "transfer", time: "evening" }));
    // nursing is the only evening-available one → it floats to the front
    expect(r[0].slug).toBe("nursing");
    // but psychology and biology are still present (not dropped)
    expect(r.map((f) => f.slug).sort()).toEqual(["biology", "nursing", "psychology"]);
  });

  it("online preference floats online programs first", () => {
    const r = recommend(ALL, ans({ field: "health", goal: "transfer", time: "online" }));
    expect(r[0].slug).toBe("psychology"); // only one with onlinePct > 0
    expect(r).toHaveLength(3);
  });

  it("fulltime does not reorder beyond the goal ordering", () => {
    const full = recommend(ALL, ans({ field: "health", goal: "transfer", time: "fulltime" }));
    const part = recommend(ALL, ans({ field: "health", goal: "transfer", time: "parttime" }));
    expect(full.map((f) => f.slug)).toEqual(part.map((f) => f.slug));
  });
});

// --- determinism ----------------------------------------------------------

describe("recommend — determinism", () => {
  it("is stable across calls (slug tie-break)", () => {
    const tied = [
      fact({ slug: "english", careerOriented: false, collegeCount: 10, sectionCount: 100 }),
      fact({ slug: "art", careerOriented: false, collegeCount: 10, sectionCount: 100 }),
      fact({ slug: "history", careerOriented: false, collegeCount: 10, sectionCount: 100 }),
    ];
    const a = recommend(tied, ans({ field: "arts", goal: "transfer" })).map((f) => f.slug);
    const b = recommend(tied, ans({ field: "arts", goal: "transfer" })).map((f) => f.slug);
    expect(a).toEqual(b);
    expect(a).toEqual(["art", "english", "history"]); // alphabetical on full tie
  });
});

// --- availableFieldIds ----------------------------------------------------

describe("availableFieldIds", () => {
  it("marks a field available when any of its slugs has a fact", () => {
    const avail = availableFieldIds([accounting]);
    expect(avail.has("business")).toBe(true);
    expect(avail.has("trades")).toBe(false);
  });

  it("returns an empty set when no facts", () => {
    expect(availableFieldIds([]).size).toBe(0);
  });

  it("a multi-field slug marks all its fields available", () => {
    const avail = availableFieldIds([biology]); // health + stem
    expect(avail.has("health")).toBe(true);
    expect(avail.has("stem")).toBe(true);
    expect(avail.has("business")).toBe(false);
  });
});

// --- taxonomy sanity ------------------------------------------------------

describe("taxonomy", () => {
  it("every field has at least 2 slugs and valid metadata", () => {
    for (const f of FIELDS) {
      expect(f.slugs.length).toBeGreaterThanOrEqual(2);
      expect(f.label.length).toBeGreaterThan(0);
      expect(f.iconPath).toContain("<path");
    }
  });
  it("has 3 goals and 4 time options", () => {
    expect(GOALS).toHaveLength(3);
    expect(TIMES).toHaveLength(4);
  });

  it("every field slug exists in the program registry", () => {
    const valid = new Set(PROGRAMS.map((p) => p.slug));
    for (const f of FIELDS) {
      for (const s of f.slugs) {
        expect(valid.has(s), `${s} (field ${f.id}) is not a registry slug`).toBe(
          true,
        );
      }
    }
  });

  // INVARIANT that guarantees the home-page CTA never links to an empty quiz:
  // the home page shows the CTA when getQualifyingProgramSlugs(state) is
  // non-empty (a subset of all registry slugs), and /[state]/choose has
  // content when any relevantSlug qualifies. Those are equivalent ONLY if
  // relevantSlugs() covers every registry slug. If a future program is added
  // to the registry without being placed in a field, this fails — assign it
  // to a FIELD (or change the CTA gate) so the CTA can't dead-end on a 404.
  it("relevantSlugs() covers every registry program slug (CTA-no-404 invariant)", () => {
    const relevant = new Set(relevantSlugs());
    const missing = PROGRAMS.map((p) => p.slug).filter((s) => !relevant.has(s));
    expect(missing, `registry slugs missing from any field: ${missing.join(", ")}`).toEqual(
      [],
    );
  });
});

// --- edge cases (gaps from the session test-coverage audit) ---------------

describe("recommend — edge cases", () => {
  it("returns [] for an empty fact set", () => {
    expect(recommend([], ans({ field: "business", goal: "job" }))).toEqual([]);
  });

  it("preserves a single match", () => {
    const r = recommend([accounting], ans({ field: "business", goal: "pay" }));
    expect(r.map((f) => f.slug)).toEqual(["accounting"]);
  });
});

describe("matchesTime — null onlinePct", () => {
  it("treats a null online share as no online availability", () => {
    const f = fact({ slug: "x", onlinePct: null });
    expect(matchesTime(f, "online")).toBe(false);
    // full/part time still match regardless of online data
    expect(matchesTime(f, "fulltime")).toBe(true);
    expect(matchesTime(f, "parttime")).toBe(true);
  });
});

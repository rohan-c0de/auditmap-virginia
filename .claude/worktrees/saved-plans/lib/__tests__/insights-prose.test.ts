import { describe, expect, it } from "vitest";
import {
  BANNED_PHRASES,
  pickVariant,
  renderCollegeProse,
  renderStateProse,
} from "../insights-prose";
import type { CollegeInsights } from "../college-insights";
import type { StateInsights } from "../state-insights";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function makeCollegeInsights(
  overrides: Partial<CollegeInsights> = {},
): CollegeInsights {
  return {
    state: "va",
    collegeId: "northern-virginia-community-college",
    collegeName: "Northern Virginia Community College",
    systemName: "VCCS",
    term: "2026FA",
    termSectionCount: 4250,
    sectionRank: { position: 1, outOf: 23, value: 4250 },
    topSubjects: [
      { prefix: "ENG", sections: 280 },
      { prefix: "BIO", sections: 220 },
      { prefix: "MTH", sections: 195 },
    ],
    modeShares: {
      inPerson: { pct: 55, statePct: 60, delta: -5 },
      hybrid: { pct: 10, statePct: 8, delta: 2 },
      online: { pct: 35, statePct: 22, delta: 13 },
    },
    lateStartCount: 320,
    lateStartRank: { position: 2, outOf: 23, value: 320 },
    topTransferDestinations: [
      { university: "George Mason University", mappingCount: 482 },
      { university: "Virginia Commonwealth University", mappingCount: 391 },
      { university: "Old Dominion University", mappingCount: 277 },
    ],
    totalTransferMappings: 1150,
    assistAgreementCount: null,
    assistTopUniversities: [],
    scorecard: {
      tuition: 5680,
      tuitionStateMedian: 5000,
      earnings10yr: 42300,
      earningsStateMedian: 38000,
      retentionFullTime: 0.68,
      pellRate: 0.41,
      pellStateAvg: 0.39,
    },
    seniorWaiver: { ageThreshold: 60, legalCitation: "§23.1-901" },
    primaryCity: "Annandale",
    additionalCities: ["Alexandria", "Manassas"],
    ...overrides,
  };
}

function makeStateInsights(
  overrides: Partial<StateInsights> = {},
): StateInsights {
  return {
    state: "va",
    stateName: "Virginia",
    systemName: "VCCS",
    term: "2026FA",
    totalSections: 28400,
    collegesWithData: 23,
    totalColleges: 23,
    largestCollege: {
      collegeCode: "northern-virginia-community-college",
      collegeName: "Northern Virginia Community College",
      sectionCount: 4250,
    },
    smallestCollege: {
      collegeCode: "eastern-shore-community-college",
      collegeName: "Eastern Shore Community College",
      sectionCount: 95,
    },
    topSubjects: [
      { prefix: "ENG", sectionCount: 1820, collegesOffering: 23 },
      { prefix: "MTH", sectionCount: 1640, collegesOffering: 23 },
      { prefix: "BIO", sectionCount: 1310, collegesOffering: 23 },
    ],
    topTransferDestinations: [
      { university: "Virginia Commonwealth University", mappingCount: 8200 },
      { university: "George Mason University", mappingCount: 7100 },
      { university: "Old Dominion University", mappingCount: 6800 },
    ],
    totalTransferMappings: 32_000,
    assistAgreementCount: null,
    assistTopPairs: [],
    blogPostCount: 22,
    seniorWaiver: {
      ageThreshold: 60,
      legalCitation: "§23.1-901",
      bannerDetail: "Free for VA residents 60+",
    },
    scorecard: {
      medianTuition: 5000,
      medianNetPrice: 8200,
      medianEarnings: 38000,
      medianCompletion: 0.32,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Banned-phrase enforcement
// ---------------------------------------------------------------------------

describe("BANNED_PHRASES enforcement", () => {
  function flatText(parts: string[]): string {
    return parts.join(" ").toLowerCase();
  }

  it("contains no banned phrases in college prose for a full insight bundle", () => {
    const text = flatText(renderCollegeProse(makeCollegeInsights()));
    for (const phrase of BANNED_PHRASES) {
      expect(text).not.toContain(phrase);
    }
  });

  it("contains no banned phrases in state prose for a full insight bundle", () => {
    const text = flatText(renderStateProse(makeStateInsights()));
    for (const phrase of BANNED_PHRASES) {
      expect(text).not.toContain(phrase);
    }
  });

  it("contains no banned phrases across all 3 variants for the catalog-rank fact", () => {
    // Render the same insights against 12 distinct college IDs to spread
    // across all 3 variant pools and confirm none reach the banned list.
    for (let i = 0; i < 12; i++) {
      const insights = makeCollegeInsights({
        collegeId: `synthetic-college-${i}`,
      });
      const text = flatText(renderCollegeProse(insights));
      for (const phrase of BANNED_PHRASES) {
        expect(text).not.toContain(phrase);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Skip-when-unremarkable behaviour
// ---------------------------------------------------------------------------

describe("renderCollegeProse skip rules", () => {
  it("returns empty array when fewer than 2 sentences qualify", () => {
    // Minimal insights — only section count, no rank, no subjects, no
    // transfer data, no scorecard, no senior waiver.
    const thin = makeCollegeInsights({
      termSectionCount: null,
      sectionRank: null,
      topSubjects: [],
      modeShares: { inPerson: null, hybrid: null, online: null },
      lateStartCount: null,
      lateStartRank: null,
      topTransferDestinations: [],
      totalTransferMappings: null,
      assistAgreementCount: null,
      assistTopUniversities: [],
      scorecard: null,
      seniorWaiver: null,
    });
    expect(renderCollegeProse(thin)).toEqual([]);
  });

  it("omits the online-mode sentence when delta vs state median is < 5pp", () => {
    const median = makeCollegeInsights({
      modeShares: {
        inPerson: { pct: 58, statePct: 60, delta: -2 },
        hybrid: { pct: 9, statePct: 8, delta: 1 },
        online: { pct: 24, statePct: 22, delta: 2 },
      },
    });
    const text = renderCollegeProse(median).join(" ").toLowerCase();
    expect(text).not.toContain("online");
  });

  it("omits the late-start sentence when this college is in the bottom half by late-start count", () => {
    const bottomHalf = makeCollegeInsights({
      lateStartRank: { position: 20, outOf: 23, value: 12 },
    });
    const text = renderCollegeProse(bottomHalf).join(" ").toLowerCase();
    expect(text).not.toContain("late-start");
  });

  it("omits the cost sentence when tuition is within $250 of the state median", () => {
    const median = makeCollegeInsights({
      scorecard: {
        tuition: 5100,
        tuitionStateMedian: 5000,
        earnings10yr: 38500,
        earningsStateMedian: 38000,
        retentionFullTime: 0.7,
        pellRate: 0.4,
        pellStateAvg: 0.4,
      },
    });
    const text = renderCollegeProse(median).join(" ").toLowerCase();
    expect(text).not.toContain("scorecard");
  });
});

describe("renderStateProse skip rules", () => {
  it("returns empty array when nothing qualifies", () => {
    const empty: StateInsights = {
      state: "xx",
      stateName: "Nowhere",
      systemName: "NoSys",
      term: null,
      totalSections: null,
      collegesWithData: 0,
      totalColleges: 0,
      largestCollege: null,
      smallestCollege: null,
      topSubjects: [],
      topTransferDestinations: [],
      totalTransferMappings: null,
      assistAgreementCount: null,
      assistTopPairs: [],
      blogPostCount: 0,
      seniorWaiver: null,
      scorecard: null,
    };
    expect(renderStateProse(empty)).toEqual([]);
  });

  it("renders the largest college alone if smallest is missing or ranks too few", () => {
    const sparse = makeStateInsights({ smallestCollege: null });
    const text = renderStateProse(sparse).join(" ");
    expect(text).toContain("Northern Virginia Community College");
    expect(text).not.toContain("smallest");
  });
});

// ---------------------------------------------------------------------------
// 3. Variant distribution
// ---------------------------------------------------------------------------

describe("pickVariant", () => {
  it("distributes keys roughly evenly across N variants", () => {
    const counts = [0, 0, 0];
    for (let i = 0; i < 300; i++) {
      const idx = pickVariant(`college-${i}:catalog`, 3);
      counts[idx]++;
    }
    // Each bucket should be within ±25% of the expected 100.
    for (const c of counts) {
      expect(c).toBeGreaterThanOrEqual(75);
      expect(c).toBeLessThanOrEqual(125);
    }
  });

  it("is deterministic — same key always returns the same index", () => {
    const a = pickVariant("northern-virginia-community-college:catalog", 3);
    const b = pickVariant("northern-virginia-community-college:catalog", 3);
    expect(a).toBe(b);
  });

  it("returns 0 when n <= 0", () => {
    expect(pickVariant("anything", 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Cite-source-inline check
// ---------------------------------------------------------------------------

describe("source-citation phrasing", () => {
  it("uses at least one inline source citation in a full college bundle", () => {
    const text = renderCollegeProse(makeCollegeInsights()).join(" ");
    const citationPatterns = [
      /Federal College Scorecard data/i,
      /federal College Scorecard/i,
      /state transfer records/i,
      /Across .*'s catalog this term/i,
      /California ASSIST registry/i,
    ];
    const matched = citationPatterns.some((p) => p.test(text));
    expect(matched).toBe(true);
  });

  it("uses at least one inline source citation in a full state bundle", () => {
    const text = renderStateProse(makeStateInsights()).join(" ");
    const citationPatterns = [
      /Federal College Scorecard data/i,
      /federal College Scorecard/i,
      /state transfer records/i,
      /California ASSIST registry/i,
    ];
    const matched = citationPatterns.some((p) => p.test(text));
    expect(matched).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Per-page determinism across rebuilds
// ---------------------------------------------------------------------------

describe("per-page determinism", () => {
  it("renders identical prose on two calls with the same insights", () => {
    const a = renderCollegeProse(makeCollegeInsights());
    const b = renderCollegeProse(makeCollegeInsights());
    expect(a).toEqual(b);
  });

  it("renders different sentences for different college IDs (variant spread)", () => {
    const a = renderCollegeProse(
      makeCollegeInsights({ collegeId: "alpha-college" }),
    );
    const b = renderCollegeProse(
      makeCollegeInsights({ collegeId: "zulu-college" }),
    );
    // At least one paragraph should differ between two arbitrarily-named
    // colleges with the same numeric inputs.
    const same = a.length === b.length && a.every((p, i) => p === b[i]);
    expect(same).toBe(false);
  });
});

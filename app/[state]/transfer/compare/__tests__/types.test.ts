import { describe, it, expect } from "vitest";
import {
  buildBestMappingLookup,
  rankMapping,
  getCellInfo,
  isHeavyTransferState,
  HEAVY_PRELOAD_THRESHOLD,
  CELL_COLORS,
} from "../types";
import type { TransferMapping } from "@/lib/types";
import type { CCCourse, CellStatus } from "../types";

function mk(partial: Partial<TransferMapping>): TransferMapping {
  return {
    cc_prefix: "ACCT",
    cc_number: "1100",
    cc_course: "ACCT 1100",
    cc_title: "Financial Accounting I",
    cc_credits: "4",
    university: "uga",
    university_name: "University of Georgia",
    univ_course: "",
    univ_title: "",
    univ_credits: "",
    notes: "",
    no_credit: false,
    is_elective: false,
    ...partial,
  };
}

const ACCT1100: CCCourse = { prefix: "ACCT", number: "1100", course: "ACCT 1100", title: "Financial Accounting I" };

describe("rankMapping", () => {
  it("orders direct > elective > no-credit", () => {
    expect(rankMapping(mk({}))).toBeGreaterThan(rankMapping(mk({ is_elective: true })));
    expect(rankMapping(mk({ is_elective: true }))).toBeGreaterThan(rankMapping(mk({ no_credit: true })));
  });
});

describe("buildBestMappingLookup", () => {
  it("keeps the best outcome per (course, university) regardless of array order (worst last)", () => {
    // Real-world shape: one CC course maps to several university courses, with the
    // WORST outcome last in the array — last-wins would wrongly show 'no-credit'.
    const mappings = [
      mk({ univ_course: "ACCT 2101", no_credit: false, is_elective: false }), // direct
      mk({ univ_course: "ACCT 0XXX", is_elective: true }), // elective
      mk({ univ_course: "", no_credit: true }), // no-credit (LAST)
    ];
    const cell = getCellInfo(ACCT1100, "uga", buildBestMappingLookup(mappings));
    expect(cell.status).toBe("direct");
    expect(cell.course).toBe("ACCT 2101");
  });

  it("upgrades no-credit to elective when an elective mapping exists", () => {
    const mappings = [mk({ no_credit: true }), mk({ is_elective: true, univ_course: "X 1XXX" })];
    const cell = getCellInfo(ACCT1100, "uga", buildBestMappingLookup(mappings));
    expect(cell.status).toBe("elective");
  });

  it("keeps separate best entries per university", () => {
    const mappings = [
      mk({ university: "uga", no_credit: false, is_elective: false }), // direct at uga
      mk({ university: "gatech", no_credit: true }), // no-credit at gatech
    ];
    const lookup = buildBestMappingLookup(mappings);
    expect(lookup.size).toBe(2);
    expect(getCellInfo(ACCT1100, "uga", lookup).status).toBe("direct");
    expect(getCellInfo(ACCT1100, "gatech", lookup).status).toBe("no-credit");
  });

  it("is deterministic on ties — keeps the first direct mapping", () => {
    const mappings = [
      mk({ univ_course: "ACCT 2101" }), // direct (first)
      mk({ univ_course: "ACCT 2102" }), // direct (second, same rank)
    ];
    const cell = getCellInfo(ACCT1100, "uga", buildBestMappingLookup(mappings));
    expect(cell.course).toBe("ACCT 2101");
  });

  it("returns unknown for a course with no mapping", () => {
    const cell = getCellInfo(ACCT1100, "uga", buildBestMappingLookup([]));
    expect(cell.status).toBe("unknown");
  });
});

describe("isHeavyTransferState", () => {
  it("is false for a small state (auto-preload)", () => {
    // GA-shape: a handful of universities, ~10K total rows.
    const unis = [
      { mappingCount: 3000 },
      { mappingCount: 2500 },
      { mappingCount: 4000 },
    ];
    expect(isHeavyTransferState(unis)).toBe(false);
  });

  it("is true for a heavy state (gate behind Load all)", () => {
    // MI-shape: few universities but ~150K total rows.
    const unis = [
      { mappingCount: 80000 },
      { mappingCount: 70000 },
    ];
    expect(isHeavyTransferState(unis)).toBe(true);
  });

  it("treats missing counts as zero — unknown-size states default to auto-preload", () => {
    expect(isHeavyTransferState([{}, {}, {}])).toBe(false);
    expect(isHeavyTransferState([])).toBe(false);
  });

  it("uses a strict threshold (exactly at the cutoff is not heavy)", () => {
    expect(isHeavyTransferState([{ mappingCount: HEAVY_PRELOAD_THRESHOLD }])).toBe(false);
    expect(isHeavyTransferState([{ mappingCount: HEAVY_PRELOAD_THRESHOLD + 1 }])).toBe(true);
  });

  it("sums counts across universities, not per-university", () => {
    // Each university is small, but 43 of them (TX-shape) sum past the cutoff.
    const unis = Array.from({ length: 43 }, () => ({ mappingCount: 4400 }));
    expect(isHeavyTransferState(unis)).toBe(true);
  });
});

describe("getCellInfo — status, glyph, and colors (direct, not just via lookup)", () => {
  const lookupFor = (m: TransferMapping) =>
    new Map([[`${m.cc_prefix} ${m.cc_number}|${m.university}`, m]]);

  it("direct → ✓ with the equivalent university course", () => {
    const cell = getCellInfo(ACCT1100, "uga", lookupFor(mk({ univ_course: "ACCT 2101" })));
    expect(cell.status).toBe("direct");
    expect(cell.label).toBe("✓");
    expect(cell.course).toBe("ACCT 2101");
  });
  it("elective → ~", () => {
    const cell = getCellInfo(ACCT1100, "uga", lookupFor(mk({ is_elective: true, univ_course: "X 1XXX" })));
    expect(cell.status).toBe("elective");
    expect(cell.label).toBe("~");
  });
  it("no-credit → ✗ with no course", () => {
    const cell = getCellInfo(ACCT1100, "uga", lookupFor(mk({ no_credit: true })));
    expect(cell.status).toBe("no-credit");
    expect(cell.label).toBe("✗");
    expect(cell.course).toBe("");
  });
  it("missing mapping → unknown / —", () => {
    const cell = getCellInfo(ACCT1100, "uga", new Map());
    expect(cell.status).toBe("unknown");
    expect(cell.label).toBe("—");
  });
  it("CELL_COLORS has an entry for every status (no missing key → no blank cell)", () => {
    (["direct", "elective", "no-credit", "unknown"] as CellStatus[]).forEach((s) =>
      expect(CELL_COLORS[s]).toBeTruthy(),
    );
  });
});

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import {
  matchTitle,
  normalizeTitle,
  type CatalogCourse,
} from "../resolve-course";

// ───────────────────────── normalizeTitle ─────────────────────────

describe("normalizeTitle", () => {
  it("lowercases and strips punctuation", () => {
    expect(normalizeTitle("Intro. to Psychology!")).toBe("introduction to psychology");
  });
  it("maps roman numerals to arabic", () => {
    expect(normalizeTitle("Calculus II")).toBe("calculus 2");
    expect(normalizeTitle("Anatomy III")).toBe("anatomy 3");
  });
  it("expands & to 'and'", () => {
    expect(normalizeTitle("Arts & Crafts")).toBe("arts and crafts");
  });
  it("collapses dotted acronyms", () => {
    expect(normalizeTitle("D.C. Circuits")).toBe("dc circuits");
    expect(normalizeTitle("U.S. History")).toBe("us history");
  });
  it("folds common abbreviations", () => {
    expect(normalizeTitle("Intro to Info Systems")).toBe("introduction to information systems");
  });
});

// ───────────────────────── matchTitle (curated) ─────────────────────────

const ARABIC: CatalogCourse[] = [
  { prefix: "ARA", number: "101", title: "Beginning Arabic I" },
  { prefix: "ARA", number: "102", title: "Beginning Arabic II" },
  { prefix: "ARA", number: "201", title: "Intermediate Arabic I" },
  { prefix: "ARA", number: "202", title: "Intermediate Arabic II" },
];

describe("matchTitle — the screenshot case (Intermediate Arabic II → ARA 202)", () => {
  it("resolves the full title", () => {
    const r = matchTitle(ARABIC, "Intermediate Arabic II");
    expect(r.resolved).toEqual({ prefix: "ARA", number: "202" });
    expect(r.reason).toBe("exact");
  });
  it("resolves arabic-numeral + lowercase variant", () => {
    expect(matchTitle(ARABIC, "intermediate arabic 2").resolved).toEqual({
      prefix: "ARA",
      number: "202",
    });
  });
  it("keeps the level numerals apart (II never resolves to I)", () => {
    expect(matchTitle(ARABIC, "Intermediate Arabic I").resolved).toEqual({
      prefix: "ARA",
      number: "201",
    });
  });
  it("DEFERS the ambiguous 'Arabic II' (102 vs 202, no margin)", () => {
    const r = matchTitle(ARABIC, "Arabic II");
    expect(r.resolved).toBeNull();
    expect(r.suggestions.map((s) => s.code).sort()).toEqual(["ARA 102", "ARA 202"]);
  });
  it("DEFERS a lone subject word", () => {
    expect(matchTitle(ARABIC, "Arabic").resolved).toBeNull();
  });
});

describe("matchTitle — multi-college collision must DEFER, never guess", () => {
  const ACCT: CatalogCourse[] = [
    { prefix: "ACCT", number: "101", title: "Financial Accounting" },
    { prefix: "ACCT", number: "201", title: "Financial Accounting" },
    { prefix: "ACCT", number: "301", title: "Financial Accounting" },
  ];
  it("defers when the same title maps to many numbers", () => {
    const r = matchTitle(ACCT, "Financial Accounting");
    expect(r.resolved).toBeNull();
    expect(r.reason).toBe("exact-ambiguous");
    expect(r.suggestions).toHaveLength(3);
  });
});

describe("matchTitle — honors guard", () => {
  const LIT: CatalogCourse[] = [
    { prefix: "LIT", number: "2110", title: "World Literature I" },
    { prefix: "LIT", number: "2110H", title: "World Literature I Honors" },
  ];
  it("non-honors query resolves to the non-honors code", () => {
    expect(matchTitle(LIT, "World Literature I").resolved).toEqual({
      prefix: "LIT",
      number: "2110",
    });
  });
  it("honors query resolves to the honors code", () => {
    expect(matchTitle(LIT, "World Literature I Honors").resolved).toEqual({
      prefix: "LIT",
      number: "2110H",
    });
  });
});

describe("matchTitle — fuzzy tolerance with a clear winner", () => {
  const BIO: CatalogCourse[] = [
    { prefix: "BIO", number: "101", title: "General Biology I" },
    { prefix: "BIO", number: "102", title: "General Biology II" },
    { prefix: "BIO", number: "256", title: "Genetics" },
  ];
  it("resolves a paraphrase that still uniquely covers one course", () => {
    // "General Biology 1" exact → BIO 101.
    expect(matchTitle(BIO, "general biology 1").resolved).toEqual({
      prefix: "BIO",
      number: "101",
    });
  });
  it("returns empty reason for an unmatchable query", () => {
    const r = matchTitle(BIO, "underwater basket weaving");
    expect(r.resolved).toBeNull();
  });
});

// ───────────────────────── cross-state round-trip (the safety lock) ─────────────────────────
//
// For every distinct code in a real state catalog, feed its own canonical
// title back through the subject-scoped matcher. The matcher must resolve to
// that code or DEFER — it must NEVER resolve to a different code. This is the
// property that keeps the feature from ever showing a wrong prereq/transfer.
//
// VA + NC run always (fast). TX + CA (large, multi-district) are gated behind
// RESOLVER_FULL_BATTERY=1 to keep the default suite quick; they were verified
// at 0 false-resolves during development.

interface RoundTripResult {
  state: string;
  codes: number;
  resolved: number;
  deferred: number;
  falseResolved: number;
  falseExamples: string[];
}

function loadStateCatalog(state: string): Map<string, CatalogCourse[]> {
  const base = path.join(process.cwd(), "data", state, "courses");
  const byPrefix = new Map<string, CatalogCourse[]>();
  if (!fs.existsSync(base)) return byPrefix;
  const seen = new Set<string>(); // dedupe (prefix,number,normTitle)
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".json")) {
        let arr: unknown;
        try {
          arr = JSON.parse(fs.readFileSync(p, "utf8"));
        } catch {
          continue;
        }
        if (!Array.isArray(arr)) continue;
        for (const s of arr as Array<Record<string, string>>) {
          const prefix = s?.course_prefix;
          const number = s?.course_number;
          const title = s?.course_title;
          if (!prefix || !number || !title) continue;
          const key = `${prefix}|${number}|${normalizeTitle(title)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const list = byPrefix.get(prefix) ?? [];
          list.push({ prefix, number, title });
          byPrefix.set(prefix, list);
        }
      }
    }
  };
  walk(base);
  return byPrefix;
}

function roundTrip(state: string): RoundTripResult {
  const byPrefix = loadStateCatalog(state);
  let codes = 0;
  let resolved = 0;
  let deferred = 0;
  let falseResolved = 0;
  const falseExamples: string[] = [];

  for (const [, catalog] of byPrefix) {
    // distinct codes in this prefix, with their longest title variant
    const codeTitle = new Map<string, string>();
    for (const c of catalog) {
      const code = `${c.prefix} ${c.number}`;
      const prev = codeTitle.get(code);
      if (!prev || c.title.length > prev.length) codeTitle.set(code, c.title);
    }
    for (const [code, title] of codeTitle) {
      codes++;
      const r = matchTitle(catalog, title);
      if (!r.resolved) {
        deferred++;
      } else if (`${r.resolved.prefix} ${r.resolved.number}` === code) {
        resolved++;
      } else {
        falseResolved++;
        if (falseExamples.length < 20) {
          falseExamples.push(`"${title}" → ${r.resolved.prefix} ${r.resolved.number} (self ${code})`);
        }
      }
    }
  }
  return { state, codes, resolved, deferred, falseResolved, falseExamples };
}

describe("cross-state round-trip — false-resolve must be ZERO", () => {
  it("VA: 0 false-resolves, ≥90% resolve", () => {
    const r = roundTrip("va");
    expect(r.codes).toBeGreaterThan(500);
    expect(r.falseExamples).toEqual([]);
    expect(r.falseResolved).toBe(0);
    expect(r.resolved / r.codes).toBeGreaterThan(0.9);
  });

  it("NC: 0 false-resolves, ≥80% resolve", () => {
    const r = roundTrip("nc");
    expect(r.codes).toBeGreaterThan(500);
    expect(r.falseExamples).toEqual([]);
    expect(r.falseResolved).toBe(0);
    expect(r.resolved / r.codes).toBeGreaterThan(0.8);
  });

  const fullBattery = process.env.RESOLVER_FULL_BATTERY === "1";
  it.runIf(fullBattery)(
    "TX + CA (large, multi-district): 0 false-resolves",
    () => {
      for (const state of ["tx", "ca"]) {
        const r = roundTrip(state);
        expect(r.codes).toBeGreaterThan(1000);
        expect(r.falseExamples).toEqual([]);
        expect(r.falseResolved).toBe(0);
        // multi-district states defer far more — only assert a non-trivial floor
        expect(r.resolved / r.codes).toBeGreaterThan(0.5);
      }
    },
    60_000,
  );
});

describe("matchTitle / normalizeTitle — edge cases", () => {
  it("returns reason 'empty' for an empty/whitespace title or empty catalog", () => {
    const cat: CatalogCourse[] = [{ prefix: "BIO", number: "101", title: "General Biology I" }];
    expect(matchTitle(cat, "").reason).toBe("empty");
    expect(matchTitle(cat, "   ").resolved).toBeNull();
    expect(matchTitle([], "Anything").reason).toBe("empty");
  });

  it("does NOT treat a multi-digit course number in the title as a level numeral", () => {
    expect(normalizeTitle("English 101")).toBe("english 101");
    const cat: CatalogCourse[] = [
      { prefix: "ENG", number: "1", title: "English 101" },
      { prefix: "ENG", number: "2", title: "English 102" },
    ];
    expect(matchTitle(cat, "English 101").resolved).toEqual({ prefix: "ENG", number: "1" });
    expect(matchTitle(cat, "English 102").resolved).toEqual({ prefix: "ENG", number: "2" });
  });

  it("resolves a single-token title only when it is exact AND unique", () => {
    const unique: CatalogCourse[] = [
      { prefix: "BIO", number: "256", title: "Genetics" },
      { prefix: "BIO", number: "101", title: "General Biology I" },
    ];
    expect(matchTitle(unique, "Genetics").resolved).toEqual({ prefix: "BIO", number: "256" });
    const ambiguous: CatalogCourse[] = [
      { prefix: "BIO", number: "256", title: "Genetics" },
      { prefix: "BIO", number: "257", title: "Genetics" },
    ];
    expect(matchTitle(ambiguous, "Genetics").resolved).toBeNull();
  });
});

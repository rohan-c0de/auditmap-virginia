import { describe, it, expect } from "vitest";
import {
  countBySource,
  countByField,
  sourceRegressions,
  universityRegressions,
  countRows,
} from "@/scripts/lib/scrape-diff";

/**
 * Per-source regression detection for prereqs.json. The file-level 50%
 * gate misses one input vanishing from a merged file: MA's 2026-06 cron
 * run deleted all 926 gcc/middlesex catalog entries but kept 52.4% of
 * total rows, so the workflow opened a routine-looking PR.
 */

const prereqs = (entries: Record<string, { source?: string }>) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(entries).map(([k, v]) => [
        k,
        { text: "x", courses: [], ...v },
      ]),
    ),
  );

const bulk = (prefix: string, n: number, source?: string) =>
  Object.fromEntries(
    Array.from({ length: n }, (_, i) => [
      `${prefix} ${100 + i}`,
      source ? { source } : {},
    ]),
  );

describe("countBySource", () => {
  it("groups tagged entries by source and untagged under 'aggregate'", () => {
    const text = prereqs({
      "ENG 101": { source: "gcc" },
      "ENG 102": { source: "gcc" },
      "MAT 150": { source: "middlesex" },
      "BIO 101": {},
    });
    expect(countBySource(text)).toEqual({
      gcc: 2,
      middlesex: 1,
      aggregate: 1,
    });
  });

  it("returns no groups for arrays or unparseable text", () => {
    expect(countBySource("[1,2,3]")).toEqual({});
    expect(countBySource("not json")).toEqual({});
  });
});

describe("sourceRegressions", () => {
  it("flags a source that vanishes while the total stays above 50% (the MA wipe)", () => {
    // 60 aggregate + 40 sourced → sourced deleted leaves 60% of rows:
    // file-level gate passes, per-source gate must not.
    const before = prereqs({ ...bulk("AGG", 60), ...bulk("GCC", 40, "gcc") });
    const after = prereqs(bulk("AGG", 60));
    expect(countRows(after) / countRows(before)).toBeGreaterThan(0.5);

    const regressions = sourceRegressions("data/ma/prereqs.json", before, after);

    expect(regressions).toHaveLength(1);
    expect(regressions[0]).toMatchObject({
      file: "data/ma/prereqs.json [source: gcc]",
      before: 40,
      after: 0,
      ratio: "0.0%",
    });
  });

  it("passes when every source retains at least half its entries", () => {
    const before = prereqs({ ...bulk("AGG", 60), ...bulk("GCC", 40, "gcc") });
    const after = prereqs({ ...bulk("AGG", 55), ...bulk("GCC", 22, "gcc") });
    expect(sourceRegressions("f", before, after)).toEqual([]);
  });

  it("ignores groups smaller than minGroup — a 4→1 blip is not an abort", () => {
    const before = prereqs(bulk("TINY", 4, "tiny"));
    const after = prereqs(bulk("TINY", 1, "tiny"));
    expect(sourceRegressions("f", before, after)).toEqual([]);
  });

  it("flags the aggregate group collapsing under sourced growth", () => {
    // Sourced entries ballooning can mask aggregation dying entirely.
    const before = prereqs({ ...bulk("AGG", 50), ...bulk("GCC", 50, "gcc") });
    const after = prereqs({ ...bulk("AGG", 5), ...bulk("GCC", 90, "gcc") });

    const regressions = sourceRegressions("f", before, after);

    expect(regressions).toHaveLength(1);
    expect(regressions[0]).toMatchObject({
      file: "f [source: aggregate]",
      before: 50,
      after: 5,
    });
  });
});

/**
 * Per-university regression detection for transfer-equiv.json. Same blind
 * spot as prereqs sources: RI's 2026-06 cron run shipped RIC at 546 of
 * 840 rows (−35%) while the file-level ratio read 87% (PR #1261) — one
 * TES target's pagination died mid-GridView and the partial set replaced
 * the committed rows.
 */

const transfers = (rows: Array<{ university?: string }>) =>
  JSON.stringify(rows.map((r) => ({ cc_course: "X 100", ...r })));

const univRows = (university: string, n: number) =>
  Array.from({ length: n }, () => ({ university }));

describe("countByField", () => {
  it("groups array rows by the field, missing values under '(none)'", () => {
    const text = transfers([
      ...univRows("uri", 2),
      ...univRows("ric", 1),
      {},
    ]);
    expect(countByField(text, "university")).toEqual({
      uri: 2,
      ric: 1,
      "(none)": 1,
    });
  });

  it("returns no groups for objects or unparseable text", () => {
    expect(countByField('{"a": 1}', "university")).toEqual({});
    expect(countByField("not json", "university")).toEqual({});
  });
});

describe("universityRegressions", () => {
  it("flags the exact PR #1261 payload: ric 840→546 (65%) inside a passing file total", () => {
    // The real incident numbers. 546/840 = 65% sails past the 50%
    // file-level gate — only the tighter 75% per-receiver threshold
    // catches it.
    const before = transfers([
      ...univRows("uri", 795),
      ...univRows("ric", 840),
      ...univRows("jwu", 590),
    ]);
    const after = transfers([
      ...univRows("uri", 796),
      ...univRows("ric", 546),
      ...univRows("jwu", 591),
    ]);
    expect(countRows(after) / countRows(before)).toBeGreaterThan(0.5);

    const regressions = universityRegressions(
      "data/ri/transfer-equiv.json",
      before,
      after,
    );

    expect(regressions).toHaveLength(1);
    expect(regressions[0]).toMatchObject({
      file: "data/ri/transfer-equiv.json [university: ric]",
      before: 840,
      after: 546,
      ratio: "65.0%",
    });
  });

  it("passes when every receiver retains at least 75% of its rows", () => {
    const before = transfers([...univRows("uri", 100), ...univRows("ric", 80)]);
    const after = transfers([...univRows("uri", 80), ...univRows("ric", 61)]);
    expect(universityRegressions("f", before, after)).toEqual([]);
  });

  it("ignores receivers smaller than minGroup", () => {
    const before = transfers(univRows("tiny-college", 5));
    const after = transfers(univRows("tiny-college", 1));
    expect(universityRegressions("f", before, after)).toEqual([]);
  });
});

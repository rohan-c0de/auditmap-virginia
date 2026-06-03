import { describe, expect, it, vi, beforeEach } from "vitest";

// Supabase mock — installed before importing the subject so the module
// picks up the mocked client. Tracks each call's filters so the tests can
// assert the targeted-query shape (`.eq('state', …).or(<compound>)`).
const { selectMock, eqMock, orMock, fromMock, supabaseClient } = vi.hoisted(() => {
  // Queue of responses so a single test that triggers multiple chunks can
  // return different rows per chunk. Default is an empty success result.
  const state: { responses: Array<{ data: unknown[] | null; error: unknown }> } = {
    responses: [],
  };
  const orMock = vi.fn(async (_filter: string) => { // eslint-disable-line @typescript-eslint/no-unused-vars
    return state.responses.length > 0
      ? state.responses.shift()!
      : { data: [], error: null };
  });
  const eqMock = vi.fn();
  const selectMock = vi.fn();
  type Chain = {
    select: (cols: string) => Chain;
    eq: (col: string, val: unknown) => Chain;
    or: (filter: string) => ReturnType<typeof orMock>;
  };
  const chain: Chain = {
    select: (cols: string) => {
      selectMock(cols);
      return chain;
    },
    eq: (col: string, val: unknown) => {
      eqMock(col, val);
      return chain;
    },
    or: (filter: string) => orMock(filter),
  };
  const fromMock = vi.fn(() => chain);
  return {
    selectMock,
    eqMock,
    orMock,
    fromMock,
    supabaseClient: {
      from: fromMock,
      _queueResponses: (rs: Array<{ data: unknown[] | null; error: unknown }>) => {
        state.responses = rs;
      },
    },
  };
});

vi.mock("../supabase", () => ({ supabase: supabaseClient }));

import {
  capMappingsByRoundRobin,
  trimMappingsForClient,
  loadTransferMappingsForCourses,
  TRANSFER_HUB_MAX_CLIENT_MAPPINGS,
} from "../transfer";
import type { TransferMapping } from "../types";

function makeMapping(prefix: string, number: string): TransferMapping {
  return {
    cc_prefix: prefix,
    cc_number: number,
    cc_course: `${prefix} ${number}`,
    cc_title: `${prefix} ${number} Title`,
    cc_credits: "3",
    university: "uni",
    university_name: "Test University",
    univ_course: `U${prefix} ${number}`,
    univ_title: "Univ Title",
    univ_credits: "3",
    notes: "",
    no_credit: false,
    is_elective: false,
  };
}

describe("capMappingsByRoundRobin", () => {
  it("returns input unchanged when below cap", () => {
    const input = [makeMapping("ENG", "111"), makeMapping("MTH", "161")];
    expect(capMappingsByRoundRobin(input, 100)).toBe(input);
  });

  it("never exceeds the cap", () => {
    const input: TransferMapping[] = [];
    for (let i = 0; i < 5000; i++) input.push(makeMapping("ENG", String(i)));
    const capped = capMappingsByRoundRobin(input, 100);
    expect(capped.length).toBe(100);
  });

  it("preserves every subject when one bucket dominates the input", () => {
    // 5000 ENG + 5 MTH + 5 BIO. A naive top-N slice would drop MTH/BIO.
    const input: TransferMapping[] = [];
    for (let i = 0; i < 5000; i++) input.push(makeMapping("ENG", String(i)));
    for (let i = 0; i < 5; i++) input.push(makeMapping("MTH", String(i)));
    for (let i = 0; i < 5; i++) input.push(makeMapping("BIO", String(i)));

    const capped = capMappingsByRoundRobin(input, 100);
    const prefixes = new Set(capped.map((m) => m.cc_prefix));
    expect(prefixes.has("ENG")).toBe(true);
    expect(prefixes.has("MTH")).toBe(true);
    expect(prefixes.has("BIO")).toBe(true);
  });

  it("rotates buckets so smaller subjects are not starved", () => {
    // With 3 buckets each of size 50 and a cap of 30, round-robin should
    // deliver an even-ish distribution rather than 30 from one bucket.
    const input: TransferMapping[] = [];
    for (let i = 0; i < 50; i++) input.push(makeMapping("ENG", String(i)));
    for (let i = 0; i < 50; i++) input.push(makeMapping("MTH", String(i)));
    for (let i = 0; i < 50; i++) input.push(makeMapping("BIO", String(i)));

    const capped = capMappingsByRoundRobin(input, 30);
    expect(capped.length).toBe(30);
    const counts: Record<string, number> = {};
    for (const m of capped) counts[m.cc_prefix] = (counts[m.cc_prefix] ?? 0) + 1;
    expect(counts.ENG).toBe(10);
    expect(counts.MTH).toBe(10);
    expect(counts.BIO).toBe(10);
  });

  it("handles empty input", () => {
    expect(capMappingsByRoundRobin([], 100)).toEqual([]);
  });
});

describe("trimMappingsForClient", () => {
  it("strips fields outside the client subset", () => {
    const trimmed = trimMappingsForClient([makeMapping("ENG", "111")]);
    expect(trimmed[0]).toEqual({
      cc_prefix: "ENG",
      cc_number: "111",
      cc_title: "ENG 111 Title",
      cc_credits: "3",
      univ_course: "UENG 111",
      univ_title: "Univ Title",
      notes: "",
      is_elective: false,
    });
    // Verify these source-only fields are gone.
    expect((trimmed[0] as unknown as { university?: string }).university).toBeUndefined();
    expect((trimmed[0] as unknown as { no_credit?: boolean }).no_credit).toBeUndefined();
  });

  it("preserves array length", () => {
    const input = [
      makeMapping("ENG", "111"),
      makeMapping("ENG", "112"),
      makeMapping("MTH", "161"),
    ];
    expect(trimMappingsForClient(input)).toHaveLength(3);
  });
});

describe("TRANSFER_HUB_MAX_CLIENT_MAPPINGS", () => {
  it("matches the documented Vercel-payload-safe ceiling", () => {
    expect(TRANSFER_HUB_MAX_CLIENT_MAPPINGS).toBe(2500);
  });
});

describe("loadTransferMappingsForCourses", () => {
  beforeEach(() => {
    fromMock.mockClear();
    selectMock.mockClear();
    eqMock.mockClear();
    orMock.mockClear();
    supabaseClient._queueResponses([]);
  });

  it("returns [] immediately when courses is empty (no Supabase call)", async () => {
    const result = await loadTransferMappingsForCourses("ca", []);
    expect(result).toEqual([]);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("queries the transfers table with state filter and a compound .or() of (prefix, number) tuples", async () => {
    supabaseClient._queueResponses([{ data: [], error: null }]);

    await loadTransferMappingsForCourses("ca", [
      { prefix: "CS", number: "110" },
      { prefix: "MATH", number: "280" },
    ]);

    expect(fromMock).toHaveBeenCalledWith("transfers");
    expect(eqMock).toHaveBeenCalledWith("state", "ca");
    expect(orMock).toHaveBeenCalledTimes(1);
    const filter = orMock.mock.calls[0][0];
    // PostgREST compound: and(cc_prefix.eq.X,cc_number.eq.Y),and(...)
    expect(filter).toContain("and(cc_prefix.eq.CS,cc_number.eq.110)");
    expect(filter).toContain("and(cc_prefix.eq.MATH,cc_number.eq.280)");
  });

  it("deduplicates repeated (prefix, number) pairs before querying", async () => {
    supabaseClient._queueResponses([{ data: [], error: null }]);

    await loadTransferMappingsForCourses("ca", [
      { prefix: "CS", number: "110" },
      { prefix: "CS", number: "110" }, // duplicate
      { prefix: "MATH", number: "280" },
      { prefix: "CS", number: "110" }, // duplicate again
    ]);

    const filter = orMock.mock.calls[0][0];
    const csOccurrences = filter.match(/cc_prefix\.eq\.CS,cc_number\.eq\.110/g) ?? [];
    expect(csOccurrences).toHaveLength(1);
    // MATH still present.
    expect(filter).toContain("cc_prefix.eq.MATH,cc_number.eq.280");
  });

  it("chunks queries at 100 distinct courses (101 → two Supabase calls)", async () => {
    supabaseClient._queueResponses([
      { data: [], error: null },
      { data: [], error: null },
    ]);

    const courses: Array<{ prefix: string; number: string }> = [];
    for (let i = 0; i < 101; i++) courses.push({ prefix: "X", number: String(i) });

    await loadTransferMappingsForCourses("ca", courses);

    expect(orMock).toHaveBeenCalledTimes(2);
  });

  it("concatenates rows from every chunk into a single result array", async () => {
    const chunk1Rows = [makeMapping("X", "1"), makeMapping("X", "2")];
    const chunk2Rows = [makeMapping("Y", "3")];
    supabaseClient._queueResponses([
      { data: chunk1Rows, error: null },
      { data: chunk2Rows, error: null },
    ]);

    const courses: Array<{ prefix: string; number: string }> = [];
    for (let i = 0; i < 101; i++) courses.push({ prefix: "X", number: String(i) });

    const result = await loadTransferMappingsForCourses("ca", courses);
    expect(result).toHaveLength(3);
    expect(result.map((m) => `${m.cc_prefix}${m.cc_number}`)).toEqual(["X1", "X2", "Y3"]);
  });

  it("returns rows when a course has matches", async () => {
    const rows = [makeMapping("CS", "110"), makeMapping("CS", "110")];
    supabaseClient._queueResponses([{ data: rows, error: null }]);

    const result = await loadTransferMappingsForCourses("ca", [
      { prefix: "CS", number: "110" },
    ]);
    expect(result).toEqual(rows);
  });

  it("returns [] (not throw) when a course has no matching transfers", async () => {
    supabaseClient._queueResponses([{ data: [], error: null }]);

    const result = await loadTransferMappingsForCourses("ca", [
      { prefix: "XXX", number: "999" },
    ]);
    expect(result).toEqual([]);
  });

  it("propagates Supabase errors instead of silently returning []", async () => {
    supabaseClient._queueResponses([
      { data: null, error: { message: "PostgREST barfed" } },
    ]);

    await expect(
      loadTransferMappingsForCourses("ca", [{ prefix: "CS", number: "110" }]),
    ).rejects.toBeTruthy();
  });

  it("selects the same column set as the existing loaders so callers get a consistent TransferMapping shape", async () => {
    supabaseClient._queueResponses([{ data: [], error: null }]);

    await loadTransferMappingsForCourses("ca", [{ prefix: "CS", number: "110" }]);

    // Columns the existing loaders fetch. Order may differ; just assert the set.
    const expected = [
      "cc_prefix",
      "cc_number",
      "cc_course",
      "cc_title",
      "cc_credits",
      "university",
      "university_name",
      "univ_course",
      "univ_title",
      "univ_credits",
      "notes",
      "no_credit",
      "is_elective",
    ];
    const selectArg = selectMock.mock.calls[0][0] as string;
    for (const col of expected) {
      expect(selectArg).toContain(col);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Audit pass (post-merge of PR #1098). These tests probe edge cases the
// initial 9 happy-path tests don't cover:
//   - PostgREST .or() filter integrity under hostile course-code characters
//   - chunk-boundary off-by-ones at exactly 100 / 200 / 201
//   - partial chunk failure (chunk 1 ok, chunk 2 throws)
//   - empty-string prefix/number (defensive)
//   - input-array mutation guarantee
// ───────────────────────────────────────────────────────────────────────────

describe("loadTransferMappingsForCourses — audit: PostgREST filter integrity", () => {
  beforeEach(() => {
    fromMock.mockClear();
    selectMock.mockClear();
    eqMock.mockClear();
    orMock.mockClear();
    supabaseClient._queueResponses([]);
  });

  // A scraped course code with a comma in it is the most dangerous case: the
  // unescaped comma SPLITS the compound .or() filter, fundamentally changing
  // the query's meaning. Real catalog data isn't supposed to have commas, but
  // bad scraper extractions do produce them (and an attacker who could insert
  // a course row could exploit it).
  it("never emits an unescaped comma-bearing payload into the .or() filter", async () => {
    supabaseClient._queueResponses([{ data: [], error: null }]);
    let threw = false;
    try {
      await loadTransferMappingsForCourses("ca", [
        { prefix: "CS,SQL_INJECTION", number: "110" },
      ]);
    } catch {
      threw = true;
    }
    if (threw) return; // acceptable defensive strategy: reject hostile input

    // Acceptable defensive strategies: (a) the bad course was skipped (filter
    // is empty or doesn't include this course's payload), or (b) the special
    // char was percent-encoded / quoted. The failure mode this catches: the
    // raw literal "SQL_INJECTION" appears in the filter string, which means
    // PostgREST is going to see it as an extra unintended operand.
    const filter = orMock.mock.calls[0]?.[0] ?? "";
    expect(filter).not.toContain("SQL_INJECTION");
  });

  // Closing paren in the number would close the outer and(...) early.
  it("either escapes or rejects a course code containing ')'", async () => {
    supabaseClient._queueResponses([{ data: [], error: null }]);
    let threw = false;
    try {
      await loadTransferMappingsForCourses("ca", [
        { prefix: "CS", number: "110)" },
      ]);
    } catch {
      threw = true;
    }
    if (threw) return;
    const filter = orMock.mock.calls[0]?.[0] ?? "";
    // Open-paren count must equal close-paren count. If the loader skipped
    // the hostile course entirely, Supabase is never called → filter is ""
    // → 0 == 0, also a pass.
    const opens = (filter.match(/\(/g) ?? []).length;
    const closes = (filter.match(/\)/g) ?? []).length;
    expect(opens).toBe(closes);
  });

  // Trailing whitespace silently mismatches Supabase storage. Either the
  // loader trims it (defensive) or throws (loud). Producing a filter with a
  // literal embedded space is the failure mode — Supabase comparison wouldn't
  // find the row, and the page would silently show no transfers.
  it("trims or rejects whitespace-padded prefix/number (matches planner's joinKey() behavior)", async () => {
    supabaseClient._queueResponses([{ data: [], error: null }]);
    let threw = false;
    try {
      await loadTransferMappingsForCourses("ca", [
        { prefix: "CS ", number: " 110" },
      ]);
    } catch {
      threw = true;
    }
    if (threw) return;
    const filter = orMock.mock.calls[0]?.[0] ?? "";
    // No raw whitespace inside an eq value — that would produce a literal
    // space in the URL filter and miss any "CS" stored without trailing space.
    // An empty filter (loader skipped the course) is also acceptable.
    expect(filter).not.toMatch(/eq\.[A-Z]+\s/);
    expect(filter).not.toMatch(/eq\.\s/);
  });

  it("empty prefix or empty number must not produce a meaningless `eq.` filter", async () => {
    supabaseClient._queueResponses([{ data: [], error: null }]);
    let threw = false;
    try {
      await loadTransferMappingsForCourses("ca", [{ prefix: "", number: "110" }]);
    } catch {
      threw = true;
    }
    if (threw) return;
    const filter = orMock.mock.calls[0]?.[0] ?? "";
    // `cc_prefix.eq.,cc_number.eq.110` is the failure mode — eq with no value.
    expect(filter).not.toContain("cc_prefix.eq.,");
    expect(filter).not.toContain("cc_number.eq.,");
    expect(filter).not.toMatch(/eq\.$/);
  });
});

describe("loadTransferMappingsForCourses — audit: chunk boundaries", () => {
  beforeEach(() => {
    fromMock.mockClear();
    selectMock.mockClear();
    eqMock.mockClear();
    orMock.mockClear();
    supabaseClient._queueResponses([]);
  });

  it("exactly 100 courses → exactly 1 chunk (off-by-one at the boundary)", async () => {
    supabaseClient._queueResponses([{ data: [], error: null }]);
    const courses: Array<{ prefix: string; number: string }> = [];
    for (let i = 0; i < 100; i++) courses.push({ prefix: "X", number: String(i) });
    await loadTransferMappingsForCourses("ca", courses);
    expect(orMock).toHaveBeenCalledTimes(1);
  });

  it("exactly 200 courses → exactly 2 chunks (not 3)", async () => {
    supabaseClient._queueResponses([
      { data: [], error: null },
      { data: [], error: null },
    ]);
    const courses: Array<{ prefix: string; number: string }> = [];
    for (let i = 0; i < 200; i++) courses.push({ prefix: "X", number: String(i) });
    await loadTransferMappingsForCourses("ca", courses);
    expect(orMock).toHaveBeenCalledTimes(2);
  });

  it("201 courses → exactly 3 chunks, no rows lost", async () => {
    const chunk1 = Array.from({ length: 100 }, (_, i) => makeMapping("A", String(i)));
    const chunk2 = Array.from({ length: 100 }, (_, i) => makeMapping("B", String(i)));
    const chunk3 = [makeMapping("C", "0")];
    supabaseClient._queueResponses([
      { data: chunk1, error: null },
      { data: chunk2, error: null },
      { data: chunk3, error: null },
    ]);
    const courses: Array<{ prefix: string; number: string }> = [];
    for (let i = 0; i < 100; i++) courses.push({ prefix: "A", number: String(i) });
    for (let i = 0; i < 100; i++) courses.push({ prefix: "B", number: String(i) });
    courses.push({ prefix: "C", number: "0" });
    const result = await loadTransferMappingsForCourses("ca", courses);
    expect(orMock).toHaveBeenCalledTimes(3);
    expect(result).toHaveLength(201);
  });
});

describe("loadTransferMappingsForCourses — audit: resilience + input safety", () => {
  beforeEach(() => {
    fromMock.mockClear();
    selectMock.mockClear();
    eqMock.mockClear();
    orMock.mockClear();
    supabaseClient._queueResponses([]);
  });

  it("if chunk 2 throws, the whole call rejects (does not silently return chunk 1's rows)", async () => {
    const chunk1Rows = [makeMapping("A", "1"), makeMapping("A", "2")];
    supabaseClient._queueResponses([
      { data: chunk1Rows, error: null },
      { data: null, error: { message: "boom" } },
    ]);
    const courses: Array<{ prefix: string; number: string }> = [];
    for (let i = 0; i < 101; i++) courses.push({ prefix: "X", number: String(i) });
    await expect(loadTransferMappingsForCourses("ca", courses)).rejects.toBeTruthy();
  });

  it("does not mutate the caller's courses array (dedup uses a local copy)", async () => {
    supabaseClient._queueResponses([{ data: [], error: null }]);
    const courses = [
      { prefix: "CS", number: "110" },
      { prefix: "CS", number: "110" }, // duplicate
      { prefix: "MATH", number: "280" },
    ];
    const snapshot = JSON.parse(JSON.stringify(courses));
    await loadTransferMappingsForCourses("ca", courses);
    expect(courses).toEqual(snapshot);
  });
});

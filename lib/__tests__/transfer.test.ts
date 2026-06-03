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

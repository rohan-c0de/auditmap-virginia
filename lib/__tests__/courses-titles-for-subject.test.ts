import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Supabase client's query-builder chain:
//   supabase.from("courses").select(...).eq("state",…).eq("course_prefix",…).range(start,end)
// `range` is the terminal awaited call; we return per-`start` pages so we can
// exercise pagination. `eqMock` captures filters so we can assert the query
// uppercases the prefix. Installed via vi.hoisted before the subject imports.
const { fromMock, eqMock, rangeMock, supabaseClient } = vi.hoisted(() => {
  const state: { pages: Map<number, { data: unknown[] | null; error: unknown }> } = {
    pages: new Map(),
  };
  const eqMock = vi.fn();
  const rangeMock = vi.fn(async (start: number) =>
    state.pages.get(start) ?? { data: [], error: null },
  );
  type Chain = {
    select: () => Chain;
    eq: (col: string, val: unknown) => Chain;
    order: (col: string, opts?: unknown) => Chain;
    range: (start: number, end: number) => Promise<{ data: unknown[] | null; error: unknown }>;
  };
  const chain: Chain = {
    select: () => chain,
    eq: (col, val) => {
      eqMock(col, val);
      return chain;
    },
    order: () => chain,
    range: (start, _end) => rangeMock(start),
  };
  const fromMock = vi.fn(() => chain);
  return {
    fromMock,
    eqMock,
    rangeMock,
    supabaseClient: {
      from: fromMock,
      _setPages: (obj: Record<number, { data: unknown[] | null; error: unknown }>) => {
        state.pages = new Map();
        for (const k of Object.keys(obj)) state.pages.set(Number(k), obj[Number(k)]);
      },
    },
  };
});

vi.mock("../supabase", () => ({ supabase: supabaseClient }));

import { getCourseTitlesForSubject } from "../courses";

// Each test uses a UNIQUE prefix so the real `cached()` (5-min TTL, module-level
// Map, not resettable) never returns a previous test's result.
beforeEach(() => {
  fromMock.mockClear();
  eqMock.mockClear();
  rangeMock.mockClear();
});

describe("getCourseTitlesForSubject", () => {
  it("uppercases the prefix in BOTH the query and the output, and dedupes (number,title)", async () => {
    supabaseClient._setPages({
      0: {
        data: [
          { course_number: "202", course_title: "Intermediate Arabic II" },
          { course_number: "202", course_title: "Intermediate Arabic II" }, // exact dup
          { course_number: "101", course_title: "Beginning Arabic I" },
        ],
        error: null,
      },
    });
    const rows = await getCourseTitlesForSubject("tst", "ara"); // lowercase input
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.prefix === "ARA")).toBe(true);
    expect(rows).toContainEqual({ prefix: "ARA", number: "202", title: "Intermediate Arabic II" });
    // query filtered on the UPPERCASE prefix
    expect(eqMock.mock.calls).toContainEqual(["course_prefix", "ARA"]);
    expect(eqMock.mock.calls).toContainEqual(["state", "tst"]);
  });

  it("keeps distinct titles for the same number (title drift across terms)", async () => {
    supabaseClient._setPages({
      0: {
        data: [
          { course_number: "120", course_title: "American Sign Language 1" },
          { course_number: "120", course_title: "1st Semester ASL" },
        ],
        error: null,
      },
    });
    const rows = await getCourseTitlesForSubject("tst", "ASLA");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.title).sort()).toEqual(["1st Semester ASL", "American Sign Language 1"]);
  });

  it("paginates past the 1000-row page size", async () => {
    const page0 = Array.from({ length: 1000 }, (_, i) => ({
      course_number: `n${i}`,
      course_title: `Title ${i}`,
    }));
    supabaseClient._setPages({
      0: { data: page0, error: null },
      1000: { data: [{ course_number: "x", course_title: "Last" }], error: null },
    });
    const rows = await getCourseTitlesForSubject("tst", "BIG");
    expect(rows).toHaveLength(1001);
    expect(rangeMock).toHaveBeenCalledTimes(2);
    expect(rangeMock.mock.calls[0][0]).toBe(0);
    expect(rangeMock.mock.calls[1][0]).toBe(1000);
  });

  it("skips rows with a missing number or title", async () => {
    supabaseClient._setPages({
      0: {
        data: [
          { course_number: "100", course_title: "Good" },
          { course_number: null, course_title: "No Number" },
          { course_number: "101", course_title: null },
          { course_number: "", course_title: "Empty Number" },
        ],
        error: null,
      },
    });
    const rows = await getCourseTitlesForSubject("tst", "SKIP");
    expect(rows).toEqual([{ prefix: "SKIP", number: "100", title: "Good" }]);
  });

  it("sanitizes the course number (strips stray punctuation)", async () => {
    supabaseClient._setPages({
      0: { data: [{ course_number: "202:", course_title: "Has Colon" }], error: null },
    });
    const rows = await getCourseTitlesForSubject("tst", "SANI");
    expect(rows).toEqual([{ prefix: "SANI", number: "202", title: "Has Colon" }]);
  });

  it("returns [] on a Supabase error (does not throw)", async () => {
    supabaseClient._setPages({ 0: { data: null, error: { message: "boom" } } });
    await expect(getCourseTitlesForSubject("tst", "ERRP")).resolves.toEqual([]);
  });

  it("returns [] when the subject has no rows", async () => {
    supabaseClient._setPages({ 0: { data: [], error: null } });
    await expect(getCourseTitlesForSubject("tst", "EMPT")).resolves.toEqual([]);
  });
});

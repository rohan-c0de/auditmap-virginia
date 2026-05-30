import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the high-level data accessors. Each test sets the mock return value
// before calling the validator.
vi.mock("../../../transfer", () => ({
  getUniversities: vi.fn(),
}));

vi.mock("../../../supabase", () => ({
  supabase: {
    from: vi.fn(),
  },
}));

import { courseExists, resolveUniversity } from "../validate";
import { getUniversities } from "../../../transfer";
import { supabase } from "../../../supabase";

const mockGetUniversities = getUniversities as ReturnType<typeof vi.fn>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockSupabaseFrom = (supabase as any).from as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockGetUniversities.mockReset();
  mockSupabaseFrom.mockReset();
});

// ─── courseExists ────────────────────────────────────────────────────────

function setCourseExistsResponse(rows: Array<{ course_title?: string }>) {
  // Mimic the Supabase query builder chain that courseExists uses.
  const queryBuilder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
  };
  mockSupabaseFrom.mockReturnValue(queryBuilder);
}

describe("courseExists", () => {
  it("returns true with title when course is in catalog", async () => {
    setCourseExistsResponse([{ course_title: "Composition I" }]);
    const result = await courseExists("va", "ENG", "111");
    expect(result).toEqual({ exists: true, title: "Composition I" });
    expect(mockSupabaseFrom).toHaveBeenCalledWith("courses");
  });

  it("returns false when no rows", async () => {
    setCourseExistsResponse([]);
    const result = await courseExists("va", "ZZZ", "999");
    expect(result).toEqual({ exists: false });
  });

  it("uppercases the prefix before querying", async () => {
    const queryBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [{}], error: null }),
    };
    mockSupabaseFrom.mockReturnValue(queryBuilder);
    await courseExists("va", "eng", "111");
    expect(queryBuilder.eq).toHaveBeenCalledWith("course_prefix", "ENG");
  });

  it("returns false on Supabase error", async () => {
    const queryBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: null, error: new Error("nope") }),
    };
    mockSupabaseFrom.mockReturnValue(queryBuilder);
    const result = await courseExists("va", "ENG", "111");
    expect(result).toEqual({ exists: false });
  });
});

// ─── resolveUniversity ───────────────────────────────────────────────────

const VA_UNIS = [
  { slug: "gmu", name: "George Mason University" },
  { slug: "vcu", name: "Virginia Commonwealth University" },
  { slug: "vt", name: "Virginia Tech" },
  { slug: "uva", name: "University of Virginia" },
  { slug: "umass-amherst", name: "University of Massachusetts at Amherst" },
];

describe("resolveUniversity", () => {
  it("matches an exact slug case-insensitively", async () => {
    mockGetUniversities.mockResolvedValue(VA_UNIS);
    const r = await resolveUniversity("va", "GMU");
    expect(r.resolved).toEqual({ slug: "gmu", name: "George Mason University" });
    expect(r.suggestions).toEqual([]);
  });

  it("matches a normalized slug (punctuation differences)", async () => {
    mockGetUniversities.mockResolvedValue(VA_UNIS);
    const r = await resolveUniversity("va", "umass_amherst");
    expect(r.resolved?.slug).toBe("umass-amherst");
  });

  it("matches a substring of the display name", async () => {
    mockGetUniversities.mockResolvedValue(VA_UNIS);
    const r = await resolveUniversity("va", "George Mason");
    expect(r.resolved?.slug).toBe("gmu");
  });

  it("returns suggestions when no match found", async () => {
    mockGetUniversities.mockResolvedValue(VA_UNIS);
    const r = await resolveUniversity("va", "harvard");
    expect(r.resolved).toBeNull();
    expect(r.suggestions.length).toBeGreaterThan(0);
    expect(r.suggestions.length).toBeLessThanOrEqual(3);
  });

  it("returns empty resolution + suggestions when state has no transfer data", async () => {
    mockGetUniversities.mockResolvedValue([]);
    const r = await resolveUniversity("xx", "gmu");
    expect(r.resolved).toBeNull();
    expect(r.suggestions).toEqual([]);
  });

  it("returns first 3 universities as suggestions when input is empty", async () => {
    mockGetUniversities.mockResolvedValue(VA_UNIS);
    const r = await resolveUniversity("va", "");
    expect(r.resolved).toBeNull();
    expect(r.suggestions.length).toBe(3);
  });
});

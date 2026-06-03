import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogCourse } from "../resolve-course";

// Mock ONLY getCourseTitlesForSubject; keep every other real `courses` export
// (validate.ts and its import graph still load normally).
vi.mock("../../../courses", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../courses")>();
  return { ...actual, getCourseTitlesForSubject: vi.fn() };
});

import { resolveCourse } from "../validate";
import { getCourseTitlesForSubject } from "../../../courses";

const mockGet = vi.mocked(getCourseTitlesForSubject);

const ARABIC: CatalogCourse[] = [
  { prefix: "ARA", number: "101", title: "Beginning Arabic I" },
  { prefix: "ARA", number: "102", title: "Beginning Arabic II" },
  { prefix: "ARA", number: "201", title: "Intermediate Arabic I" },
  { prefix: "ARA", number: "202", title: "Intermediate Arabic II" },
];

beforeEach(() => {
  mockGet.mockReset();
});

describe("resolveCourse", () => {
  // INVARIANT: no prefix → DEFER, and never fetch the (potentially huge) catalog.
  it("defers WITHOUT fetching when there is no prefix hint", async () => {
    for (const prefixHint of [null, undefined, "", "   "]) {
      const r = await resolveCourse("va", { title: "Intermediate Arabic II", prefixHint });
      expect(r).toEqual({ resolved: null, suggestions: [] });
    }
    expect(mockGet).not.toHaveBeenCalled();
  });

  // INVARIANT: empty/whitespace title → DEFER, and never fetch.
  it("defers WITHOUT fetching when the title is empty or whitespace", async () => {
    for (const title of ["", "   "]) {
      const r = await resolveCourse("va", { title, prefixHint: "ARA" });
      expect(r).toEqual({ resolved: null, suggestions: [] });
    }
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("defers when the subject catalog is empty", async () => {
    mockGet.mockResolvedValue([]);
    const r = await resolveCourse("va", { title: "Intermediate Arabic II", prefixHint: "ARA" });
    expect(r).toEqual({ resolved: null, suggestions: [] });
    expect(mockGet).toHaveBeenCalledWith("va", "ARA");
  });

  it("resolves a confident title match to a code", async () => {
    mockGet.mockResolvedValue(ARABIC);
    const r = await resolveCourse("va", { title: "Intermediate Arabic II", prefixHint: "ARA" });
    expect(r.resolved).toEqual({ prefix: "ARA", number: "202" });
    expect(r.suggestions).toEqual([]);
    expect(mockGet).toHaveBeenCalledWith("va", "ARA");
  });

  it("trims the title before matching", async () => {
    mockGet.mockResolvedValue(ARABIC);
    const r = await resolveCourse("va", { title: "  Intermediate Arabic II  ", prefixHint: "ARA" });
    expect(r.resolved).toEqual({ prefix: "ARA", number: "202" });
  });

  it("defers with suggestions when the title is ambiguous (never guesses)", async () => {
    mockGet.mockResolvedValue([
      { prefix: "ACC", number: "101", title: "Financial Accounting" },
      { prefix: "ACC", number: "201", title: "Financial Accounting" },
      { prefix: "ACC", number: "301", title: "Financial Accounting" },
    ]);
    const r = await resolveCourse("va", { title: "Financial Accounting", prefixHint: "ACC" });
    expect(r.resolved).toBeNull();
    expect(r.suggestions.map((s) => s.code).sort()).toEqual(["ACC 101", "ACC 201", "ACC 301"]);
  });
});

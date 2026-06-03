import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../prereqs", async () => {
  const actual = await vi.importActual<typeof import("../../../prereqs")>("../../../prereqs");
  return {
    ...actual,
    loadPrereqs: vi.fn(),
    buildChain: vi.fn(),
  };
});

vi.mock("../validate", () => ({
  courseExists: vi.fn(),
  resolveUniversity: vi.fn(),
  resolveCourse: vi.fn(),
}));

import { lookupPrereqs } from "../prereqs";
import type { PrereqsIntent } from "../../types";
import { buildChain, loadPrereqs } from "../../../prereqs";
import { courseExists, resolveCourse } from "../validate";

const mockLoadPrereqs = loadPrereqs as ReturnType<typeof vi.fn>;
const mockBuildChain = buildChain as ReturnType<typeof vi.fn>;
const mockCourseExists = courseExists as ReturnType<typeof vi.fn>;
const mockResolveCourse = resolveCourse as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockLoadPrereqs.mockReset();
  mockBuildChain.mockReset();
  mockCourseExists.mockReset();
  mockResolveCourse.mockReset();
});

const BIO_256: PrereqsIntent = {
  type: "prereqs",
  course: { prefix: "BIO", number: "256" },
  subjectPrefix: null,
  courseTitle: null,
  direction: "forward",
};

describe("lookupPrereqs", () => {
  it("returns 'no-course-named' when course is missing", async () => {
    const result = await lookupPrereqs({ type: "prereqs", course: null, subjectPrefix: null, courseTitle: null, direction: "forward" }, "va");
    if (result.type !== "prereqs") throw new Error("wrong type");
    expect(result.status).toBe("no-course-named");
    expect(result.course).toBeNull();
  });

  it("returns 'no-data' when state has empty prereqs map", async () => {
    mockLoadPrereqs.mockReturnValue(new Map());
    const result = await lookupPrereqs(BIO_256, "va");
    if (result.type !== "prereqs") throw new Error("wrong type");
    expect(result.status).toBe("no-data");
  });

  it("returns 'unknown-course' when course not in prereqs map and not in catalog", async () => {
    mockLoadPrereqs.mockReturnValue(
      new Map([["ENG 111", { text: "", courses: [] }]]),
    );
    mockCourseExists.mockResolvedValue({ exists: false });
    const result = await lookupPrereqs(BIO_256, "va");
    if (result.type !== "prereqs") throw new Error("wrong type");
    expect(result.status).toBe("unknown-course");
  });

  it("returns 'no-prereqs' when course exists in catalog but isn't in prereqs map", async () => {
    mockLoadPrereqs.mockReturnValue(
      new Map([["ENG 111", { text: "", courses: [] }]]),
    );
    mockCourseExists.mockResolvedValue({ exists: true });
    const result = await lookupPrereqs(BIO_256, "va");
    if (result.type !== "prereqs") throw new Error("wrong type");
    expect(result.status).toBe("no-prereqs");
  });

  it("returns 'no-prereqs' when course is in prereqs map with empty text+courses", async () => {
    mockLoadPrereqs.mockReturnValue(
      new Map([["BIO 256", { text: "", courses: [] }]]),
    );
    const result = await lookupPrereqs(BIO_256, "va");
    if (result.type !== "prereqs") throw new Error("wrong type");
    expect(result.status).toBe("no-prereqs");
  });

  it("returns 'found' with chain when prereqs are recorded", async () => {
    mockLoadPrereqs.mockReturnValue(
      new Map([["BIO 256", { text: "BIO 101 and BIO 102", courses: ["BIO 101", "BIO 102"] }]]),
    );
    mockBuildChain.mockReturnValue({
      course: "BIO 256",
      text: "BIO 101 and BIO 102",
      children: [],
    });
    const result = await lookupPrereqs(BIO_256, "va");
    if (result.type !== "prereqs") throw new Error("wrong type");
    expect(result.status).toBe("found");
    expect(result.chain?.course).toBe("BIO 256");
  });

  it("uppercases the prefix when looking up the prereqs map", async () => {
    mockLoadPrereqs.mockReturnValue(
      new Map([["BIO 256", { text: "BIO 101", courses: ["BIO 101"] }]]),
    );
    mockBuildChain.mockReturnValue({ course: "BIO 256", text: "BIO 101", children: [] });
    const result = await lookupPrereqs(
      { type: "prereqs", course: { prefix: "bio", number: "256" }, subjectPrefix: null, courseTitle: null, direction: "forward" },
      "va",
    );
    if (result.type !== "prereqs") throw new Error("wrong type");
    expect(result.status).toBe("found");
  });

  it("includes a SourceCitation on every prereqs answer", async () => {
    mockLoadPrereqs.mockReturnValue(new Map());
    const result = await lookupPrereqs(BIO_256, "va");
    if (result.type !== "prereqs") throw new Error("wrong type");
    expect(result.source.source).toBe("prereqs");
    expect(result.source.reference).toBe("data/va/prereqs.json");
  });

  describe("inverse direction", () => {
    it("returns 'unlocks' with list of courses that require the given course", async () => {
      mockLoadPrereqs.mockReturnValue(
        new Map([
          ["BIO 101", { text: "", courses: [] }],
          ["BIO 256", { text: "BIO 101", courses: ["BIO 101"] }],
          ["BIO 260", { text: "BIO 101", courses: ["BIO 101"] }],
        ]),
      );
      const result = await lookupPrereqs(
        { type: "prereqs", course: { prefix: "BIO", number: "101" }, subjectPrefix: null, courseTitle: null, direction: "inverse" },
        "va",
      );
      if (result.type !== "prereqs") throw new Error("wrong type");
      expect(result.status).toBe("unlocks");
      expect(result.unlocks).toEqual(["BIO 256", "BIO 260"]);
    });

    it("returns 'no-unlocks' when no courses require the given course", async () => {
      mockLoadPrereqs.mockReturnValue(
        new Map([
          ["BIO 256", { text: "BIO 101", courses: ["BIO 101"] }],
        ]),
      );
      const result = await lookupPrereqs(
        { type: "prereqs", course: { prefix: "BIO", number: "256" }, subjectPrefix: null, courseTitle: null, direction: "inverse" },
        "va",
      );
      if (result.type !== "prereqs") throw new Error("wrong type");
      expect(result.status).toBe("no-unlocks");
    });

    it("returns 'unknown-course' for inverse lookup of nonexistent course", async () => {
      mockLoadPrereqs.mockReturnValue(
        new Map([["ENG 111", { text: "", courses: [] }]]),
      );
      mockCourseExists.mockResolvedValue({ exists: false });
      const result = await lookupPrereqs(
        { type: "prereqs", course: { prefix: "XYZ", number: "999" }, subjectPrefix: null, courseTitle: null, direction: "inverse" },
        "va",
      );
      if (result.type !== "prereqs") throw new Error("wrong type");
      expect(result.status).toBe("unknown-course");
    });
  });

  describe("followups", () => {
    it("suggests transfer and first-prereq followups for 'found' with children", async () => {
      mockLoadPrereqs.mockReturnValue(
        new Map([["BIO 256", { text: "BIO 101", courses: ["BIO 101"] }]]),
      );
      mockBuildChain.mockReturnValue({
        course: "BIO 256",
        text: "BIO 101",
        children: [{ course: "BIO 101", text: "", children: [] }],
      });
      const result = await lookupPrereqs(BIO_256, "va");
      if (result.type !== "prereqs") throw new Error("wrong type");
      expect(result.followups).toContain("Does BIO 256 transfer?");
      expect(result.followups).toContain("What are the prereqs for BIO 101?");
    });

    it("suggests transfer and prefix search for 'no-prereqs'", async () => {
      mockLoadPrereqs.mockReturnValue(
        new Map([["BIO 256", { text: "", courses: [] }]]),
      );
      const result = await lookupPrereqs(BIO_256, "va");
      if (result.type !== "prereqs") throw new Error("wrong type");
      expect(result.followups).toContain("Does BIO 256 transfer?");
      expect(result.followups).toContain("Search for BIO courses");
    });

    it("suggests a prefix search for 'unknown-course'", async () => {
      mockLoadPrereqs.mockReturnValue(
        new Map([["ENG 111", { text: "", courses: [] }]]),
      );
      mockCourseExists.mockResolvedValue({ exists: false });
      const result = await lookupPrereqs(BIO_256, "va");
      if (result.type !== "prereqs") throw new Error("wrong type");
      expect(result.followups).toContain("Search for BIO courses");
    });
  });

  // The student named the course by TITLE ("Intermediate Arabic II") instead
  // of a code. lookupPrereqs calls resolveCourse to get a code, then proceeds.
  describe("title resolution", () => {
    const ARABIC_BY_TITLE: PrereqsIntent = {
      type: "prereqs",
      course: null,
      subjectPrefix: "ARA",
      courseTitle: "Intermediate Arabic II",
      direction: "forward",
    };

    it("resolves the title to a code and returns the normal prereqs answer", async () => {
      mockResolveCourse.mockResolvedValue({
        resolved: { prefix: "ARA", number: "202" },
        suggestions: [],
      });
      mockLoadPrereqs.mockReturnValue(
        new Map([["ARA 202", { text: "ARA 201", courses: ["ARA 201"] }]]),
      );
      mockBuildChain.mockReturnValue({ course: "ARA 202", text: "ARA 201", children: [] });

      const result = await lookupPrereqs(ARABIC_BY_TITLE, "va");
      if (result.type !== "prereqs") throw new Error("wrong type");
      expect(mockResolveCourse).toHaveBeenCalledWith("va", {
        title: "Intermediate Arabic II",
        prefixHint: "ARA",
      });
      expect(result.status).toBe("found");
      expect(result.course).toEqual({ prefix: "ARA", number: "202" });
    });

    it("defers with clickable course suggestions when the title is ambiguous", async () => {
      mockResolveCourse.mockResolvedValue({
        resolved: null,
        suggestions: [
          { code: "ARA 102", title: "Beginning Arabic II" },
          { code: "ARA 202", title: "Intermediate Arabic II" },
        ],
      });

      const result = await lookupPrereqs(
        { ...ARABIC_BY_TITLE, courseTitle: "Arabic II" },
        "va",
      );
      if (result.type !== "prereqs") throw new Error("wrong type");
      expect(result.status).toBe("no-course-named");
      // loadPrereqs must NOT be consulted — we never resolved a course.
      expect(mockLoadPrereqs).not.toHaveBeenCalled();
      expect(result.followups).toEqual([
        "Prereqs for ARA 102",
        "Prereqs for ARA 202",
      ]);
    });

    it("does not attempt resolution when a code was given (code wins)", async () => {
      mockLoadPrereqs.mockReturnValue(
        new Map([["BIO 256", { text: "BIO 101", courses: ["BIO 101"] }]]),
      );
      mockBuildChain.mockReturnValue({ course: "BIO 256", text: "BIO 101", children: [] });
      await lookupPrereqs(BIO_256, "va");
      expect(mockResolveCourse).not.toHaveBeenCalled();
    });
  });
});

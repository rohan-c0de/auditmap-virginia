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
}));

import { lookupPrereqs } from "../prereqs";
import type { PrereqsIntent } from "../../types";
import { buildChain, loadPrereqs } from "../../../prereqs";
import { courseExists } from "../validate";

const mockLoadPrereqs = loadPrereqs as ReturnType<typeof vi.fn>;
const mockBuildChain = buildChain as ReturnType<typeof vi.fn>;
const mockCourseExists = courseExists as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockLoadPrereqs.mockReset();
  mockBuildChain.mockReset();
  mockCourseExists.mockReset();
});

const BIO_256: PrereqsIntent = {
  type: "prereqs",
  course: { prefix: "BIO", number: "256" },
  direction: "forward",
};

describe("lookupPrereqs", () => {
  it("returns 'no-course-named' when course is missing", async () => {
    const result = await lookupPrereqs({ type: "prereqs", course: null, direction: "forward" }, "va");
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
      { type: "prereqs", course: { prefix: "bio", number: "256" }, direction: "forward" },
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
        { type: "prereqs", course: { prefix: "BIO", number: "101" }, direction: "inverse" },
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
        { type: "prereqs", course: { prefix: "BIO", number: "256" }, direction: "inverse" },
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
        { type: "prereqs", course: { prefix: "XYZ", number: "999" }, direction: "inverse" },
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
});

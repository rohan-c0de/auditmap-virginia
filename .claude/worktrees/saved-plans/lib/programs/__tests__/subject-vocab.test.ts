import { describe, expect, it, beforeEach, vi } from "vitest";

const FIXTURE = {
  state: "vt",
  generated_at: "2026-05-08T00:00:00Z",
  subjects: [
    {
      prefix: "BIO",
      name: "Biology",
      course_count: 8,
      section_count: 50,
      colleges: ["ccv"],
      sample_titles: ["Biology I", "Biology II"],
    },
    {
      prefix: "GEO",
      name: "Geography",
      course_count: 3,
      section_count: 12,
      colleges: ["ccv"],
      sample_titles: ["Physical Geography"],
    },
  ],
  program_titles: ["Liberal Arts (A.A.)"],
};

// Module-level fs mocks. ESM doesn't permit vi.spyOn on namespace exports,
// and vi.mock is hoisted above the file so its factory can't reference
// later top-level vars — vi.hoisted lets us share refs across both.
const { existsSyncMock, readFileSyncMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(() => true),
  readFileSyncMock: vi.fn(() => "{}"),
}));

vi.mock("fs", () => ({
  existsSync: existsSyncMock,
  readFileSync: readFileSyncMock,
}));

import {
  loadSubjectVocab,
  summariseSubjectsByPrefix,
  _resetSubjectVocabCache,
} from "../subject-vocab";

beforeEach(() => {
  _resetSubjectVocabCache();
  existsSyncMock.mockReset();
  readFileSyncMock.mockReset();
  // Defaults: file exists and contains the fixture.
  existsSyncMock.mockReturnValue(true);
  readFileSyncMock.mockReturnValue(JSON.stringify(FIXTURE));
});

describe("loadSubjectVocab", () => {
  it("returns null when the file doesn't exist", () => {
    existsSyncMock.mockReturnValue(false);
    expect(loadSubjectVocab("nonexistent")).toBeNull();
  });

  it("returns null on parse error", () => {
    readFileSyncMock.mockReturnValue("not json{{");
    expect(loadSubjectVocab("broken")).toBeNull();
  });

  it("returns parsed vocab when the file is valid", () => {
    const v = loadSubjectVocab("vt");
    expect(v).not.toBeNull();
    expect(v!.subjects.length).toBe(2);
  });

  it("memoizes — second call doesn't re-read the file", () => {
    loadSubjectVocab("vt");
    loadSubjectVocab("vt");
    loadSubjectVocab("vt");
    expect(existsSyncMock).toHaveBeenCalledTimes(1);
    expect(readFileSyncMock).toHaveBeenCalledTimes(1);
  });
});

describe("summariseSubjectsByPrefix", () => {
  it("returns [] when state has no vocab", () => {
    existsSyncMock.mockReturnValue(false);
    expect(summariseSubjectsByPrefix("nope", ["BIO"])).toEqual([]);
  });

  it("returns [] for empty input", () => {
    expect(summariseSubjectsByPrefix("vt", [])).toEqual([]);
  });

  it("hydrates known prefixes with name + counts + search_url", () => {
    const result = summariseSubjectsByPrefix("vt", ["BIO"]);
    expect(result.length).toBe(1);
    expect(result[0]).toEqual({
      prefix: "BIO",
      name: "Biology",
      course_count: 8,
      section_count: 50,
      college_count: 1,
      search_url: "/vt/courses?q=BIO",
    });
  });

  it("filters out unknown prefixes (defense against LLM hallucination)", () => {
    const result = summariseSubjectsByPrefix("vt", ["BIO", "FAKE", "GEO"]);
    expect(result.map((s) => s.prefix)).toEqual(["BIO", "GEO"]);
  });

  it("normalizes input prefixes to uppercase", () => {
    const result = summariseSubjectsByPrefix("vt", ["bio", "geo"]);
    expect(result.map((s) => s.prefix)).toEqual(["BIO", "GEO"]);
  });

  it("preserves input order", () => {
    expect(
      summariseSubjectsByPrefix("vt", ["GEO", "BIO"]).map((s) => s.prefix),
    ).toEqual(["GEO", "BIO"]);
  });
});

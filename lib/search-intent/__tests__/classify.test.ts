import { describe, expect, it, vi } from "vitest";
import { bareCourseCodeShortcut, classifierWith } from "../classify";
import { hashQuery, memoryCache, normalizeQuery, nullCache } from "../cache";
import type { Classifier } from "../types";

const BASE_ENRICHMENT = {
  secondaryIntent: null,
  studentSummary: "test summary",
  clarifyingQuestion: null,
  sourceCollege: null,
  suggestedFollowups: [] as string[],
};

describe("normalizeQuery", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizeQuery("  Does   ENG 111   Transfer  ")).toBe(
      "does eng 111 transfer",
    );
  });

  it("returns empty for whitespace-only", () => {
    expect(normalizeQuery("   \t\n  ")).toBe("");
  });
});

describe("hashQuery", () => {
  it("produces identical hashes for queries that normalize to the same string", () => {
    expect(hashQuery("ENG 111")).toBe(hashQuery("  eng    111  "));
  });

  it("produces different hashes for different queries", () => {
    expect(hashQuery("ENG 111")).not.toBe(hashQuery("ENG 112"));
  });
});

describe("memoryCache", () => {
  it("stores and retrieves a classification", async () => {
    const cache = memoryCache();
    const intent = {
      intent: { type: "unknown" as const, raw: "x" },
      confidence: 0.3,
      ...BASE_ENRICHMENT,
    };
    await cache.put("hello", "va", "model-x", intent);
    expect(await cache.get("hello", "va", "model-x")).toEqual(intent);
  });

  it("isolates by model version", async () => {
    const cache = memoryCache();
    const intent = {
      intent: { type: "unknown" as const, raw: "x" },
      confidence: 0.3,
      ...BASE_ENRICHMENT,
    };
    await cache.put("hello", "va", "model-x", intent);
    expect(await cache.get("hello", "va", "model-y")).toBeNull();
  });

  it("isolates by state", async () => {
    const cache = memoryCache();
    const intent = {
      intent: { type: "unknown" as const, raw: "x" },
      confidence: 0.3,
      ...BASE_ENRICHMENT,
    };
    await cache.put("hello", "va", "model-x", intent);
    expect(await cache.get("hello", "ma", "model-x")).toBeNull();
  });

  it("evicts oldest entries when bound is exceeded", async () => {
    const cache = memoryCache(2);
    const make = (raw: string) => ({
      intent: { type: "unknown" as const, raw },
      confidence: 0,
      ...BASE_ENRICHMENT,
    });
    await cache.put("q1", "va", "m", make("q1"));
    await cache.put("q2", "va", "m", make("q2"));
    await cache.put("q3", "va", "m", make("q3"));
    expect(await cache.get("q1", "va", "m")).toBeNull();
    expect(await cache.get("q2", "va", "m")).not.toBeNull();
    expect(await cache.get("q3", "va", "m")).not.toBeNull();
  });
});

describe("classifierWith", () => {
  it("returns cached result without calling LLM when cache hits", async () => {
    const cache = memoryCache();
    const cached = {
      intent: { type: "unknown" as const, raw: "cached" },
      confidence: 0.99,
      ...BASE_ENRICHMENT,
    };
    await cache.put("hello", "va", "model-x", cached);

    const llm: Classifier = vi.fn();
    const classifier = classifierWith({ cache, llm, modelVersion: "model-x" });
    const result = await classifier("hello", "va");

    expect(result).toEqual(cached);
    expect(llm).not.toHaveBeenCalled();
  });

  it("calls LLM and writes-through to cache on miss", async () => {
    const cache = memoryCache();
    const fresh = {
      intent: { type: "unknown" as const, raw: "fresh" },
      confidence: 0.42,
      ...BASE_ENRICHMENT,
    };
    const llm: Classifier = vi.fn().mockResolvedValue(fresh);
    const classifier = classifierWith({ cache, llm, modelVersion: "model-x" });

    const result = await classifier("hello", "va");
    expect(result).toEqual(fresh);
    expect(llm).toHaveBeenCalledWith("hello", "va");

    // Second call should be served from cache.
    const result2 = await classifier("hello", "va");
    expect(result2).toEqual(fresh);
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it("with nullCache, calls LLM on every request", async () => {
    const fresh = {
      intent: { type: "unknown" as const, raw: "fresh" },
      confidence: 0.42,
      ...BASE_ENRICHMENT,
    };
    const llm: Classifier = vi.fn().mockResolvedValue(fresh);
    const classifier = classifierWith({ cache: nullCache, llm });
    await classifier("hello", "va");
    await classifier("hello", "va");
    expect(llm).toHaveBeenCalledTimes(2);
  });
});

describe("bareCourseCodeShortcut", () => {
  it("matches bare course codes in common spellings", () => {
    for (const q of ["ENG 111", "eng111", "BIO-256", "MATH 151A", "  cs 50  ", "CRTV 121F"]) {
      const result = bareCourseCodeShortcut(q);
      expect(result, q).not.toBeNull();
      expect(result!.intent.type).toBe("course");
    }
  });

  it("extracts an uppercased prefix + number", () => {
    const result = bareCourseCodeShortcut("eng-111");
    expect(result!.intent).toEqual({
      type: "course",
      keyword: null,
      filters: { course: { prefix: "ENG", number: "111" } },
    });
  });

  it("returns an empty studentSummary so the UI renders no card", () => {
    expect(bareCourseCodeShortcut("ENG 111")!.studentSummary).toBe("");
  });

  it("does NOT match natural-language or filtered queries", () => {
    for (const q of [
      "does ENG 111 transfer to GMU?",
      "ENG 111 online",
      "biology",
      "intro psychology",
      "prereqs for BIO 256",
      "free college if I'm 65+",
      "summer 2026",
    ]) {
      expect(bareCourseCodeShortcut(q), q).toBeNull();
    }
  });

  it("classifierWith never touches cache or LLM for a bare code", async () => {
    const llm: Classifier = vi.fn();
    const cacheGet = vi.fn();
    const classifier = classifierWith({
      cache: { get: cacheGet, put: vi.fn() },
      llm,
    });
    const result = await classifier("ENG 111", "nc");
    expect(result.intent.type).toBe("course");
    expect(llm).not.toHaveBeenCalled();
    expect(cacheGet).not.toHaveBeenCalled();
  });
});

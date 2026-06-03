import { describe, expect, it, vi } from "vitest";
import { chain } from "../classify";
import type { ClassifiedIntent } from "../types";

const intent = (type: string): ClassifiedIntent => ({
  intent: { type: "transfer", course: null, subjectPrefix: null, university: type } as never,
  secondaryIntent: null,
  confidence: 1,
  studentSummary: type,
  clarifyingQuestion: null,
  sourceCollege: null,
  suggestedFollowups: [],
});

describe("chain (provider fallback)", () => {
  it("uses the primary when it succeeds and never calls the fallback", async () => {
    const primary = vi.fn().mockResolvedValue(intent("primary"));
    const fallback = vi.fn().mockResolvedValue(intent("fallback"));
    const result = await chain(primary, fallback)("q", "va");
    expect(result.studentSummary).toBe("primary");
    expect(primary).toHaveBeenCalledOnce();
    expect(fallback).not.toHaveBeenCalled();
  });

  it("falls back to the secondary when the primary throws (e.g. 429)", async () => {
    const primary = vi.fn().mockRejectedValue(new Error("json-chat openai 429: rate limit"));
    const fallback = vi.fn().mockResolvedValue(intent("fallback"));
    const result = await chain(primary, fallback)("q", "va");
    expect(result.studentSummary).toBe("fallback");
    expect(primary).toHaveBeenCalledOnce();
    expect(fallback).toHaveBeenCalledOnce();
  });

  it("propagates the fallback's error when BOTH fail (route → 503 → UI drops card)", async () => {
    const primary = vi.fn().mockRejectedValue(new Error("primary down"));
    const fallback = vi.fn().mockRejectedValue(new Error("fallback down"));
    await expect(chain(primary, fallback)("q", "va")).rejects.toThrow("fallback down");
  });

  it("passes query + state through to whichever provider runs", async () => {
    const primary = vi.fn().mockRejectedValue(new Error("x"));
    const fallback = vi.fn().mockResolvedValue(intent("fb"));
    await chain(primary, fallback)("prereqs for BIO 256", "nc");
    expect(fallback).toHaveBeenCalledWith("prereqs for BIO 256", "nc");
  });
});

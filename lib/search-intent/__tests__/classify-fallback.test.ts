import { describe, expect, it, vi } from "vitest";
import { chain, chainAll } from "../classify";
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

describe("chainAll (multi-provider fallback chain)", () => {
  it("falls through the chain until one succeeds (e.g. 120b 429 → 20b → cloudflare)", async () => {
    const a = vi.fn().mockRejectedValue(new Error("429"));   // groq 120b rate-limited
    const b = vi.fn().mockRejectedValue(new Error("429"));   // groq 20b also rate-limited
    const c = vi.fn().mockResolvedValue(intent("cloudflare")); // cloudflare answers
    const result = await chainAll([a, b, c])("q", "va");
    expect(result.studentSummary).toBe("cloudflare");
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
    expect(c).toHaveBeenCalledOnce();
  });

  it("stops at the first success (later providers untouched)", async () => {
    const a = vi.fn().mockRejectedValue(new Error("429"));
    const b = vi.fn().mockResolvedValue(intent("20b"));
    const c = vi.fn().mockResolvedValue(intent("cloudflare"));
    const result = await chainAll([a, b, c])("q", "va");
    expect(result.studentSummary).toBe("20b");
    expect(c).not.toHaveBeenCalled();
  });

  it("propagates the last error when every provider fails (→ 503 → UI fallback)", async () => {
    const a = vi.fn().mockRejectedValue(new Error("a"));
    const b = vi.fn().mockRejectedValue(new Error("b down"));
    await expect(chainAll([a, b])("q", "va")).rejects.toThrow("b down");
  });

  it("a single-element chain is just that classifier", async () => {
    const only = vi.fn().mockResolvedValue(intent("solo"));
    expect((await chainAll([only])("q", "va")).studentSummary).toBe("solo");
  });
});

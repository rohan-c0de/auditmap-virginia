import { describe, expect, it } from "vitest";
import {
  parseAndValidateDraft,
  upsertPlan,
  upsertFavorite,
  planDedupKey,
  favoriteDedupKey,
  ANON_DRAFT_VERSION,
  ANON_DRAFT_MAX_AGE_MS,
  type AnonDraft,
  type AnonPlanDraft,
  type AnonFavoriteDraft,
} from "@/lib/anon-draft";

const NOW = 1_750_000_000_000;
const plan = (over: Partial<AnonPlanDraft> = {}): AnonPlanDraft => ({
  state: "va",
  name: "My Plan",
  targetCourses: ["BIO 101"],
  kind: "semester",
  dedupKey: "va::BIO 101",
  ...over,
});
const fav = (over: Partial<AnonFavoriteDraft> = {}): AnonFavoriteDraft => ({
  state: "va",
  coursePrefix: "BIO",
  courseNumber: "101",
  courseTitle: "Biology I",
  dedupKey: "va::BIO::101",
  ...over,
});
const draft = (over: Partial<AnonDraft> = {}): AnonDraft => ({
  v: ANON_DRAFT_VERSION,
  plans: [plan()],
  favorites: [],
  savedAt: NOW,
  ...over,
});

describe("parseAndValidateDraft", () => {
  it("returns a valid, current-version, fresh draft", () => {
    expect(parseAndValidateDraft(JSON.stringify(draft()), NOW)).toEqual(draft());
  });

  it("rejects a wrong-version payload", () => {
    expect(parseAndValidateDraft(JSON.stringify(draft({ v: 99 })), NOW)).toBeNull();
  });

  it("rejects a stale payload (> 30 days old)", () => {
    const old = draft({ savedAt: NOW - ANON_DRAFT_MAX_AGE_MS - 1 });
    expect(parseAndValidateDraft(JSON.stringify(old), NOW)).toBeNull();
  });

  it("accepts a payload exactly at the age boundary", () => {
    const edge = draft({ savedAt: NOW - ANON_DRAFT_MAX_AGE_MS });
    expect(parseAndValidateDraft(JSON.stringify(edge), NOW)).not.toBeNull();
  });

  it("rejects null / malformed / empty-plans", () => {
    expect(parseAndValidateDraft(null, NOW)).toBeNull();
    expect(parseAndValidateDraft("{not json", NOW)).toBeNull();
    expect(parseAndValidateDraft(JSON.stringify(draft({ plans: [] })), NOW)).toBeNull();
  });

  it("defaults a missing favorites array (back-compat with v1 plans-only drafts)", () => {
    const legacy = JSON.stringify({ v: ANON_DRAFT_VERSION, plans: [plan()], savedAt: NOW });
    const parsed = parseAndValidateDraft(legacy, NOW);
    expect(parsed?.favorites).toEqual([]);
    expect(parsed?.plans).toHaveLength(1);
  });

  it("accepts a favorites-only draft (no plans)", () => {
    const favOnly = draft({ plans: [], favorites: [fav()] });
    expect(parseAndValidateDraft(JSON.stringify(favOnly), NOW)).toEqual(favOnly);
  });
});

describe("upsertPlan", () => {
  it("replaces an entry with the same dedupKey and keeps each entry's own state", () => {
    const a = plan({ dedupKey: "k1", state: "va" });
    const b = plan({ dedupKey: "k2", state: "tx" });
    const aPrime = plan({ dedupKey: "k1", state: "va", name: "Renamed" });
    const out = upsertPlan(upsertPlan([a], b), aPrime);
    expect(out).toHaveLength(2);
    expect(out.find((p) => p.dedupKey === "k1")?.name).toBe("Renamed");
    expect(out.find((p) => p.dedupKey === "k2")?.state).toBe("tx");
  });
});

describe("planDedupKey", () => {
  it("is stable regardless of target order", () => {
    expect(planDedupKey("va", ["B", "A"])).toBe(planDedupKey("va", ["A", "B"]));
  });
  it("differs by state and by target set", () => {
    expect(planDedupKey("va", ["A"])).not.toBe(planDedupKey("tx", ["A"]));
    expect(planDedupKey("va", ["A"])).not.toBe(planDedupKey("va", ["A", "B"]));
  });
});

describe("upsertFavorite / favoriteDedupKey", () => {
  it("replaces a favorite with the same dedupKey", () => {
    const a = fav({ dedupKey: "k1", courseTitle: "Old" });
    const b = fav({ dedupKey: "k2" });
    const aPrime = fav({ dedupKey: "k1", courseTitle: "New" });
    const out = upsertFavorite(upsertFavorite([a], b), aPrime);
    expect(out).toHaveLength(2);
    expect(out.find((f) => f.dedupKey === "k1")?.courseTitle).toBe("New");
  });
  it("favoriteDedupKey is content-based (state + prefix + number)", () => {
    expect(favoriteDedupKey("va", "BIO", "101")).toBe("va::BIO::101");
    expect(favoriteDedupKey("va", "BIO", "101")).not.toBe(favoriteDedupKey("tx", "BIO", "101"));
  });
});

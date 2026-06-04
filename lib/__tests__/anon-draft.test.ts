import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  parseAndValidateDraft,
  upsertPlan,
  upsertFavorite,
  upsertSchedule,
  planDedupKey,
  favoriteDedupKey,
  scheduleDedupKey,
  stashPlanDraft,
  stashFavoriteDraft,
  stashScheduleDraft,
  readAnonDraft,
  ANON_DRAFT_VERSION,
  ANON_DRAFT_MAX_AGE_MS,
  type AnonDraft,
  type AnonPlanDraft,
  type AnonFavoriteDraft,
  type AnonScheduleDraft,
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
const sched = (over: Partial<AnonScheduleDraft> = {}): AnonScheduleDraft => ({
  state: "va",
  name: "BIO 101",
  sections: [{ college_code: "nv", crn: "12345" }],
  score: 87,
  scoreBreakdown: null,
  formData: { zip: "20109" },
  dedupKey: "va::nv:12345",
  ...over,
});
const draft = (over: Partial<AnonDraft> = {}): AnonDraft => ({
  v: ANON_DRAFT_VERSION,
  plans: [plan()],
  favorites: [],
  schedules: [],
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

  it("defaults missing favorites + schedules arrays (back-compat with older drafts)", () => {
    const legacy = JSON.stringify({ v: ANON_DRAFT_VERSION, plans: [plan()], savedAt: NOW });
    const parsed = parseAndValidateDraft(legacy, NOW);
    expect(parsed?.favorites).toEqual([]);
    expect(parsed?.schedules).toEqual([]);
    expect(parsed?.plans).toHaveLength(1);
  });

  it("accepts a favorites-only draft (no plans)", () => {
    const favOnly = draft({ plans: [], favorites: [fav()] });
    expect(parseAndValidateDraft(JSON.stringify(favOnly), NOW)).toEqual(favOnly);
  });

  it("accepts a schedules-only draft (no plans or favorites)", () => {
    const schedOnly = draft({ plans: [], favorites: [], schedules: [sched()] });
    expect(parseAndValidateDraft(JSON.stringify(schedOnly), NOW)).toEqual(schedOnly);
  });

  it("rejects an all-empty draft (no plans, favorites, or schedules)", () => {
    const empty = draft({ plans: [], favorites: [], schedules: [] });
    expect(parseAndValidateDraft(JSON.stringify(empty), NOW)).toBeNull();
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

describe("scheduleDedupKey", () => {
  it("is stable regardless of section order", () => {
    const a = [
      { college_code: "nv", crn: "111" },
      { college_code: "tcc", crn: "222" },
    ];
    const b = [
      { college_code: "tcc", crn: "222" },
      { college_code: "nv", crn: "111" },
    ];
    expect(scheduleDedupKey("va", a)).toBe(scheduleDedupKey("va", b));
  });
  it("differs by state and by section set", () => {
    const s = [{ college_code: "nv", crn: "111" }];
    expect(scheduleDedupKey("va", s)).not.toBe(scheduleDedupKey("tx", s));
    expect(scheduleDedupKey("va", s)).not.toBe(
      scheduleDedupKey("va", [...s, { college_code: "nv", crn: "222" }])
    );
  });
});

describe("upsertSchedule", () => {
  it("replaces a schedule with the same dedupKey", () => {
    const a = sched({ dedupKey: "k1", name: "Old" });
    const b = sched({ dedupKey: "k2" });
    const aPrime = sched({ dedupKey: "k1", name: "New" });
    const out = upsertSchedule(upsertSchedule([a], b), aPrime);
    expect(out).toHaveLength(2);
    expect(out.find((s) => s.dedupKey === "k1")?.name).toBe("New");
  });
});

describe("stash* sessionStorage I/O", () => {
  // The vitest env is "node" (no DOM); install a minimal sessionStorage stub so
  // the I/O helpers run, then tear it down so the pure tests stay unaffected.
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as { window?: unknown }).window = {
      sessionStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
      },
    };
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("stashScheduleDraft preserves existing plans and favorites", () => {
    stashPlanDraft(plan());
    stashFavoriteDraft(fav());
    stashScheduleDraft(sched());
    const out = readAnonDraft();
    expect(out?.plans).toHaveLength(1);
    expect(out?.favorites).toHaveLength(1);
    expect(out?.schedules).toHaveLength(1);
    expect(out?.schedules?.[0]?.dedupKey).toBe("va::nv:12345");
  });

  it("stashScheduleDraft de-dupes by dedupKey on re-save", () => {
    stashScheduleDraft(sched());
    stashScheduleDraft(sched({ name: "Renamed" }));
    const out = readAnonDraft();
    expect(out?.schedules).toHaveLength(1);
    expect(out?.schedules?.[0]?.name).toBe("Renamed");
  });
});

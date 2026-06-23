import { describe, it, expect } from "vitest";
import {
  evaluatePr,
  type PrFacts,
  type EligibilityConfig,
} from "../automerge-eligible";

// Fixed "now" so soak math is deterministic.
const NOW = Date.parse("2026-06-23T12:00:00Z");

// A base PR that passes every guard: bot-authored 1-file courses scrape for HI,
// both labels, mergeable, 36h old.
function basePr(over: Partial<PrFacts> = {}): PrFacts {
  return {
    number: 1538,
    author: { login: "app/github-actions", is_bot: true },
    headRefName: "scheduled-scrape/hi-courses",
    labels: [{ name: "scraper-output" }, { name: "automated" }],
    files: [{ path: "data/hi/courses/hawaii-community-college/2026FA.json" }],
    mergeable: "MERGEABLE",
    createdAt: "2026-06-22T00:00:00Z",
    isDraft: false,
    ...over,
  };
}

function cfg(over: Partial<EligibilityConfig> = {}): EligibilityConfig {
  return {
    allowlist: ["hi"],
    healthFlagged: new Set<string>(),
    maxFiles: 25,
    soakHours: 4,
    nowMs: NOW,
    ...over,
  };
}

describe("evaluatePr — happy paths", () => {
  it("a 1-file allowlisted courses PR is eligible", () => {
    const r = evaluatePr(basePr(), cfg());
    expect(r.reasons).toEqual([]);
    expect(r.safe).toBe(true);
    expect(r.inAllowlist).toBe(true);
    expect(r.eligible).toBe(true);
    expect(r.state).toBe("hi");
    expect(r.datatype).toBe("courses");
  });

  it("a prereqs PR (single prereqs.json) is eligible", () => {
    const r = evaluatePr(
      basePr({
        headRefName: "scheduled-scrape/nd-prereqs",
        files: [{ path: "data/nd/prereqs.json" }],
      }),
      cfg({ allowlist: ["nd"] })
    );
    expect(r.safe).toBe(true);
    expect(r.eligible).toBe(true);
    expect(r.state).toBe("nd");
    expect(r.datatype).toBe("prereqs");
  });

  it("a multi-file single-state courses PR within the cap is eligible", () => {
    const files = Array.from({ length: 17 }, (_, i) => ({
      path: `data/nc/courses/college-${i}/2026FA.json`,
    }));
    const r = evaluatePr(
      basePr({ headRefName: "scheduled-scrape/nc-courses", files }),
      cfg({ allowlist: ["nc"] })
    );
    expect(r.safe).toBe(true);
    expect(r.eligible).toBe(true);
    expect(r.fileCount).toBe(17);
  });
});

describe("evaluatePr — allowlist tier", () => {
  it("safe but not allowlisted ⇒ safe, not eligible", () => {
    const r = evaluatePr(basePr(), cfg({ allowlist: ["nc"] }));
    expect(r.safe).toBe(true);
    expect(r.inAllowlist).toBe(false);
    expect(r.eligible).toBe(false);
    expect(r.reasons).toEqual([]); // allowlist is NOT a safety failure
  });

  it("empty allowlist ⇒ nothing eligible", () => {
    const r = evaluatePr(basePr(), cfg({ allowlist: [] }));
    expect(r.safe).toBe(true);
    expect(r.eligible).toBe(false);
  });
});

describe("evaluatePr — provenance guards", () => {
  it("rejects a non-bot (human) author", () => {
    const r = evaluatePr(
      basePr({ author: { login: "rohan-c0de", is_bot: false } }),
      cfg()
    );
    expect(r.safe).toBe(false);
    expect(r.reasons.join()).toMatch(/not the scrape bot/);
  });

  it("rejects a bot with a different login", () => {
    const r = evaluatePr(
      basePr({ author: { login: "dependabot", is_bot: true } }),
      cfg()
    );
    expect(r.safe).toBe(false);
  });

  it("rejects a non-scheduled-scrape branch", () => {
    const r = evaluatePr(basePr({ headRefName: "claude/hi-hotfix" }), cfg());
    expect(r.safe).toBe(false);
    expect(r.reasons.join()).toMatch(/branch/);
  });

  it("rejects when a required label is missing", () => {
    const r = evaluatePr(basePr({ labels: [{ name: "automated" }] }), cfg());
    expect(r.safe).toBe(false);
    expect(r.reasons.join()).toMatch(/scraper-output/);
  });

  it("rejects when the do-not-automerge label is present", () => {
    const r = evaluatePr(
      basePr({
        labels: [
          { name: "scraper-output" },
          { name: "automated" },
          { name: "do-not-automerge" },
        ],
      }),
      cfg()
    );
    expect(r.safe).toBe(false);
    expect(r.reasons.join()).toMatch(/do-not-automerge/);
  });

  it("rejects a draft PR", () => {
    const r = evaluatePr(basePr({ isDraft: true }), cfg());
    expect(r.safe).toBe(false);
    expect(r.reasons.join()).toMatch(/draft/);
  });
});

describe("evaluatePr — content guards", () => {
  it("rejects a PR touching a non-data path (e.g. lib/)", () => {
    const r = evaluatePr(
      basePr({
        files: [
          { path: "data/hi/courses/hawaii-community-college/2026FA.json" },
          { path: "lib/states/hi/config.ts" },
        ],
      }),
      cfg()
    );
    expect(r.safe).toBe(false);
    expect(r.reasons.join()).toMatch(/non-data path/);
  });

  it("rejects a transfers PR (transfer-equiv.json is out of phase-1 scope)", () => {
    const r = evaluatePr(
      basePr({
        headRefName: "scheduled-scrape/hi-transfers",
        files: [{ path: "data/hi/transfer-equiv.json" }],
      }),
      cfg()
    );
    expect(r.safe).toBe(false);
    expect(r.reasons.join()).toMatch(/non-data path/);
  });

  it("rejects a PR spanning multiple states", () => {
    const r = evaluatePr(
      basePr({
        files: [
          { path: "data/hi/courses/kapiolani/2026FA.json" },
          { path: "data/nc/courses/alamance/2026FA.json" },
        ],
      }),
      cfg({ allowlist: ["hi", "nc"] })
    );
    expect(r.safe).toBe(false);
    expect(r.reasons.join()).toMatch(/multiple states/);
  });

  it("rejects when branch state disagrees with path state", () => {
    const r = evaluatePr(
      basePr({ headRefName: "scheduled-scrape/nc-courses" }), // files are hi/
      cfg({ allowlist: ["hi", "nc"] })
    );
    expect(r.safe).toBe(false);
    expect(r.reasons.join()).toMatch(/branch state/);
  });

  it("rejects a PR with zero files", () => {
    const r = evaluatePr(basePr({ files: [] }), cfg());
    expect(r.safe).toBe(false);
    expect(r.reasons.join()).toMatch(/no changed files/);
  });

  it("rejects when file count exceeds the cap", () => {
    const files = Array.from({ length: 30 }, (_, i) => ({
      path: `data/hi/courses/college-${i}/2026FA.json`,
    }));
    const r = evaluatePr(basePr({ files }), cfg({ maxFiles: 25 }));
    expect(r.safe).toBe(false);
    expect(r.reasons.join()).toMatch(/> cap 25/);
  });
});

describe("evaluatePr — state & timing guards", () => {
  it("rejects a CONFLICTING PR", () => {
    const r = evaluatePr(basePr({ mergeable: "CONFLICTING" }), cfg());
    expect(r.safe).toBe(false);
    expect(r.reasons.join()).toMatch(/conflict/);
  });

  it("rejects an UNKNOWN-mergeability PR (retry next run)", () => {
    const r = evaluatePr(basePr({ mergeable: "UNKNOWN" }), cfg());
    expect(r.safe).toBe(false);
    expect(r.reasons.join()).toMatch(/not yet known/);
  });

  it("rejects a health-flagged state", () => {
    const r = evaluatePr(basePr(), cfg({ healthFlagged: new Set(["hi"]) }));
    expect(r.safe).toBe(false);
    expect(r.reasons.join()).toMatch(/unhealthy/);
  });

  it("rejects a PR still inside the soak window", () => {
    const r = evaluatePr(
      basePr({ createdAt: "2026-06-23T10:00:00Z" }), // 2h old
      cfg({ soakHours: 4 })
    );
    expect(r.safe).toBe(false);
    expect(r.reasons.join()).toMatch(/too new/);
  });

  it("accepts a PR exactly at the soak boundary", () => {
    const r = evaluatePr(
      basePr({ createdAt: "2026-06-23T08:00:00Z" }), // exactly 4h old
      cfg({ soakHours: 4 })
    );
    expect(r.safe).toBe(true);
  });
});

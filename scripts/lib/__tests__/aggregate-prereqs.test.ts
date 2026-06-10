import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  aggregateState,
  preserveSourcedEntries,
  hasScriptedPrereqs,
  type PrereqEntry,
} from "@/scripts/lib/aggregate-prereqs";

/**
 * Guards against the 2026-06 scheduled-scrape wipe: the prereqs cron tick
 * ran `aggregate-prereqs.ts <state>` for EVERY state, and for states whose
 * catalog scrapers merge `source`-tagged entries into prereqs.json the
 * section-derived rebuild deleted them all (MA 1946→1020, every
 * gcc/middlesex entry gone) while staying just above the 50% safety net.
 */

// ---------------------------------------------------------------------------
// preserveSourcedEntries — pure merge semantics
// ---------------------------------------------------------------------------

describe("preserveSourcedEntries", () => {
  const sourced = (text: string, source: string): PrereqEntry => ({
    text,
    courses: [],
    source,
  });

  it("carries over sourced entries missing from the rebuild", () => {
    const existing = {
      "ENG 101": sourced("ENG 090", "gcc"),
      "MAT 150": sourced("MAT 100", "middlesex"),
    };
    const { merged, preserved } = preserveSourcedEntries({}, existing);
    expect(merged).toEqual(existing);
    expect(preserved).toBe(2);
  });

  it("does NOT carry over untagged (aggregate-derived) entries", () => {
    const existing: Record<string, PrereqEntry> = {
      "BIO 101": { text: "CHM 101", courses: ["CHM 101"] },
    };
    const { merged, preserved } = preserveSourcedEntries({}, existing);
    expect(merged).toEqual({});
    expect(preserved).toBe(0);
  });

  it("stashes a sourced entry under source:key when the rebuild claims the plain key", () => {
    const rebuilt: Record<string, PrereqEntry> = {
      "ENG 101": { text: "ENG 100", courses: ["ENG 100"] },
    };
    const existing = { "ENG 101": sourced("ENG 090 or placement", "gcc") };
    const { merged, preserved } = preserveSourcedEntries(rebuilt, existing);
    expect(merged["ENG 101"]).toEqual(rebuilt["ENG 101"]);
    expect(merged["gcc:ENG 101"]).toEqual(existing["ENG 101"]);
    expect(preserved).toBe(1);
  });

  it("keeps already-namespaced collision keys as-is", () => {
    const existing = { "gcc:ENG 101": sourced("ENG 090", "gcc") };
    const { merged } = preserveSourcedEntries(
      { "ENG 101": { text: "x", courses: [] } },
      existing,
    );
    expect(merged["gcc:ENG 101"]).toEqual(existing["gcc:ENG 101"]);
  });
});

// ---------------------------------------------------------------------------
// hasScriptedPrereqs — registry-driven skip predicate
// ---------------------------------------------------------------------------

describe("hasScriptedPrereqs", () => {
  it("is true for a state declaring dedicated prereq scrape jobs (ma)", () => {
    expect(hasScriptedPrereqs("ma")).toBe(true);
  });

  it("is false for an aggregate-from-courses state (va)", () => {
    expect(hasScriptedPrereqs("va")).toBe(false);
  });

  it("is false for an unknown slug", () => {
    expect(hasScriptedPrereqs("not-a-state")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// aggregateState — end-to-end against a temp data dir
// ---------------------------------------------------------------------------

describe("aggregateState", () => {
  let root: string;

  const writeJson = (rel: string, value: unknown) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(value, null, 2));
  };
  const readPrereqs = (state: string): Record<string, PrereqEntry> =>
    JSON.parse(
      fs.readFileSync(path.join(root, "data", state, "prereqs.json"), "utf-8"),
    );

  const section = (
    prefix: string,
    number: string,
    text: string,
    courses: string[] = [],
  ) => ({
    course_prefix: prefix,
    course_number: number,
    prerequisite_text: text,
    prerequisite_courses: courses,
  });

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "agg-prereqs-test-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("refuses to touch a scripted-prereqs state's file (the MA wipe)", () => {
    // "ma" declares dedicated catalog scrapers in the real registry. Its
    // committed prereqs.json mixes scraper output (source-tagged) with
    // aggregate entries; course sections can only re-derive the latter.
    const committed = {
      "ACC 101": { text: "ACC 100", courses: ["ACC 100"] },
      "ENG 101": { text: "ENG 090", courses: ["ENG 090"], source: "gcc" },
      "MAT 150": { text: "MAT 100", courses: ["MAT 100"], source: "middlesex" },
    };
    writeJson("data/ma/prereqs.json", committed);
    writeJson("data/ma/courses/some-college/2026FA.json", [
      section("ACC", "101", "ACC 100", ["ACC 100"]),
    ]);

    const count = aggregateState("ma", { rootDir: root });

    expect(count).toBe(3);
    expect(readPrereqs("ma")).toEqual(committed);
  });

  it("rebuilds a scripted state under --force, still preserving sourced entries", () => {
    writeJson("data/ma/prereqs.json", {
      "STALE 999": { text: "gone", courses: [] },
      "ENG 101": { text: "ENG 090", courses: ["ENG 090"], source: "gcc" },
    });
    writeJson("data/ma/courses/some-college/2026FA.json", [
      section("ACC", "101", "ACC 100", ["ACC 100"]),
    ]);

    aggregateState("ma", { rootDir: root, force: true });

    const out = readPrereqs("ma");
    expect(out["STALE 999"]).toBeUndefined();
    expect(out["ACC 101"]).toEqual({ text: "ACC 100", courses: ["ACC 100"] });
    expect(out["ENG 101"]).toEqual({
      text: "ENG 090",
      courses: ["ENG 090"],
      source: "gcc",
    });
  });

  it("rebuilds an aggregate-from-courses state from sections", () => {
    writeJson("data/va/courses/college-a/2026FA.json", [
      section("BIO", "101", "CHM 101", ["CHM 101"]),
      section("BIO", "102", ""),
    ]);

    const count = aggregateState("va", { rootDir: root });

    expect(count).toBe(1);
    expect(readPrereqs("va")).toEqual({
      "BIO 101": { text: "CHM 101", courses: ["CHM 101"] },
    });
  });

  it("preserves sourced entries an aggregate rebuild cannot re-derive", () => {
    writeJson("data/va/prereqs.json", {
      "BIO 101": { text: "old", courses: [] },
      "NUR 200": { text: "BIO 101", courses: ["BIO 101"], source: "catalog" },
    });
    writeJson("data/va/courses/college-a/2026FA.json", [
      section("BIO", "101", "CHM 101", ["CHM 101"]),
    ]);

    const count = aggregateState("va", { rootDir: root });

    expect(count).toBe(2);
    const out = readPrereqs("va");
    expect(out["BIO 101"]).toEqual({ text: "CHM 101", courses: ["CHM 101"] });
    expect(out["NUR 200"]).toEqual({
      text: "BIO 101",
      courses: ["BIO 101"],
      source: "catalog",
    });
  });

  it("refuses a rebuild below 50% of the existing entry count", () => {
    const committed: Record<string, PrereqEntry> = {};
    for (let i = 0; i < 10; i++) {
      committed[`OLD ${100 + i}`] = { text: "x", courses: [] };
    }
    writeJson("data/va/prereqs.json", committed);
    writeJson("data/va/courses/college-a/2026FA.json", [
      section("BIO", "101", "CHM 101", ["CHM 101"]),
    ]);

    const count = aggregateState("va", { rootDir: root });

    expect(count).toBe(10);
    expect(readPrereqs("va")).toEqual(committed);
  });
});

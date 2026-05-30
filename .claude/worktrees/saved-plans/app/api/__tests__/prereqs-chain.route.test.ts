import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// `fs` is mocked so we can inject controlled prereq fixtures without
// touching the real data/{state}/prereqs.json files. The route reads
// process.cwd()/data/{state}/prereqs.json synchronously via fs.readFileSync.
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    default: { ...actual, readFileSync: vi.fn() },
    readFileSync: vi.fn(),
  };
});

import fs from "fs";
import {
  GET,
  parsePrereqGroups,
  buildChain,
} from "../[state]/prereqs/chain/route";

const readFileSyncMock = vi.mocked(fs.readFileSync);

function makeRequest(state: string, course?: string): {
  req: NextRequest;
  ctx: { params: Promise<{ state: string }> };
} {
  const url = new URL(`http://localhost/api/${state}/prereqs/chain`);
  if (course !== undefined) url.searchParams.set("course", course);
  return {
    req: new NextRequest(url),
    ctx: { params: Promise.resolve({ state }) },
  };
}

beforeEach(() => {
  readFileSyncMock.mockReset();
});

// ---------------------------------------------------------------------------
// parsePrereqGroups — pure function, no I/O. This was the highest-value
// target identified in the test-coverage analysis: a buggy AND/OR parser
// silently misclassifies required prereqs as optional, blocking enrollment.
// ---------------------------------------------------------------------------

describe("parsePrereqGroups", () => {
  it("returns an empty array when there are no courses", () => {
    expect(parsePrereqGroups("", [])).toEqual([]);
  });

  it("wraps a single course in a single AND group", () => {
    expect(parsePrereqGroups("ENG 111", ["ENG 111"])).toEqual([["ENG 111"]]);
  });

  it("treats two AND-joined courses as separate AND groups", () => {
    expect(
      parsePrereqGroups("ACC 101 and BUS 107", ["ACC 101", "BUS 107"])
    ).toEqual([["ACC 101"], ["BUS 107"]]);
  });

  it("groups OR-alternatives inside parens as a single AND group with multiple ORs", () => {
    const result = parsePrereqGroups(
      "ACC 101 and (BUS 107 or CIS 107)",
      ["ACC 101", "BUS 107", "CIS 107"]
    );
    expect(result).toEqual([["ACC 101"], ["BUS 107", "CIS 107"]]);
  });

  it("does not split on 'and' when it appears inside parentheses", () => {
    // "(MATH 101 and MATH 102)" should be treated as a single chunk, so the
    // two MATH courses end up in the same OR group, not separate AND groups.
    const result = parsePrereqGroups(
      "PHYS 101 and (MATH 101 and MATH 102)",
      ["PHYS 101", "MATH 101", "MATH 102"]
    );
    expect(result).toEqual([["PHYS 101"], ["MATH 101", "MATH 102"]]);
  });

  it("places unassigned courses in their own AND group", () => {
    // If the text doesn't mention a course at all, fall back to including it
    // as a standalone requirement so it is not silently dropped from the tree.
    const result = parsePrereqGroups("ENG 111", ["ENG 111", "MTH 161"]);
    expect(result).toContainEqual(["ENG 111"]);
    expect(result).toContainEqual(["MTH 161"]);
  });
});

// ---------------------------------------------------------------------------
// buildChain — recursive tree builder; depth-cap and visited-set guard
// against runaway recursion on cyclic catalogs.
// ---------------------------------------------------------------------------

describe("buildChain", () => {
  it("returns a node with empty children for an unknown course", () => {
    const tree = buildChain("UNKNOWN 999", new Map(), new Set(), 0);
    expect(tree.course).toBe("UNKNOWN 999");
    expect(tree.children).toEqual([]);
  });

  it("walks one level of prerequisites", () => {
    const prereqs = new Map<string, { text: string; courses: string[] }>([
      ["ENG 112", { text: "ENG 111", courses: ["ENG 111"] }],
    ]);
    const tree = buildChain("ENG 112", prereqs, new Set(), 0);
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].course).toBe("ENG 111");
  });

  it("stops recursing when depth exceeds 6 (cycle protection)", () => {
    // Build a 10-deep linear chain. The depth cap should halt expansion at 6
    // even without an explicit cycle.
    const prereqs = new Map<string, { text: string; courses: string[] }>();
    for (let i = 0; i < 10; i++) {
      prereqs.set(`X ${i}`, { text: `X ${i + 1}`, courses: [`X ${i + 1}`] });
    }
    const tree = buildChain("X 0", prereqs, new Set(), 0);
    let node = tree;
    let depth = 0;
    while (node.children.length > 0) {
      node = node.children[0];
      depth++;
    }
    // Each recursive call increments depth before testing >= 6, so the deepest
    // populated node we reach is the one whose recursion call still had
    // depth < 6 — i.e. depth 6 from the root.
    expect(depth).toBeLessThanOrEqual(6);
  });

  it("does not infinite-loop on a circular prereq definition", () => {
    const prereqs = new Map<string, { text: string; courses: string[] }>([
      ["A 1", { text: "B 1", courses: ["B 1"] }],
      ["B 1", { text: "A 1", courses: ["A 1"] }],
    ]);
    // If this throws or hangs, the test runner times out — which counts as
    // a failure. So just calling it is the assertion.
    const tree = buildChain("A 1", prereqs, new Set(), 0);
    expect(tree.course).toBe("A 1");
  });

  it("attaches AND-of-OR groups when text has alternatives", () => {
    const prereqs = new Map<string, { text: string; courses: string[] }>([
      [
        "PHYS 101",
        {
          text: "MATH 101 and (CHEM 101 or CHEM 102)",
          courses: ["MATH 101", "CHEM 101", "CHEM 102"],
        },
      ],
    ]);
    const tree = buildChain("PHYS 101", prereqs, new Set(), 0);
    expect(tree.groups).toBeDefined();
    expect(tree.groups!.length).toBe(2);
    // Second AND group has two OR alternatives.
    expect(tree.groups![1].length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// GET handler — input validation + fs error handling
// ---------------------------------------------------------------------------

describe("GET /api/[state]/prereqs/chain", () => {
  it("returns 404 for an unknown state", async () => {
    const { req, ctx } = makeRequest("xx", "ENG 111");
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
  });

  it("returns 400 when the course query param is missing", async () => {
    const { req, ctx } = makeRequest("va");
    const res = await GET(req, ctx);
    expect(res.status).toBe(400);
  });

  it("returns 404 when the state has no prereqs.json", async () => {
    readFileSyncMock.mockImplementationOnce(() => {
      throw new Error("ENOENT");
    });
    const { req, ctx } = makeRequest("va", "ENG 111");
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
  });

  it("returns the prereq tree when the data is loadable", async () => {
    readFileSyncMock.mockImplementationOnce(() =>
      JSON.stringify({
        "ENG 112": { text: "ENG 111", courses: ["ENG 111"] },
      })
    );
    const { req, ctx } = makeRequest("va", "ENG 112");
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.course).toBe("ENG 112");
    expect(body.children[0].course).toBe("ENG 111");
  });

  it("sets a Cache-Control header on success", async () => {
    readFileSyncMock.mockImplementationOnce(() =>
      JSON.stringify({ "ENG 111": { text: "", courses: [] } })
    );
    const { req, ctx } = makeRequest("va", "ENG 111");
    const res = await GET(req, ctx);
    expect(res.headers.get("Cache-Control")).toContain("max-age=3600");
  });
});

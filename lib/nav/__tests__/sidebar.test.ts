import { describe, expect, it } from "vitest";
import {
  sidebarVisible,
  showNavItem,
  buildNavColumns,
  isNavLinkActive,
  closesOnNavigate,
  NAV_GROUPS,
  MORE_ITEMS,
  type NavGating,
} from "../sidebar";

const ALL: NavGating = {
  transferSupported: true,
  prereqsAvailable: true,
  programsAvailable: true,
};

// --- sidebarVisible -------------------------------------------------------

describe("sidebarVisible", () => {
  it("desktop: shows when opened OR pinned", () => {
    expect(sidebarVisible(false, false, true)).toBe(false);
    expect(sidebarVisible(true, false, true)).toBe(true);
    expect(sidebarVisible(false, true, true)).toBe(true);
    expect(sidebarVisible(true, true, true)).toBe(true);
  });

  it("mobile: shows only when explicitly opened", () => {
    expect(sidebarVisible(false, false, false)).toBe(false);
    expect(sidebarVisible(true, false, false)).toBe(true);
  });

  // REGRESSION: a persisted desktop pin must never auto-open the mobile
  // overlay — pin is desktop-only.
  it("mobile: a pinned value does NOT auto-open the sidebar", () => {
    expect(sidebarVisible(false, true, false)).toBe(false);
  });
});

// --- showNavItem (gating) -------------------------------------------------

describe("showNavItem", () => {
  it("hides /transfer when transfers are unsupported", () => {
    expect(showNavItem("/transfer", { ...ALL, transferSupported: false })).toBe(false);
    expect(showNavItem("/transfer", { ...ALL, transferSupported: true })).toBe(true);
  });

  it("hides /plan when prereqs are unavailable", () => {
    expect(showNavItem("/plan", { ...ALL, prereqsAvailable: false })).toBe(false);
    expect(showNavItem("/plan", { ...ALL, prereqsAvailable: true })).toBe(true);
  });

  it("hides /programs AND /choose when no qualifying programs exist", () => {
    expect(showNavItem("/programs", { ...ALL, programsAvailable: false })).toBe(false);
    expect(showNavItem("/choose", { ...ALL, programsAvailable: false })).toBe(false);
    expect(showNavItem("/programs", { ...ALL, programsAvailable: true })).toBe(true);
    expect(showNavItem("/choose", { ...ALL, programsAvailable: true })).toBe(true);
  });

  it("shows ungated items regardless of gating", () => {
    const none: NavGating = {
      transferSupported: false,
      prereqsAvailable: false,
      programsAvailable: false,
    };
    for (const p of ["", "/courses", "/colleges", "/about"]) {
      expect(showNavItem(p, none)).toBe(true);
    }
  });
});

// --- buildNavColumns ------------------------------------------------------

describe("buildNavColumns", () => {
  it("emits the expected columns in order", () => {
    const cols = buildNavColumns("va", ALL);
    expect(cols.map((c) => c.heading)).toEqual([
      "Explore classes",
      "Plan your path",
      "Programs & majors",
      "Guides",
      "More",
    ]);
  });

  it("prefixes state-scoped links with /{state} and resolves Search to the home", () => {
    const cols = buildNavColumns("va", ALL);
    const explore = cols.find((c) => c.heading === "Explore classes")!;
    expect(explore.links.find((l) => l.label === "Search")!.href).toBe("/va");
    expect(explore.links.find((l) => l.label === "Find a Course")!.href).toBe("/va/courses");
  });

  it("keeps Guides links as absolute /blog hrefs (not state-prefixed)", () => {
    const guides = buildNavColumns("va", ALL).find((c) => c.heading === "Guides")!;
    expect(guides.links.every((l) => l.href.startsWith("/blog"))).toBe(true);
  });

  it("ends the More column with the global All States link", () => {
    const more = buildNavColumns("va", ALL).find((c) => c.heading === "More")!;
    expect(more.links.at(-1)).toEqual({ href: "/", label: "All States" });
    expect(more.links.find((l) => l.label === "About")!.href).toBe("/va/about");
  });

  it("includes Find your program in Programs & majors", () => {
    const prog = buildNavColumns("va", ALL).find((c) => c.heading === "Programs & majors")!;
    expect(prog.links.map((l) => l.label)).toContain("Find your program");
  });

  it("omits Transfer when transfers are unsupported", () => {
    const plan = buildNavColumns("va", { ...ALL, transferSupported: false })
      .find((c) => c.heading === "Plan your path")!;
    expect(plan.links.some((l) => l.href === "/va/transfer")).toBe(false);
    expect(plan.links.some((l) => l.href === "/va/schedule")).toBe(true);
  });

  it("omits Semester Planner when prereqs are unavailable", () => {
    const plan = buildNavColumns("va", { ...ALL, prereqsAvailable: false })
      .find((c) => c.heading === "Plan your path")!;
    expect(plan.links.some((l) => l.href === "/va/plan")).toBe(false);
  });

  it("drops the Programs & majors column when the state has no qualifying programs", () => {
    const cols = buildNavColumns("wy", { ...ALL, programsAvailable: false });
    expect(cols.some((c) => c.heading === "Programs & majors")).toBe(false);
    const allHrefs = cols.flatMap((c) => c.links.map((l) => l.href));
    expect(allHrefs).not.toContain("/wy/programs");
    expect(allHrefs).not.toContain("/wy/choose");
  });
});

// --- isNavLinkActive ------------------------------------------------------

describe("isNavLinkActive", () => {
  const home = "/va";

  it("marks the state home active only on an exact match", () => {
    expect(isNavLinkActive("/va", "/va", home)).toBe(true);
    // REGRESSION: home must NOT be active on every sub-route.
    expect(isNavLinkActive("/va/courses", "/va", home)).toBe(false);
  });

  it("marks a page active on itself and its child routes", () => {
    expect(isNavLinkActive("/va/courses", "/va/courses", home)).toBe(true);
    expect(isNavLinkActive("/va/courses/ENG-111", "/va/courses", home)).toBe(true);
  });

  it("does not treat a name-prefix as a child route", () => {
    // "/va/coursesxyz" is not under "/va/courses/"
    expect(isNavLinkActive("/va/coursesxyz", "/va/courses", home)).toBe(false);
  });

  it("never marks the global All States link active on a state page", () => {
    expect(isNavLinkActive("/va", "/", home)).toBe(false);
    expect(isNavLinkActive("/va/courses", "/", home)).toBe(false);
  });

  it("does not mark a Guides (/blog) link active on a state page", () => {
    expect(
      isNavLinkActive("/va/courses", "/blog/what-does-audit-a-class-mean", home),
    ).toBe(false);
  });
});

// --- closesOnNavigate -----------------------------------------------------

describe("closesOnNavigate", () => {
  it("keeps the sidebar open only when pinned on desktop", () => {
    expect(closesOnNavigate(true, true)).toBe(false); // desktop + pinned → stays
    expect(closesOnNavigate(true, false)).toBe(true); // desktop transient → closes
    expect(closesOnNavigate(false, false)).toBe(true); // mobile → closes
    // mobile ignores pin → still closes
    expect(closesOnNavigate(false, true)).toBe(true);
  });
});

// --- structural invariants ------------------------------------------------

describe("nav structure", () => {
  it("has no duplicate paths across task groups + More", () => {
    const paths = [...NAV_GROUPS.flatMap((g) => g.items.map((i) => i.path)), ...MORE_ITEMS.map((i) => i.path)];
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("every group has a heading and at least one item", () => {
    for (const g of NAV_GROUPS) {
      expect(g.heading.length).toBeGreaterThan(0);
      expect(g.items.length).toBeGreaterThan(0);
      for (const i of g.items) expect(typeof i.label).toBe("string");
    }
  });
});

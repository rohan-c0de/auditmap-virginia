/**
 * Pure, framework-free logic for the site sidebar nav (components/Header.tsx).
 *
 * Extracted from the `"use client"` component so the decision logic — what the
 * menu contains, when it's visible, which link is "current", whether a click
 * closes it — can be unit-tested without React, a DOM, or Supabase. The
 * component keeps only the React state, effects, and markup and calls into
 * these helpers.
 */

export type NavItem = { path: string; label: string };
export type NavGroup = { heading: string; items: NavItem[] };
export type NavLink = { href: string; label: string };
export type NavColumn = { heading: string; links: NavLink[] };

// Task-based nav groups — single source of truth for the sidebar. "Find your
// program" (the guided quiz) sits with Programs; it's ungated like /programs
// (both notFound() when a state has no qualifying programs). See #413 for why
// the Programs index is reachable from every page.
export const NAV_GROUPS: NavGroup[] = [
  {
    heading: "Explore classes",
    items: [
      { path: "", label: "Search" },
      { path: "/courses", label: "Find a Course" },
      { path: "/starting-soon", label: "Starting Soon" },
      { path: "/colleges", label: "All Colleges" },
    ],
  },
  {
    heading: "Plan your path",
    items: [
      { path: "/schedule", label: "Schedule Builder" },
      { path: "/plan", label: "Semester Planner" },
      { path: "/transfer", label: "Transfer" },
    ],
  },
  {
    heading: "Programs & majors",
    items: [
      { path: "/choose", label: "Find your program" },
      { path: "/programs", label: "Programs" },
    ],
  },
];

// "More" utility links — About is state-scoped; All States is the global "/".
export const MORE_ITEMS: NavItem[] = [{ path: "/about", label: "About" }];

// Guides cluster (#374) — high-traffic blog hubs surfaced in the sidebar.
export const GUIDES_ITEMS: NavLink[] = [
  { href: "/blog/free-community-college-classes-for-seniors", label: "Senior Waivers" },
  { href: "/blog/how-to-check-if-community-college-course-transfers", label: "Transfer Guides" },
  { href: "/blog/what-does-audit-a-class-mean", label: "Auditing a Class" },
  { href: "/blog/how-to-find-late-start-community-college-classes", label: "Late-Start Classes" },
  { href: "/blog", label: "All Articles →" },
];

export const PIN_KEY = "ccp-nav-pinned";
export const DESKTOP_MQ = "(min-width: 1024px)";

export type NavGating = {
  transferSupported: boolean;
  prereqsAvailable: boolean;
  /**
   * Whether the state has at least one qualifying program. When false, both
   * "/programs" and "/choose" notFound() (a state with no programs that clear
   * the thin-content threshold), so we hide their nav links rather than link
   * to a soft-404 — matching the state home, which already hides its program
   * chips on the same signal.
   */
  programsAvailable: boolean;
};

/**
 * Whether the sidebar is visible. On desktop it shows when opened OR pinned;
 * on mobile only when explicitly opened — pin is a desktop-only convenience,
 * so a persisted pin must never auto-open the overlay on mobile.
 */
export function sidebarVisible(
  open: boolean,
  pinned: boolean,
  isDesktop: boolean,
): boolean {
  return isDesktop ? open || pinned : open;
}

/**
 * Hide /transfer where transfers aren't supported, /plan where prereqs aren't
 * available, and /programs + /choose where the state has no qualifying
 * programs (both notFound() there); every other item always shows.
 */
export function showNavItem(path: string, g: NavGating): boolean {
  return (
    (path !== "/transfer" || g.transferSupported) &&
    (path !== "/plan" || g.prereqsAvailable) &&
    (path !== "/programs" || g.programsAvailable) &&
    (path !== "/choose" || g.programsAvailable)
  );
}

/**
 * Build the sidebar's labeled columns for a state: the gated task groups,
 * then Guides, then a "More" column (About + the global All States link).
 */
export function buildNavColumns(state: string, g: NavGating): NavColumn[] {
  const toLink = (i: NavItem): NavLink => ({
    href: `/${state}${i.path}`,
    label: i.label,
  });
  return [
    // A task group whose every item is gated out (e.g. "Programs & majors" in a
    // state with no qualifying programs) is dropped entirely — otherwise its
    // heading renders with no links under it.
    ...NAV_GROUPS.map((grp) => ({
      heading: grp.heading,
      links: grp.items.filter((i) => showNavItem(i.path, g)).map(toLink),
    })).filter((col) => col.links.length > 0),
    {
      heading: "Guides",
      links: GUIDES_ITEMS.map((i) => ({ href: i.href, label: i.label })),
    },
    {
      heading: "More",
      links: [
        ...MORE_ITEMS.filter((i) => showNavItem(i.path, g)).map(toLink),
        { href: "/", label: "All States" },
      ],
    },
  ];
}

/**
 * Whether a sidebar link points at the current page. The state home
 * (`/{state}`) matches EXACTLY so it isn't active on every sub-route; the
 * global "All States" (`/`) is never active on a state page; everything else
 * matches the page itself or any of its child routes.
 */
export function isNavLinkActive(
  pathname: string,
  href: string,
  stateHome: string,
): boolean {
  if (href === stateHome) return pathname === stateHome;
  if (href === "/") return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * A link click closes the sidebar UNLESS it's pinned open on desktop (where
 * the student wants it to persist while navigating).
 */
export function closesOnNavigate(isDesktop: boolean, pinned: boolean): boolean {
  return !(isDesktop && pinned);
}

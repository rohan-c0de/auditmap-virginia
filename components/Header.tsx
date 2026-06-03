"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";
import UserMenu from "@/components/auth/UserMenu";

// Task-based nav groups — single source of truth for the sidebar. "Find your
// program" (the guided quiz) sits with Programs; it's ungated like /programs
// (both notFound() when a state has no qualifying programs). See #413 for why
// the Programs index is reachable from every page.
const NAV_GROUPS = [
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
const MORE_ITEMS = [{ path: "/about", label: "About" }];

// Guides cluster (#374) — high-traffic blog hubs surfaced in the sidebar.
const GUIDES_ITEMS = [
  { href: "/blog/free-community-college-classes-for-seniors", label: "Senior Waivers" },
  { href: "/blog/how-to-check-if-community-college-course-transfers", label: "Transfer Guides" },
  { href: "/blog/what-does-audit-a-class-mean", label: "Auditing a Class" },
  { href: "/blog/how-to-find-late-start-community-college-classes", label: "Late-Start Classes" },
  { href: "/blog", label: "All Articles →" },
];

const PIN_KEY = "ccp-nav-pinned";
const DESKTOP_MQ = "(min-width: 1024px)";

export default function Header({
  state,
  stateName,
  transferSupported = true,
  prereqsAvailable = false,
}: {
  state: string;
  stateName?: string;
  transferSupported?: boolean;
  prereqsAvailable?: boolean;
}) {
  // `open` is the transient show/hide; `pinned` (persisted) keeps the sidebar
  // open across navigation on desktop. `isDesktop` gates pinning + push.
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const pathname = usePathname();

  // On desktop the sidebar shows when opened OR pinned; on mobile only when
  // explicitly opened (pin is a desktop-only convenience).
  const effectiveOpen = isDesktop ? open || pinned : open;

  // Track viewport so pin/push apply on desktop only.
  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_MQ);
    const sync = () => setIsDesktop(mql.matches);
    sync();
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, []);

  // Restore the persisted pin once on mount (client-only; can't read during
  // SSR). Same hydration-safe pattern as ThemeToggle/UserMenu.
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem(PIN_KEY) === "1") setPinned(true);
    } catch {
      /* ignore */
    }
  }, []);

  // Reflect the open state onto <html> so a small CSS rule can push page
  // content right on desktop (the fixed sidebar fills the gap). Removed on
  // unmount so non-state pages (which don't render this header) never shift.
  useEffect(() => {
    const el = document.documentElement;
    if (effectiveOpen) el.setAttribute("data-nav-open", "1");
    else el.removeAttribute("data-nav-open");
    return () => el.removeAttribute("data-nav-open");
  }, [effectiveOpen]);

  // Close on Escape (transient close; leaves pin state alone).
  useEffect(() => {
    if (!effectiveOpen) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setPinned(false);
      }
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [effectiveOpen]);

  const persistPin = (next: boolean) => {
    setPinned(next);
    try {
      localStorage.setItem(PIN_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  const closeNav = () => {
    setOpen(false);
    persistPin(false);
  };

  // Clicking a link closes the menu unless it's pinned open on desktop.
  const onNavigate = () => {
    if (!(isDesktop && pinned)) setOpen(false);
  };

  const togglePin = () => {
    const next = !pinned;
    persistPin(next);
    if (next) setOpen(true);
  };

  // Hide transfer/planner where the state lacks the data backing them.
  const showItem = (path: string) =>
    (path !== "/transfer" || transferSupported) &&
    (path !== "/plan" || prereqsAvailable);
  const toLink = (item: { path: string; label: string }) => ({
    href: `/${state}${item.path}`,
    label: item.label,
  });

  const columns: { heading: string; links: { href: string; label: string }[] }[] = [
    ...NAV_GROUPS.map((g) => ({
      heading: g.heading,
      links: g.items.filter((i) => showItem(i.path)).map(toLink),
    })),
    { heading: "Guides", links: GUIDES_ITEMS.map((i) => ({ href: i.href, label: i.label })) },
    {
      heading: "More",
      links: [
        ...MORE_ITEMS.filter((i) => showItem(i.path)).map(toLink),
        { href: "/", label: "All States" },
      ],
    },
  ];

  // Highlight the current page. State home (/{state}) matches exactly so it
  // doesn't light up on every sub-route; others match the page or its children.
  const stateHome = `/${state}`;
  const isActive = (href: string) => {
    if (href === stateHome) return pathname === stateHome;
    if (href === "/") return false; // "All States" — never "current" on a state page
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <>
      {/* Top bar */}
      <header className="border-b border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Hamburger — only when the sidebar is closed. When open, the
                single close control lives in the sidebar (no duplicate X). */}
            {!effectiveOpen && (
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="inline-flex items-center justify-center w-10 h-10 -ml-2 rounded-md text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700 transition"
                aria-label="Open menu"
                aria-expanded={false}
                aria-controls="site-sidebar"
              >
                <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                </svg>
              </button>
            )}
            <Link href={`/${state}`} className="flex items-center gap-2">
              <div className="w-8 h-8 bg-teal-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-xs">CCP</span>
              </div>
              <span className="text-xl font-semibold text-gray-900 dark:text-slate-100">
                Community College <span className="text-teal-600">Path</span>{" "}
                <span className="text-gray-400 dark:text-slate-500 font-normal text-base hidden sm:inline">
                  {stateName}
                </span>
              </span>
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <UserMenu />
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Backdrop — mobile only, when the overlay sidebar is open. */}
      {effectiveOpen && !isDesktop && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          aria-hidden="true"
          onClick={closeNav}
        />
      )}

      {/* Sidebar */}
      <aside
        id="site-sidebar"
        aria-label="Site navigation"
        className={`fixed top-0 left-0 z-50 flex h-dvh w-64 flex-col border-r border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg transition-transform duration-200 ease-out ${
          effectiveOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Sidebar control row — aligns with the top bar height. */}
        <div className="flex h-[65px] flex-shrink-0 items-center justify-between border-b border-gray-100 dark:border-slate-700 px-4">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500">
            Menu
          </span>
          <div className="flex items-center gap-1">
            {/* Pin (desktop only) — keep the sidebar open while navigating. */}
            {isDesktop && (
              <button
                type="button"
                onClick={togglePin}
                aria-pressed={pinned}
                title={pinned ? "Unpin menu" : "Keep menu open"}
                className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition ${
                  pinned
                    ? "bg-teal-50 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300"
                    : "text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:text-slate-500 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                }`}
              >
                {/* pin icon */}
                <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 4h6l-1 7 3 2v2H7v-2l3-2-1-7zM12 15v5" />
                </svg>
              </button>
            )}
            <button
              type="button"
              onClick={closeNav}
              aria-label="Close menu"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:text-slate-500 dark:hover:bg-slate-700 dark:hover:text-slate-200 transition"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Grouped nav (vertical) */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {columns.map((col) => (
            <div key={col.heading} className="mb-5 last:mb-0">
              <p className="px-2 mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500">
                {col.heading}
              </p>
              {col.links.map((link) => {
                const active = isActive(link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={`block rounded-md px-2 py-1.5 text-sm transition-colors ${
                      active
                        ? "bg-teal-50 font-semibold text-teal-700 dark:bg-teal-500/10 dark:text-teal-300"
                        : "text-gray-700 hover:bg-gray-50 hover:text-teal-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-teal-300"
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}

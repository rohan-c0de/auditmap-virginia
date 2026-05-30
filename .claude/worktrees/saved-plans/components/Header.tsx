"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";
import UserMenu from "@/components/auth/UserMenu";

const NAV_ITEMS = [
  { path: "", label: "Search" },
  { path: "/courses", label: "Find a Course" },
  { path: "/starting-soon", label: "Starting Soon" },
  { path: "/schedule", label: "Schedule Builder" },
  { path: "/transfer", label: "Transfer" },
  { path: "/plan", label: "Semester Planner" },
  { path: "/colleges", label: "All Colleges" },
  // Programs index — every page in the site links here so the
  // /[state]/program/[slug] comparison hubs (federal earnings data, awards
  // counts) are one click away regardless of entry point. See #413.
  { path: "/programs", label: "Programs" },
  { path: "/about", label: "About" },
];

// Guides dropdown — exposes high-traffic blog clusters from sitewide nav.
// Issue #374: senior waivers cluster pulled 600+ monthly impressions across
// 13 spokes; transfer-credit cluster pulled 930+ on 2 hubs alone. Both were
// previously only discoverable via direct organic search, not header.
const GUIDES_ITEMS = [
  {
    href: "/blog/free-community-college-classes-for-seniors",
    label: "Senior Waivers",
    description: "Free tuition for seniors by state",
  },
  {
    href: "/blog/how-to-check-if-community-college-course-transfers",
    label: "Transfer Guides",
    description: "Direct match vs elective credit",
  },
  {
    href: "/blog/what-does-audit-a-class-mean",
    label: "Auditing a Class",
    description: "Sit in without credit pressure",
  },
  {
    href: "/blog/how-to-find-late-start-community-college-classes",
    label: "Late-Start Classes",
    description: "Enroll after the semester started",
  },
  {
    href: "/blog",
    label: "All Articles →",
    description: "",
  },
];

export default function Header({ state, stateName, transferSupported = true, prereqsAvailable = false }: { state: string; stateName?: string; transferSupported?: boolean; prereqsAvailable?: boolean }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [guidesOpen, setGuidesOpen] = useState(false);
  const guidesRef = useRef<HTMLDivElement>(null);

  // Close guides dropdown on outside click (matches UserMenu pattern)
  useEffect(() => {
    if (!guidesOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (guidesRef.current && !guidesRef.current.contains(e.target as Node)) {
        setGuidesOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [guidesOpen]);

  // Close guides dropdown on Escape
  useEffect(() => {
    if (!guidesOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setGuidesOpen(false);
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [guidesOpen]);

  const links = NAV_ITEMS
    .filter((item) => item.path !== "/transfer" || transferSupported)
    .filter((item) => item.path !== "/plan" || prereqsAvailable)
    .map((item) => ({
      href: `/${state}${item.path}`,
      label: item.label,
    }));

  return (
    <header className="border-b border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-xs text-gray-400 dark:text-slate-500 hover:text-teal-600 transition-colors hidden sm:block" title="All States">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
            </svg>
          </Link>
          <Link href={`/${state}`} className="flex items-center gap-2">
            <div className="w-8 h-8 bg-teal-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-xs">CCP</span>
            </div>
            <span className="text-xl font-semibold text-gray-900 dark:text-slate-100">
              Community College <span className="text-teal-600">Path</span>{" "}
              <span className="text-gray-400 dark:text-slate-500 font-normal text-base hidden sm:inline">{stateName}</span>
            </span>
          </Link>
        </div>

        {/* Desktop nav */}
        <nav className="hidden sm:flex items-center gap-6 text-sm text-gray-600 dark:text-slate-400">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="hover:text-teal-600 transition-colors"
            >
              {link.label}
            </Link>
          ))}
          {/* Guides dropdown — replaces the plain "Blog" link (#374) */}
          <div className="relative" ref={guidesRef}>
            <button
              type="button"
              onClick={() => setGuidesOpen(!guidesOpen)}
              className="inline-flex items-center gap-1 hover:text-teal-600 transition-colors"
              aria-expanded={guidesOpen}
              aria-haspopup="true"
            >
              Guides
              <svg
                className={`w-3 h-3 transition-transform ${guidesOpen ? "rotate-180" : ""}`}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {guidesOpen && (
              <div className="absolute right-0 mt-2 w-72 rounded-md shadow-lg bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 py-1 z-50">
                {GUIDES_ITEMS.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setGuidesOpen(false)}
                    className="block px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                  >
                    <div className="text-sm font-medium text-gray-900 dark:text-slate-100">
                      {item.label}
                    </div>
                    {item.description && (
                      <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                        {item.description}
                      </div>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </div>
          <UserMenu />
          <ThemeToggle />
        </nav>

        {/* Mobile: user menu + theme toggle + hamburger */}
        <div className="sm:hidden flex items-center gap-2">
          <UserMenu />
          <ThemeToggle />
        <button
          type="button"
          onClick={() => setMobileOpen(!mobileOpen)}
          className="inline-flex items-center justify-center w-10 h-10 rounded-md text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700 transition"
          aria-label="Toggle menu"
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? (
            <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          )}
        </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <nav className="sm:hidden border-t border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 pb-4 pt-2">
          <Link
            href="/"
            onClick={() => setMobileOpen(false)}
            className="block py-2.5 text-sm text-gray-500 dark:text-slate-400 hover:text-teal-600 transition-colors"
          >
            All States
          </Link>
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              className="block py-2.5 text-sm text-gray-700 dark:text-slate-300 hover:text-teal-600 transition-colors"
            >
              {link.label}
            </Link>
          ))}
          {/* Guides section (#374) — same destinations as the desktop dropdown */}
          <div className="mt-3 pt-3 border-t border-gray-100 dark:border-slate-700">
            <p className="text-[11px] uppercase tracking-wide font-medium text-gray-400 dark:text-slate-500 mb-1">
              Guides
            </p>
            {GUIDES_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className="block py-2 text-sm text-gray-700 dark:text-slate-300 hover:text-teal-600 transition-colors"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </nav>
      )}
    </header>
  );
}

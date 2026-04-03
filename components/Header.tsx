"use client";

import { useState } from "react";
import Link from "next/link";

const NAV_ITEMS = [
  { path: "", label: "Search" },
  { path: "/courses", label: "Find a Course" },
  { path: "/starting-soon", label: "Starting Soon" },
  { path: "/schedule", label: "Schedule Builder" },
  { path: "/transfer", label: "Transfer" },
  { path: "/colleges", label: "All Colleges" },
  { path: "/about", label: "About Auditing" },
];

export default function Header({ state = "va", stateName = "Virginia", transferSupported = true }: { state?: string; stateName?: string; transferSupported?: boolean }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const links = NAV_ITEMS
    .filter((item) => item.path !== "/transfer" || transferSupported)
    .map((item) => ({
      href: `/${state}${item.path}`,
      label: item.label,
    }));

  return (
    <header className="border-b border-gray-200 bg-white sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-xs text-gray-400 hover:text-teal-600 transition-colors hidden sm:block" title="All States">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
            </svg>
          </Link>
          <Link href={`/${state}`} className="flex items-center gap-2">
            <div className="w-8 h-8 bg-teal-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-xs">CCM</span>
            </div>
            <span className="text-xl font-semibold text-gray-900">
              CC <span className="text-teal-600">CourseMap</span>{" "}
              <span className="text-gray-400 font-normal text-base hidden sm:inline">{stateName}</span>
            </span>
          </Link>
        </div>

        {/* Desktop nav */}
        <nav className="hidden sm:flex items-center gap-6 text-sm text-gray-600">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="hover:text-teal-600 transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Mobile hamburger button */}
        <button
          type="button"
          onClick={() => setMobileOpen(!mobileOpen)}
          className="sm:hidden inline-flex items-center justify-center w-10 h-10 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition"
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

      {/* Mobile dropdown */}
      {mobileOpen && (
        <nav className="sm:hidden border-t border-gray-100 bg-white px-4 pb-4 pt-2">
          <Link
            href="/"
            onClick={() => setMobileOpen(false)}
            className="block py-2.5 text-sm text-gray-500 hover:text-teal-600 transition-colors"
          >
            All States
          </Link>
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              className="block py-2.5 text-sm text-gray-700 hover:text-teal-600 transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}

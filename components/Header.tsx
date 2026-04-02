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
        <Link href={`/${state}`} className="flex items-center gap-2">
          <div className="w-8 h-8 bg-teal-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">AM</span>
          </div>
          <span className="text-xl font-semibold text-gray-900">
            AuditMap <span className="text-teal-600">{stateName}</span>
          </span>
        </Link>

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

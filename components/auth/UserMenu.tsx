"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/hooks/useAuth";

/**
 * User menu for the header — shows sign-in button or user avatar with dropdown.
 *
 * When logged out: "Sign In" button that opens the LoginModal.
 * When logged in: avatar (from OAuth) or initials, with a dropdown menu.
 */
export default function UserMenu() {
  const { user, profile, isLoading, openLoginModal, signOut } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Prevent hydration mismatch — only render after client mount
  useEffect(() => {
    setMounted(true);
  }, []);

  // Safety timeout — don't show loading skeleton forever.
  // If auth check is slow (cold start, network), fall back to "Sign In".
  useEffect(() => {
    if (!isLoading) {
      setLoadingTimedOut(false);
      return;
    }
    const timer = setTimeout(() => setLoadingTimedOut(true), 1500);
    return () => clearTimeout(timer);
  }, [isLoading]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [dropdownOpen]);

  // Close dropdown on Escape
  useEffect(() => {
    if (!dropdownOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDropdownOpen(false);
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [dropdownOpen]);

  // Don't render anything while hydrating
  if (!mounted) {
    return (
      <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-slate-700 animate-pulse" />
    );
  }

  // Show skeleton only briefly — if loading times out, show Sign In button
  if (isLoading && !loadingTimedOut) {
    return (
      <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-slate-700 animate-pulse" />
    );
  }

  // Logged out — show sign-in button
  if (!user) {
    return (
      <button
        onClick={openLoginModal}
        className="text-sm font-medium text-gray-600 dark:text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 transition-colors"
      >
        Sign In
      </button>
    );
  }

  // Logged in — show avatar with dropdown
  const displayName =
    profile?.display_name ||
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email?.split("@")[0] ||
    "User";

  const avatarUrl =
    profile?.avatar_url ||
    user.user_metadata?.avatar_url ||
    user.user_metadata?.picture;

  const initials = displayName
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setDropdownOpen(!dropdownOpen)}
        className="flex items-center gap-2 rounded-full hover:ring-2 hover:ring-teal-200 dark:hover:ring-teal-800 transition"
        aria-label="User menu"
        aria-expanded={dropdownOpen}
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt={displayName}
            className="w-8 h-8 rounded-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-teal-100 dark:bg-teal-900/50 flex items-center justify-center">
            <span className="text-xs font-semibold text-teal-700 dark:text-teal-300">
              {initials}
            </span>
          </div>
        )}
      </button>

      {/* Dropdown */}
      {dropdownOpen && (
        <div className="absolute right-0 mt-2 w-56 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg py-1 z-50">
          {/* User info */}
          <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700">
            <p className="text-sm font-medium text-gray-900 dark:text-slate-100 truncate">
              {displayName}
            </p>
            {user.email && (
              <p className="text-xs text-gray-500 dark:text-slate-400 truncate">
                {user.email}
              </p>
            )}
          </div>

          {/* Menu items */}
          <Link
            href="/account"
            onClick={() => setDropdownOpen(false)}
            className="block px-4 py-2.5 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition"
          >
            My Account
          </Link>

          <button
            onClick={async () => {
              setDropdownOpen(false);
              await signOut();
            }}
            className="block w-full text-left px-4 py-2.5 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition border-t border-gray-100 dark:border-slate-700"
          >
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}

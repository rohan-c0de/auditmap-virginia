"use client";

import { useContext } from "react";
import { AuthContext } from "@/components/AuthProvider";

/**
 * Hook to access auth state and actions.
 *
 * Must be used within an AuthProvider (which wraps the entire app in root layout).
 *
 * Returns:
 * - user: Supabase User object or null
 * - profile: Profile from profiles table or null
 * - isLoading: true while initial auth state is being determined
 * - signInWithOAuth(provider): generic SSO sign-in (works with any provider)
 * - signInWithMagicLink(email): passwordless email sign-in
 * - signOut(): sign out and clear session
 */
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

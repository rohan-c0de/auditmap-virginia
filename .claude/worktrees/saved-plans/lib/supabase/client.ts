import { createBrowserClient } from "@supabase/ssr";

/**
 * Creates a Supabase client for browser ("use client") components.
 * Singleton — safe to call multiple times (returns the same instance).
 * Uses cookie-based sessions via @supabase/ssr.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

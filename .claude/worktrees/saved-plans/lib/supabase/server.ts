import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Creates a Supabase client for Server Components, Server Actions, and Route Handlers.
 * Uses cookie-based sessions via @supabase/ssr.
 *
 * Important: Always use getUser() (server-verified) instead of getSession()
 * (unverified JWT) for authorization decisions.
 *
 * Must be called per-request (do NOT cache or reuse across requests).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // The `setAll` method is called from a Server Component where
            // cookies cannot be set. This is expected when middleware has
            // already refreshed the session — the call can be safely ignored.
          }
        },
      },
    }
  );
}

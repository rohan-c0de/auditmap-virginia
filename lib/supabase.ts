import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Public Supabase client (uses anon key, respects RLS).
 * Safe for server components and API routes that only need read access.
 */
export const supabase: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/**
 * Server-only Supabase client (uses service role key, bypasses RLS).
 * Used in API routes that write data and in CLI scripts.
 */
export function getServiceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Creates a Supabase client for middleware with request/response cookie handling.
 * Refreshes the auth session on every request to keep cookies fresh.
 *
 * Returns both the Supabase client and the (possibly modified) NextResponse.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Apply cookies to the request (for downstream server components)
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );

          // Recreate the response with updated request cookies
          supabaseResponse = NextResponse.next({
            request,
          });

          // Apply cookies to the response (for the browser)
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh the session. This calls the Supabase Auth server to validate
  // and potentially refresh the access token. The refreshed tokens are
  // written back to cookies via the setAll callback above.
  //
  // IMPORTANT: Use getUser() not getSession(). getUser() sends a request
  // to the Supabase Auth server, while getSession() only reads the JWT
  // from cookies without validation.
  try {
    await supabase.auth.getUser();
  } catch {
    // If Supabase is unreachable or returns a network error, let the
    // request continue without a refreshed session. The page will still
    // render — auth-dependent components will treat the user as logged out.
  }

  return supabaseResponse;
}

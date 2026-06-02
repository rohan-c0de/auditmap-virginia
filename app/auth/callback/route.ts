import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth / magic-link callback handler.
 *
 * After a user authenticates via Google SSO (or any OAuth provider) or clicks
 * a magic link, Supabase redirects here with a `code` query parameter.
 * We exchange the code for a session, which sets the auth cookies.
 *
 * Provider-agnostic — works identically for Google, Apple, GitHub, etc.
 *
 * Security:
 *   - `next` is validated as a same-origin PATH so this endpoint can't be
 *     abused as an open redirect (?next=//evil.com / ?next=https://evil.com).
 *   - The redirect host is our canonical site URL in production, never the
 *     attacker-controllable `x-forwarded-host` header (host-header injection).
 */
const CANONICAL_SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com";

/**
 * Validate the post-login `next` target. Must be a clean same-origin path;
 * anything protocol-relative ("//host"), backslash-prefixed ("/\\host"), or
 * carrying a scheme falls back to "/".
 */
function safeNext(raw: string | null): string {
  if (!raw || raw[0] !== "/") return "/";
  if (raw[1] === "/" || raw[1] === "\\") return "/";
  return raw;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  // Only TRUE production forces the canonical host (defending against
  // host-header injection — we never trust x-forwarded-host there). Local dev
  // AND Vercel preview/branch deploys use the request's own origin so login
  // completes on the host the user is actually on. Gating on NODE_ENV instead
  // would bounce preview-deploy logins to the prod host (NODE_ENV is
  // "production" on previews too), dropping the just-set session cookie.
  // VERCEL_ENV is unset locally, so dev falls to `origin` (localhost).
  const base =
    process.env.VERCEL_ENV === "production" ? CANONICAL_SITE_URL : origin;

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Successful auth — redirect to the (validated) intended destination.
      return NextResponse.redirect(`${base}${next}`);
    }
  }

  // Auth failed — redirect to home with error indicator.
  return NextResponse.redirect(`${base}/?error=auth_failed`);
}

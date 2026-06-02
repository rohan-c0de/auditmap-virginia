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

  // In dev, redirect to the request origin (localhost). In production, always
  // use our canonical host — we do NOT trust x-forwarded-host, which a client
  // can set to point the post-login redirect at an arbitrary domain.
  const base =
    process.env.NODE_ENV === "development" ? origin : CANONICAL_SITE_URL;

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

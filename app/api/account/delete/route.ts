import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase";
import { rateLimit, getClientKey } from "@/lib/rate-limit";
import { escapeIlikePattern } from "@/lib/account-export";

/**
 * DELETE /api/account/delete
 *
 * Permanently deletes the authenticated user's account and all associated data.
 * Uses the service role client for admin-level deletion.
 * CASCADE on foreign keys handles cleanup of saved_schedules, saved_courses, etc.
 *
 * Security:
 *   - Rate-limited (cheap first layer against abuse / accidental retries).
 *   - Rejects cross-site requests (CSRF defense): account deletion is
 *     irreversible, so a malicious page must not be able to trigger it with
 *     the victim's cookies via a cross-origin fetch.
 *   - Auth-gated on server-verified getUser(); deletes only the caller's own id.
 */

/**
 * Same-origin check for a state-changing request. Prefers the browser-set
 * Sec-Fetch-Site signal; falls back to comparing Origin against Host. A
 * state-changing request with no usable origin signal is rejected.
 */
function isSameOrigin(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite) {
    // "same-origin" = our own fetch; "none" = user-initiated (e.g. typed URL).
    return fetchSite === "same-origin" || fetchSite === "none";
  }
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function DELETE(request: Request) {
  // 1. Rate limit (cheap, fail fast).
  const { allowed } = rateLimit(getClientKey(request), 5);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  // 2. CSRF: block cross-site invocations of this irreversible action.
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: "Cross-site request blocked" },
      { status: 403 }
    );
  }

  try {
    // 3. Verify the user is authenticated using server-verified getUser()
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    // 4. Use the service role for the deletions that need admin privileges.
    const serviceClient = getServiceClient();

    // 4a. Remove the email-keyed subscriber row(s) FIRST. These are NOT
    // cascaded by deleting the auth user — `subscribers` is keyed by email and
    // the profiles.subscriber_id FK is ON DELETE SET NULL — so without this a
    // deleted user keeps receiving notification emails. Case-insensitive,
    // wildcard-escaped match on the account's verified email.
    if (user.email) {
      const { error: subErr } = await serviceClient
        .from("subscribers")
        .delete()
        .ilike("email", escapeIlikePattern(user.email));
      if (subErr) {
        // Non-fatal: a lingering subscriber (still unsubscribable) is better
        // than a half-deleted account. Surface it for monitoring and proceed.
        console.error("Subscriber cleanup on delete failed:", subErr.message);
      }
    }

    // 4b. Delete the auth user. CASCADE handles profiles + saved_* +
    // plan_seat_notifications.
    const { error: deleteError } =
      await serviceClient.auth.admin.deleteUser(user.id);

    if (deleteError) {
      console.error("Account deletion failed:", deleteError.message);
      return NextResponse.json(
        { error: "Failed to delete account" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Account deletion error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

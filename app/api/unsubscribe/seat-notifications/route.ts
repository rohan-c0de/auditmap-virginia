/**
 * One-click unsubscribe for seat-watch notifications.
 *
 * Accepts both GET (browser-clicked link from an email) and POST (Gmail /
 * Apple Mail one-click via List-Unsubscribe-Post). Both verify the same
 * signed token, flip profiles.seat_notifications_enabled = false, then
 * return a plain-text confirmation (POST) or redirect to a brief HTML
 * confirmation page (GET).
 *
 * Security:
 *   - The token is HMAC-signed so we don't need a session to flip the
 *     flag (List-Unsubscribe-Post arrives unauthenticated by design).
 *   - Service-role client because the user isn't logged in when they
 *     click through; we trust the token, not the session.
 *   - Idempotent: hitting the URL twice sets the flag to false twice;
 *     no error on the second call.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { verifyUnsubscribeToken } from "@/lib/seat-watch-token";

async function handle(token: string | null): Promise<{
  ok: boolean;
  status: number;
  message: string;
}> {
  if (!token) {
    return { ok: false, status: 400, message: "Missing token." };
  }
  const userId = verifyUnsubscribeToken(token);
  if (!userId) {
    return { ok: false, status: 401, message: "Invalid or expired token." };
  }

  const service = getServiceClient();
  const { error } = await service
    .from("profiles")
    .update({ seat_notifications_enabled: false })
    .eq("id", userId);
  if (error) {
    console.error("seat-watch unsubscribe update error:", error.message);
    return {
      ok: false,
      status: 500,
      message: "Couldn't update your preferences. Try the toggle on your account page.",
    };
  }

  return {
    ok: true,
    status: 200,
    message: "Seat alerts turned off. You can re-enable them anytime on your account page.",
  };
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const res = await handle(token);
  // Plain HTML page so the user knows what happened. No frameworks, no
  // JS — this page is reached from email clients with widely varying
  // rendering capabilities.
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${res.ok ? "Seat alerts turned off" : "Couldn't unsubscribe"} — Community College Path</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 40px auto; padding: 24px; color: #1a1a1a;">
  <h1 style="font-size: 20px; color: ${res.ok ? "#0d9488" : "#b91c1c"};">
    ${res.ok ? "Done." : "Hmm."}
  </h1>
  <p style="font-size: 15px; line-height: 1.5; color: #444;">${res.message}</p>
  <p style="font-size: 14px; margin-top: 24px;">
    <a href="/account" style="color: #0d9488;">Go to your account &rarr;</a>
  </p>
</body>
</html>`.trim();
  return new NextResponse(html, {
    status: res.status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function POST(request: NextRequest) {
  // List-Unsubscribe-Post: Gmail/Apple Mail POST to this URL with no body
  // when the user clicks the inbox-level Unsubscribe button. The token is
  // in the query string (same as GET).
  const token = request.nextUrl.searchParams.get("token");
  const res = await handle(token);
  return new NextResponse(res.message, {
    status: res.status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

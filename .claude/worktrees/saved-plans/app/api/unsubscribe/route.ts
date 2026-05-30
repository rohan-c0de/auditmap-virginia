import { isValidState, getStateConfig } from "@/lib/states/registry";
import { removeSubscriberByToken } from "@/lib/subscribers";
import { rateLimit, getClientKey } from "@/lib/rate-limit";

export async function GET(req: Request) {
  const { allowed } = rateLimit(getClientKey(req), 5);
  if (!allowed) {
    return new Response("Too many requests. Please try again later.", { status: 429 });
  }

  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const state = url.searchParams.get("state");

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com";

  if (token && state && isValidState(state)) {
    try {
      await removeSubscriberByToken(token);
    } catch (err) {
      console.error("Unsubscribe error:", err);
    }
  }

  let stateName = "your state";
  let backLink = siteUrl;
  if (state && isValidState(state)) {
    try {
      stateName = getStateConfig(state).name;
    } catch {
      stateName = state.toUpperCase();
    }
    backLink = `${siteUrl}/${state}`;
  }

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Unsubscribed — Community College Path</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 60px auto; padding: 24px; text-align: center; color: #1a1a1a;">
  <div style="margin-bottom: 24px;">
    <span style="font-size: 22px; font-weight: 700; color: #0d9488;">Community College Path</span>
  </div>

  <h1 style="font-size: 20px; margin-bottom: 12px;">You've been unsubscribed</h1>
  <p style="font-size: 15px; color: #666; line-height: 1.5;">
    You won't receive any more notification emails from Community College Path about ${stateName} schedules.
  </p>

  <p style="margin-top: 28px;">
    <a href="${backLink}" style="color: #0d9488; text-decoration: underline; font-size: 14px;">
      Back to Community College Path
    </a>
  </p>
</body>
</html>`.trim();

  // Always return success regardless of whether email was found (prevents enumeration)
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

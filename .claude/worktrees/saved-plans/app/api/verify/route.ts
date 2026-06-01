import { isValidState, getStateConfig } from "@/lib/states/registry";
import { verifySubscriber } from "@/lib/subscribers";
import { rateLimit, getClientKey } from "@/lib/rate-limit";

function htmlPage(title: string, body: string, state?: string): Response {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com";
  const backLink = state ? `${siteUrl}/${state}` : siteUrl;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — Community College Path</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 60px auto; padding: 24px; text-align: center; color: #1a1a1a;">
  <div style="margin-bottom: 24px;">
    <span style="font-size: 22px; font-weight: 700; color: #0d9488;">Community College Path</span>
  </div>
  ${body}
  <p style="margin-top: 28px;">
    <a href="${backLink}" style="color: #0d9488; text-decoration: underline; font-size: 14px;">
      Back to Community College Path
    </a>
  </p>
</body>
</html>`.trim();

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function GET(req: Request) {
  const { allowed } = rateLimit(getClientKey(req), 10);
  if (!allowed) {
    return htmlPage(
      "Too Many Requests",
      `<h1 style="font-size: 20px; margin-bottom: 12px;">Too many requests</h1>
       <p style="font-size: 15px; color: #666;">Please try again in a minute.</p>`
    );
  }

  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const state = url.searchParams.get("state");

  if (!token || !state || !isValidState(state)) {
    return htmlPage(
      "Invalid Link",
      `<h1 style="font-size: 20px; margin-bottom: 12px;">Invalid link</h1>
       <p style="font-size: 15px; color: #666;">This verification link is invalid or has expired.</p>`
    );
  }

  const subscriber = await verifySubscriber(state, token);

  if (!subscriber) {
    return htmlPage(
      "Invalid Link",
      `<h1 style="font-size: 20px; margin-bottom: 12px;">Invalid link</h1>
       <p style="font-size: 15px; color: #666;">This verification link is invalid or has expired.</p>`,
      state
    );
  }

  let stateName: string;
  try {
    stateName = getStateConfig(state).name;
  } catch {
    stateName = state.toUpperCase();
  }

  return htmlPage(
    "Subscription Confirmed",
    `<div style="background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 8px; padding: 20px; margin-bottom: 16px;">
       <h1 style="font-size: 20px; margin: 0 0 8px; color: #0d9488;">You're confirmed!</h1>
       <p style="font-size: 15px; color: #115e59; margin: 0;">
         We'll email you when new ${stateName} community college schedules are posted.
       </p>
     </div>`,
    state
  );
}

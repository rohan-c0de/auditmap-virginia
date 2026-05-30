import { Resend } from "resend";
import { getStateConfig } from "./states/registry";

// Lazy-init: Resend crashes if the API key is empty/undefined at construction time.
// This defers the error until an email is actually sent (not at import/build time).
let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      throw new Error("RESEND_API_KEY is not set. Email sending is disabled.");
    }
    _resend = new Resend(key);
  }
  return _resend;
}

// Override via EMAIL_FROM env var once a different sending identity is
// verified in Resend. The default must be a domain that's verified on
// the Resend account, or sends will be rejected.
const FROM_ADDRESS =
  process.env.EMAIL_FROM ||
  "Community College Path <notifications@communitycollegepath.com>";

function getSiteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com";
}

function unsubscribeUrl(token: string, state: string): string {
  return `${getSiteUrl()}/api/unsubscribe?token=${encodeURIComponent(token)}&state=${state}`;
}

/**
 * Send a verification email for double opt-in.
 */
export async function sendVerificationEmail(
  email: string,
  state: string,
  token: string
): Promise<void> {
  const siteUrl = getSiteUrl();
  const verifyUrl = `${siteUrl}/api/verify?token=${token}&state=${state}`;
  const unsubUrl = unsubscribeUrl(token, state);

  let stateName: string;
  try {
    stateName = getStateConfig(state).name;
  } catch {
    stateName = state.toUpperCase();
  }

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
  <div style="text-align: center; margin-bottom: 24px;">
    <span style="font-size: 20px; font-weight: 700; color: #0d9488;">Community College Path</span>
  </div>

  <h1 style="font-size: 20px; margin-bottom: 12px;">Confirm your subscription</h1>

  <p style="font-size: 15px; line-height: 1.5; color: #444;">
    You signed up to get notified when new ${stateName} community college schedules are posted on Community College Path.
  </p>

  <p style="font-size: 15px; line-height: 1.5; color: #444;">
    Click the button below to confirm your email:
  </p>

  <div style="text-align: center; margin: 28px 0;">
    <a href="${verifyUrl}" style="display: inline-block; background: #0d9488; color: #fff; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-size: 15px; font-weight: 600;">
      Confirm Subscription
    </a>
  </div>

  <p style="font-size: 13px; color: #888; line-height: 1.5;">
    If you didn&rsquo;t sign up, you can safely ignore this email.
  </p>

  <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">

  <p style="font-size: 11px; color: #aaa; line-height: 1.5;">
    Community College Path &middot;
    <a href="${unsubUrl}" style="color: #aaa;">Unsubscribe</a>
  </p>
</body>
</html>`.trim();

  const text = `Confirm your Community College Path subscription\n\nYou signed up to get notified when new ${stateName} community college schedules are posted.\n\nConfirm here: ${verifyUrl}\n\nIf you didn't sign up, ignore this email.\n\nUnsubscribe: ${unsubUrl}`;

  await getResend().emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject: "Confirm your Community College Path subscription",
    html,
    text,
    headers: {
      "List-Unsubscribe": `<${unsubUrl}>`,
    },
  });
}

/**
 * Send a notification that new term schedules are available.
 */
export async function sendNewTermNotification(
  email: string,
  state: string,
  termLabel: string,
  token: string
): Promise<void> {
  const siteUrl = getSiteUrl();
  const browseUrl = `${siteUrl}/${state}`;
  const unsubUrl = unsubscribeUrl(token, state);

  let stateName: string;
  try {
    stateName = getStateConfig(state).name;
  } catch {
    stateName = state.toUpperCase();
  }

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
  <div style="text-align: center; margin-bottom: 24px;">
    <span style="font-size: 20px; font-weight: 700; color: #0d9488;">Community College Path</span>
  </div>

  <h1 style="font-size: 20px; margin-bottom: 12px;">${termLabel} schedules are live!</h1>

  <p style="font-size: 15px; line-height: 1.5; color: #444;">
    New ${termLabel} course schedules are now available for ${stateName} community colleges on Community College Path.
  </p>

  <p style="font-size: 15px; line-height: 1.5; color: #444;">
    Browse courses, check prerequisites, and build your schedule:
  </p>

  <div style="text-align: center; margin: 28px 0;">
    <a href="${browseUrl}" style="display: inline-block; background: #0d9488; color: #fff; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-size: 15px; font-weight: 600;">
      Browse ${termLabel} Courses
    </a>
  </div>

  <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">

  <p style="font-size: 11px; color: #aaa; line-height: 1.5;">
    Community College Path &middot;
    <a href="${unsubUrl}" style="color: #aaa;">Unsubscribe</a>
  </p>
</body>
</html>`.trim();

  const text = `${termLabel} schedules are now available!\n\nNew ${termLabel} course schedules are live for ${stateName} community colleges on Community College Path.\n\nBrowse courses: ${browseUrl}\n\nUnsubscribe: ${unsubUrl}`;

  await getResend().emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject: `${termLabel} schedules are now available — Community College Path`,
    html,
    text,
    headers: {
      "List-Unsubscribe": `<${unsubUrl}>`,
    },
  });
}

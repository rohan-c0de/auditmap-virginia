/**
 * Signed-token helper for the seat-watch one-click unsubscribe link.
 *
 * Tokens are HMAC-SHA256 signed payloads identifying a user. The
 * unsubscribe route verifies the signature, then flips
 * profiles.seat_notifications_enabled = false. No DB round-trip required
 * just to validate the token, which is the right shape for one-click
 * unsubscribe (Apple Mail and Gmail POST the URL without a session).
 *
 * Payload shape: 'u=<user_id>:t=<issued_unix_ms>'
 * Signature:     hex of HMAC-SHA256(payload, SEAT_WATCH_TOKEN_SECRET)
 * Token:         base64url(payload) + '.' + signature
 *
 * Expiry: tokens are valid for 365 days. The user is opting OUT, not
 * authenticating — a stale link should still work; users delete old
 * emails years later and rage-click 'unsubscribe' on whatever survives.
 *
 * Env: SEAT_WATCH_TOKEN_SECRET. A randomly generated 32+ byte string is
 * fine. Tokens are bound to the secret, so rotating it invalidates
 * outstanding unsubscribe links — that's acceptable as long as the
 * account-page toggle exists as a fallback (chunk 6 adds it).
 */
import { createHmac, timingSafeEqual } from "crypto";

const MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

function getSecret(): string {
  const s = process.env.SEAT_WATCH_TOKEN_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      "SEAT_WATCH_TOKEN_SECRET is not set or too short (need ≥32 chars).",
    );
  }
  return s;
}

function b64UrlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64UrlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(
    s.replace(/-/g, "+").replace(/_/g, "/") + pad,
    "base64",
  );
}

/** Mint a one-click unsubscribe token for the given user. */
export function signUnsubscribeToken(userId: string): string {
  const payload = `u=${userId}:t=${Date.now()}`;
  const sig = createHmac("sha256", getSecret())
    .update(payload)
    .digest("hex");
  const payloadB64 = b64UrlEncode(Buffer.from(payload, "utf8"));
  return `${payloadB64}.${sig}`;
}

/** Verify and decode a token. Returns the user_id on success, null on
 *  signature mismatch, expiry, malformed input, or missing secret.
 *  Never throws — return-null-on-bad is the right shape for the
 *  unsubscribe route, which renders an "invalid link" page rather than
 *  500-ing. */
export function verifyUnsubscribeToken(token: string): string | null {
  try {
    const dot = token.indexOf(".");
    if (dot < 0) return null;
    const payloadB64 = token.slice(0, dot);
    const sigHex = token.slice(dot + 1);
    const payload = b64UrlDecode(payloadB64).toString("utf8");

    const expected = createHmac("sha256", getSecret())
      .update(payload)
      .digest("hex");
    const got = Buffer.from(sigHex, "hex");
    const exp = Buffer.from(expected, "hex");
    if (got.length !== exp.length || !timingSafeEqual(got, exp)) return null;

    const m = payload.match(/^u=([0-9a-f-]{36}):t=(\d+)$/);
    if (!m) return null;
    const issuedAt = parseInt(m[2], 10);
    if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > MAX_AGE_MS) {
      return null;
    }
    return m[1];
  } catch {
    return null;
  }
}

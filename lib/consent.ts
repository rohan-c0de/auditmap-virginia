/**
 * Terms of Service / Privacy consent — shared constants + the consent-decision
 * helper used by the signup gate (LoginModal), the recorder (AuthProvider), and
 * the existing-account prompt (ConsentPrompt).
 *
 * Flow:
 *  - LoginModal requires a "13+ and agree to Terms & Privacy" checkbox before
 *    any sign-in. On submit it stores the accepted TOS_VERSION under
 *    CONSENT_PENDING_KEY (localStorage survives the OAuth redirect and a
 *    same-browser magic-link click, both back on our origin).
 *  - On first authenticated load, AuthProvider reads the user's profile + the
 *    pending value and calls decideConsentAction():
 *      "none"   → profile already has tos_accepted_at; nothing to do.
 *      "record" → fresh signup with pending consent; write tos_accepted_at.
 *      "prompt" → authenticated but nothing accepted and nothing pending
 *                 (a pre-consent-gate account, or a magic link opened on a
 *                 different device) → show ConsentPrompt to accept now.
 *
 * Bump TOS_VERSION when the Terms change materially to force re-acceptance.
 */
export const TOS_VERSION = "2026-06-04";

/** localStorage key holding the TOS_VERSION accepted at signup time. */
export const CONSENT_PENDING_KEY = "ccp:consent-pending";

export type ConsentAction = "none" | "record" | "prompt";

export function decideConsentAction(
  tosAcceptedAt: string | null | undefined,
  pendingVersion: string | null | undefined,
): ConsentAction {
  if (tosAcceptedAt) return "none";
  if (pendingVersion) return "record";
  return "prompt";
}

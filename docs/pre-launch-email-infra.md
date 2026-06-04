# Pre-launch email infrastructure runbook

_Last updated 2026-06-04. Closes the Milestone C "pre-launch infra" item._

This is an **operator runbook** — the steps live in the Resend, Supabase, and
domain-registrar dashboards, not in this repo. Work through it once before
opening signups to real volume. Each step has a verification you can actually
check, so "done" is never a guess.

## Why this is needed

Two kinds of email leave this app, and today they use **different** senders:

| Email | Trigger | Current sender | Code |
|---|---|---|---|
| **Transactional** — seat-open alerts, new-term "notify me" confirmations, account exports | seat-watch cron / `/api/subscribe` | **Resend**, `notifications@communitycollegepath.com` | `lib/email.ts` (`FROM_ADDRESS`, overridable via `EMAIL_FROM`) |
| **Auth** — magic-link sign-in | Supabase Auth (login modal) | **Supabase's built-in SMTP** (shared, default) | Supabase Auth, dashboard-configured |

The auth path is the problem at launch:

- Supabase's built-in SMTP is **rate-limited to a few messages/hour** (a shared,
  best-effort sender meant for development) — at real signup volume, magic links
  silently queue or drop, so users can't log in.
- It sends from a generic Supabase address, not our domain, so it lands in spam
  far more often than our already-verified transactional domain does.

**Fix:** point Supabase Auth at **Resend SMTP** so magic links send from the same
verified `communitycollegepath.com` domain as our transactional mail, lifting the
cap and fixing deliverability. One sender, one verified domain, one set of DNS
records.

## Prerequisites (confirm before starting)

- [ ] You can log into the **Resend** account that owns `RESEND_API_KEY` (prod).
- [ ] You can edit **DNS** for `communitycollegepath.com` at the registrar.
- [ ] You're an **owner/admin** on the Supabase project (`cc-coursemap`, ref
      `yobxppofcivecboztbzm`).
- [ ] `EMAIL_FROM` is unset or set to a `communitycollegepath.com` address in
      Vercel prod (defaults to `notifications@communitycollegepath.com` — see
      `lib/email.ts`). Auth email will use the **same** verified domain.

## Step 1 — Verify the sending domain in Resend (DNS)

Transactional mail already sends from `communitycollegepath.com`, so the domain
is likely **already verified**. Confirm — and only add records if it isn't:

1. Resend → **Domains** → `communitycollegepath.com`. If status is **Verified**,
   skip to Step 2.
2. If not verified (or you're adding a dedicated subdomain like
   `mail.communitycollegepath.com`), Resend shows the exact records to add. Copy
   them **from Resend** — never hand-write these values:
   - **SPF** — a `TXT` on the sending domain including Resend
     (`v=spf1 include:amazonses.com ~all` or the value Resend shows).
   - **DKIM** — the `CNAME` (or `TXT`) record(s) Resend generates (domain-specific
     keys; there are usually 1–3).
   - **MX** (only if Resend asks, e.g. for a dedicated `send.` subdomain).
3. Add a **DMARC** record if absent — `TXT` at `_dmarc.communitycollegepath.com`,
   e.g. `v=DMARC1; p=none; rua=mailto:dmarc@communitycollegepath.com` (start at
   `p=none` to monitor, tighten to `quarantine`/`reject` later once aligned).
4. Save at the registrar, then click **Verify** in Resend (propagation: minutes
   to a few hours).

**Verify:** Resend → Domains shows **Verified** with green SPF + DKIM (+ DMARC).

## Step 2 — Point Supabase Auth at Resend SMTP

Resend exposes SMTP credentials usable by any SMTP client, including Supabase Auth.

1. Resend → **API Keys** → create a key scoped to **Sending access** (or reuse the
   prod sending key). This is the SMTP password.
2. Supabase dashboard → **Authentication → Emails → SMTP Settings** → **Enable
   Custom SMTP**, and enter:
   - **Host:** `smtp.resend.com`
   - **Port:** `465` (SSL) — or `587` (STARTTLS) if 465 is blocked
   - **Username:** `resend`
   - **Password:** the Resend API key from step 1
   - **Sender email:** `notifications@communitycollegepath.com` (match
     `FROM_ADDRESS` in `lib/email.ts` so auth + transactional share one identity)
   - **Sender name:** `Community College Path`
3. Save.

**Verify:** from a private window, request a magic link on the live site → it
arrives within seconds, **From** `Community College Path
<notifications@communitycollegepath.com>`, and appears in **Resend → Logs**.
Inspect the email's headers: **SPF=pass** and **DKIM=pass**.

## Step 3 — Raise the Auth email rate limit

The built-in SMTP's low cap is no longer protecting a shared sender once Resend
backs it.

1. Supabase → **Authentication → Rate Limits** → raise **"Emails per hour"** from
   the default to a launch-appropriate ceiling (e.g. a few hundred/hour; Resend's
   own plan limit is the real ceiling — keep this at or below it).
2. Leave OTP/verification limits at sane defaults to deter abuse.

**Verify:** the configured number is well above expected peak signups/hour.

## Step 4 — Optional: customize the Auth email templates

Supabase → **Authentication → Emails → Templates** → **Magic Link**. Keep it
plain and on-brand; ensure the action link uses the site URL (Supabase injects
`{{ .ConfirmationURL }}`). Confirm the **Site URL** and **Redirect URLs** under
Authentication → URL Configuration include `https://communitycollegepath.com`
(matches `NEXT_PUBLIC_SITE_URL` used by `lib/email.ts:getSiteUrl`).

**Verify:** the magic-link email renders correctly and its button lands on the
production callback (not localhost or a preview URL).

## Post-setup verification checklist

- [ ] Resend domain **Verified** (SPF + DKIM + DMARC).
- [ ] Magic-link sign-in works end-to-end on prod; email shows in Resend Logs.
- [ ] Headers show **SPF=pass, DKIM=pass**, DMARC aligned.
- [ ] A transactional email (trigger a new-term "notify me" confirm via
      `/api/subscribe`) still sends from the same domain — auth + transactional
      are unified.
- [ ] Auth email rate limit raised above expected peak.

## Rollback

If custom SMTP misbehaves (bounces, auth-email failures), Supabase →
Authentication → Emails → SMTP Settings → **disable Custom SMTP**. Auth instantly
falls back to the built-in SMTP (rate-limited but functional). Transactional mail
is unaffected — it goes through Resend directly via `lib/email.ts`, not Supabase.

## Notes

- **No repo code change is required** — `lib/email.ts` already sends via Resend
  with an env-overridable `EMAIL_FROM`. This runbook is dashboard + DNS only.
- Keep the Resend SMTP key and `RESEND_API_KEY` in sync with the verified domain;
  rotating the domain means re-verifying (Step 1) before sends resume.
- DMARC: once SPF + DKIM pass consistently for a couple of weeks, tighten the
  DMARC policy from `p=none` to `p=quarantine` (then `p=reject`) to protect the
  domain from spoofing.

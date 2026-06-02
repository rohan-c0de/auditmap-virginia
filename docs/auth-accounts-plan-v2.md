# Auth & Accounts — Corrected Plan (v2)
*Community College Path · synthesized from 5 adversarial code-grounded reviews · 2026-06-01*

## What changed from v1 (and why v1 was unsafe to build)

v1 was a good map of the territory but rested on **four false premises** that the critics disproved against the actual code. Building v1 as written would have shipped live vulnerabilities and corrupted user data. The corrections:

| v1 said | Reality (file evidence) | Impact |
|---|---|---|
| "No middleware exists; add one later" | Next 16 renamed `middleware.ts`→`proxy.ts`; **`proxy.ts` already exists and IS wired** (`proxy.ts:2,100`). Only one proxy file is legal. | Adding `middleware.ts` = conflicting/ignored file. Must **edit `proxy.ts`**. |
| "Enable email-match linking before the 2nd provider — no duplicates yet" | Google **and** magic-link have both been live simultaneously (`AuthProvider.tsx:215,237`); Supabase auto-linking is **off by default**. | **Duplicate accounts likely already exist in prod.** Must audit + merge *first*. |
| "Anonymous→account migration: mirror the localStorage pattern, drain on sign-in" | `saved_plans` has **no unique key** + **polymorphic `plan_data`** (`{semesters}` vs `{groups}`, `017:22-37`); `saved_courses` unique index is **defeated by NULL `college_code`/`crn`**. | A retrying drain **duplicates plans** and **double-inserts favorites**. Needs schema migrations first. |
| "Account deletion cleans all user data" | Cascade misses the **email-keyed `subscribers` row** (`006:19`, `ON DELETE SET NULL`). | Deleted users **keep getting blast emails**. Not GDPR-complete. |

Plus a **live PII leak shipping right now**: the seat-watch cron's dry-run path logs student emails + their planned courses to GitHub Actions logs every 6h (`scripts/seat-watch.ts:84-90`).

---

## P0 — Pre-flight (do BEFORE writing any feature code)

These are **empirical checks** — they resolve unknowns that no amount of planning can. Each has an exact action.

1. **Audit prod for duplicate accounts.** Run in Supabase SQL editor:
   ```sql
   -- same email under multiple auth.users
   select lower(email) e, count(*) from auth.users group by 1 having count(*) > 1;
   -- same email across providers (google + email/otp)
   select lower(identity_data->>'email') e, array_agg(provider)
   from auth.identities group by 1 having count(distinct provider) > 1;
   ```
   If any rows: build a **merge-and-reparent procedure** (re-point `saved_*.user_id`, `profiles.subscriber_id`, `plan_seat_notifications.user_id` from dupe→survivor, then `admin.deleteUser` the dupe) and run it **before** enabling auto-linking. Enabling linking does NOT retroactively merge.

2. **Confirm the Supabase "link identities, verified email only" setting.** Dashboard → Auth. Linking on **unverified** emails = account-takeover (attacker asserts victim's email → inherits all `saved_*`). Must be: auto-link ON, verified-email-only ON. Document the state.

3. **Confirm custom SMTP is configured** (Supabase Auth → SMTP). Today there is **none** (`grep SMTP .env.example` → nothing), so magic-link + email-verification ride Supabase's built-in **~2–4 emails/hour** cap. At any real signup volume students are silently locked out. Point it at Resend and raise auth rate limits **before launch**.

4. **Verify Resend FROM domain DNS** (`notifications@communitycollegepath.com`, `lib/email.ts:24`): SPF + DKIM + DMARC set, domain verified in Resend. A reputation-cold domain's first large send lands in spam.

5. **Stop the live PII leak now** (independent of the rest of this plan): redact/hash emails in `scripts/seat-watch.ts:84-90,104,113` — log a `user_id` prefix or hash, never the address. This is leaking today in dry-run.

---

## P0.5 — Security fixes to already-deployed code (ship as a standalone hardening PR)

These exist in prod now, independent of new features:

- **OAuth callback open-redirect + host-header trust** (`app/auth/callback/route.ts:16,29,32`): `next` is used raw; `x-forwarded-host` is trusted to build the redirect base. Fix: reject `next` unless it's a same-origin path (`!next.startsWith('/') || next.startsWith('//')` → `'/'`); pin the redirect host to an allowlist, don't trust the forwarded header.
- **Account-delete CSRF + no rate limit** (`app/api/account/delete/route.ts`): cookie-authed state-changing endpoint with no `Origin`/`Sec-Fetch-Site` check and no `rateLimit`. A cross-site `fetch(..., {credentials:'include'})` can nuke a logged-in account. Fix: Origin check + rate limit + (ideally) a re-auth/confirmation step. *(No IDOR — it correctly uses the verified `user.id`.)*
- **Harden the two SECURITY DEFINER functions** (`handle_new_user`, `link_subscriber_on_signup`, `006:44-94`): add `SET search_path = public, pg_temp` (classic privilege-escalation vector) and `ON CONFLICT (id) DO NOTHING` to the profile insert (defensive against re-trigger).
- **Wire security headers + the rate limiter into `proxy.ts`** — there's currently no central place for them (the in-memory limiter is also per-instance/cold-start-resettable; rely on Supabase's auth limits as the real control for email sends).

---

## Phase 1 — Minimum viable accounts (corrected)

**Schema migrations FIRST (these gate the migration flow — without them the drain corrupts data):**
- Add a `kind` discriminator to `saved_plans` (`'semester' | 'program'`) so a drain can reconstruct the right `plan_data` shape.
- Add a unique/dedup key to `saved_plans` (e.g. `client_dedup_key` = hash of payload, or `UNIQUE(user_id, state, name)`) so retried drains are idempotent.
- `ALTER saved_courses` → `college_code`/`crn` `NOT NULL DEFAULT ''` so the existing unique index actually fires (today NULLs are distinct → duplicates).

**Auth methods:**
- Add **email/password** (`signUp` + `signInWithPassword` + a reset page via `resetPasswordForEmail`→`updateUser`). Require **email verification before login is honored** (closes the linking pre-seed attack).
- Add a **"set a password"** path for existing **magic-link** users (`updateUser({password})` while authed) — without it, a magic-link user typing a password hits "Invalid credentials" with no recourse.
- Decide: keep magic-link as a second option or retire it (owner call). If kept, it coexists fine once linking is correct.

**Anonymous→account migration (localStorage hand-off — confirmed correct over anonymous sessions):**
- *Why not Supabase anonymous sessions:* `signInAnonymously()` writes the exact `sb-<ref>-auth-token` cookie that `AuthProvider.tsx:160` sniffs → forces the 60KB Supabase chunk + a network `getUser()` onto **every SEO visitor**, killing the deliberate fast-path, and sprays junk `auth.users`/`profiles` rows. Confirmed real.
- Payload must survive a **full-page OAuth redirect** (both Google and magic-link navigate away, destroying React state). Use **`sessionStorage`** (tab-scoped, safer on shared computers) under the existing `ccp:` namespace.
- **Versioned schema:** `{ v:1, kind, entries:[{state, ...}], savedAt }`. On drain, `if (v !== CURRENT) discard+toast`. Wrap `setItem` in try/catch for `QuotaExceededError`. Store only minimal input (course codes + favorite keys), **not** the computed `plan_data` (recompute after sign-in).
- **Per-entry state tagging:** each entry carries its own `state` (users browse multiple states logged-out). Never tag from the sign-in-time "current state" — that silently mis-files rows and corrupts the dashboard's per-state grouping.
- **Drain through a single `rpc()` transaction** with `ON CONFLICT DO NOTHING`; clear sessionStorage **only after** confirmed commit (client inserts have no transaction → partial-failure data loss otherwise).
- **Shared-computer guard (mandatory):** on first `onAuthStateChange` with a payload present, show an explicit *"We found an unsaved plan on this device — add it to **{email}**'s account?"* confirmation. **Never auto-flush** — RLS can't catch A's draft being written under B's valid session.
- **Stale-draft validation:** drop entries whose courses no longer resolve (term rollover) and discard payloads older than ~30 days; tell the user what was skipped.

**Compliance (blockers — must land in Phase 1, not "later"):**
- **Create a Terms of Service page** (none exists today) + **age-attestation checkbox ("I am 13+") and ToS/privacy consent at signup.** The COPPA strategy depends on a ToS that currently doesn't exist, and the audience explicitly includes under-18 dual-enrollment students.
- **Rewrite the privacy policy** (`app/privacy/page.tsx`): it predates accounts, doesn't mention OAuth/saved data/Supabase+Resend sub-processors, and **contradicts itself** (claims "we don't permanently store search queries" while `search_intent_cache` persists them). Add the no-monetization pledge and the FERPA line ("we hold student-entered planning data, not transcripts/records").
- **Fix account deletion** to also remove `subscribers` rows by email (before `admin.deleteUser`), and **add `GET /api/account/export`** (union of `profiles` + all `saved_*` + `plan_seat_notifications` + matching `subscribers`).
- **AdSense vs the no-monetization pledge:** `AdSenseScript` is mounted unconditionally in the root layout (`app/layout.tsx:110`), so personalized Google ads render on `/account` and `/plan/[id]` — authenticated pages viewed by students, including under-18s. Gate ads **off authenticated routes** (and disable personalization for any under-18-flagged account). Serving behaviorally-targeted ads to minors is a COPPA/age-appropriate-design risk and sits badly next to "never monetize student-intent data." Reconcile the privacy copy, which currently claims analytics isn't used for advertising while AdSense personalization is on.
- **Data-retention policy:** today `saved_plans`/`saved_courses`/`search_intent_cache` are kept forever with no abandoned-account expiry. State a retention policy in the privacy page and add an eviction job for `search_intent_cache` (it has an `accessed_at` LRU column but no eviction runs).

**Risks to watch:** linking-setting must be correct before go-live; in-memory limiter insufficient alone for auth endpoints; don't let email/password login proceed pre-verification.

---

## Phase 2 — Apple Sign-In

- **Cost/ops gate:** $99/yr Apple Developer Program; Services ID + .p8 key + Team/Key IDs; **client-secret JWT expires ≤6 months → automate rotation** or login silently breaks. Register the sending domain in Apple's **private-relay allowlist** or alert emails to `@privaterelay.appleid.com` bounce.
- **Display-name handling:** the `on_auth_user_created` trigger is INSERT-only, so a later Apple login (which returns only `sub`, no email/name) can't overwrite the stored name — *but* first-auth with a declined name → display name becomes the relay prefix (`abc123`). Special-case Apple first-auth name capture.
- **Split-identity caveat:** Apple relay email ≠ a real email the student may have used for new-term `subscribers` alerts → `link_subscriber_on_signup` never links them. Let users set a **contact email on the profile decoupled from the login email**.
- **Linked-identities UI** (net-new — none exists; `AccountDashboard` only shows a single provider string): list `getUserIdentities()`, allow link/unlink, but **block unlinking the last identity** *and* **block unlinking the identity backing the current primary email** unless another verified email is promoted first.

---

## Phase 3 — Transfer progress

- New `transfer_goals` + `transfer_goal_courses`, RLS `USING/WITH CHECK (auth.uid()=user_id)`, **denormalized `user_id` on the child** to avoid parent-subquery RLS leaks — **plus a composite FK** `(transfer_goal_id, user_id) → transfer_goals(id, user_id)` (requires `UNIQUE(id, user_id)` on the parent) to prevent `user_id` drift. Declarative, no trigger needed.
- **Identifier reality check:** `target_university` **can** join (stable slugs exist — `data/{state}/transfer-universities.json`, already stored in `saved_transfers.selected_universities`). `target_program` **cannot** reliably join — `program_code` is `null` across all 23 VA files and the runtime `programSlug` drifts on re-scrape (`lib/programs/plan-shared.ts:42-47`). If tracking a CC program of study, store denormalized context (state + college_slug + title + credential) and re-resolve via `resolveProgramBySlug`, not a bare slug. Decide whether `target_program` means transfer destination or program-of-study — they're different key spaces.
- Transfer lookups stay **state-scoped** (`lib/transfer-scoped.ts`) so cross-state data never appears.

---

## Phase 4 — Email alerts go live

- Flip `SEAT_WATCH_DRY_RUN=false` only **after** P0 items 3–5 (SMTP, DNS, log redaction) and a **canary run** on a tiny allowlist.
- **Add a global send circuit-breaker** to the cron: abort + alert if a single run would send > N notifications. Cold-start won't blast (baseline-vs-transition logic is correct, confirmed), but an import-timing glitch (sections flickering 0→>0) could fire en masse; `PER_USER_DAILY_CAP=1` is per-user, not global.
- Re-check user existence / `seat_notifications_enabled` immediately before each send (deletion-vs-cron race).
- Add the inline **"Notify me when a seat opens"** CTA on full sections (the missing progressive trigger; today the only entry point is the account-page toggle).
- CAN-SPAM cleanup: add a **physical postal address** to all email footers; add `List-Unsubscribe-Post: List-Unsubscribe=One-Click` to `sendVerificationEmail`/`sendNewTermNotification` (seat-watch already has it).

---

## Gated vs public (confirmed correct in v1 — no SEO regression)

All course/college/transfer-leaf/instructor/subject/program pages stay **public + crawlable** (ISR/SSG). `/account` and `/plan/[id]` are dynamic + `noindex` and already correctly built (`/plan/[id]` does per-request `getUser()`, 404-not-403 on RLS-null, no ID enumeration). Sitemaps enumerate from the registry and already exclude user pages. **The one SEO landmine:** never add a server-side `createClient()` (pulls `@supabase/ssr` + calls `cookies()`) into any `app/[state]/**` page — it both de-caches the route (`Cache-Control: private`) and bundles auth into every per-state function (250MB cap regression). Keep all `[state]`-route auth reads client-side via `AuthProvider`. **Add a CI grep** that fails if `app/[state]/**` imports `lib/supabase/server` or `@supabase/ssr`.

---

## Confidence & residual unknowns

The plan is comprehensive against the code as it exists. The **only** things not resolvable by planning are 5 empirical/config states, now converted to explicit P0 checks: (1) do prod duplicates exist, (2) is verified-email-only linking on, (3) is custom SMTP configured, (4) is the Resend domain DNS-verified, (5) confirm the live log-redaction landed. Everything else is specified with file-level precision.

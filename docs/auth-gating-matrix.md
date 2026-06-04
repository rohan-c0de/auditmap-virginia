# Auth & Accounts — Login-Gating Decision Matrix
*Community College Path · companion to `auth-accounts-plan-v2.md` · 2026-06-03*

## What this decides

Exactly which features sit behind login, which are gated softly, and which stay fully public — as a feature-by-feature matrix you can implement against without ambiguity. Where `auth-accounts-plan-v2.md` answers *how* to build accounts safely, this doc answers *what* to put behind them.

## The two locked decisions (owner, 2026-06-03)

1. **Login is required to save / persist.** Build and preview stay fully public (no SEO or first-touch loss); only persistence — save plan, save schedule, favorite a course, track transfer/program, set a seat alert — gates via `openLoginModal()`. This **overrides** the older "prefer no-login / localStorage-first" design principle.
2. **Accounts exist to grow an engaged user base.** Retention, an email list for alerts, and a foundation for future logged-in features. This tilts execution toward *earlier, visible* sign-in prompts and *advertising account value on public pages* — but it does **not** move the gate left into browse/search/read.

**Inherited constraints (already decided, not relitigated here):** progressive gate only (never gate read/search/browse); all `/[state]/**` routes stay public, crawlable, ISR-cached, and never import server Supabase (de-caches the route + 250 MB function-size regression — CI grep enforces); providers are email/password + Google + Apple only; SEO is the dominant acquisition channel so nothing currently-indexed gets `noindex`; the audience includes under-18 dual-enrollment students (COPPA); anonymous→account hand-off uses versioned `sessionStorage`, not anonymous Supabase sessions.

## Key finding — the app already implements this stance

This is execution-finishing, not a pivot. The save paths already gate exactly where they should, client-side (so gating them costs zero SEO):

- Planner **Save** renders "Sign in to save" and calls `openLoginModal()` when logged out — `components/SemesterPlanner.tsx:748,799`
- Schedule **Save** — `components/schedule/ScheduleResults.tsx:523,576`
- Favorite / bookmark a course — `app/[state]/courses/CourseSearchClient.tsx:198,216`
- `/account` redirects anonymous users to `/` and is `noindex` — `app/account/page.tsx:7,16`
- `/plan/[id]` redirects anonymous users to `/?next=…`, returns 404 (not 403) to non-owners, and is `noindex` — `app/plan/[id]/page.tsx:33,45,58`
- New-term alerts take an **email only**, no account — `components/NotifyBanner.tsx` → `app/api/subscribe`
- `/ask` is **public + IP-rate-limited at 15/min** (LLM cost, not a login reason) — `app/api/[state]/ask/route.ts:32`

The account persists: `saved_plans`, `saved_schedules`, `saved_courses`, `saved_transfers`, `plan_seat_notifications`, and (email-keyed) `subscribers`.

---

## Section 1 — Decision matrix

Grouped by tier so the line is visible. Columns: **Feature | Trigger moment | Logged-out | Logged-in | SEO impact | Rationale.**

### Tier PUBLIC — read / browse / search, crawlable, auth untouched

| Feature | Trigger | Logged-out | Logged-in | SEO | Rationale |
|---|---|---|---|---|---|
| Home `/` | — | full | + user menu | indexed | acquisition surface |
| Course search `/[state]/courses` | — | full search | + bookmark stars | indexed | search = read |
| Course detail `/[state]/course/[code]` | — | full | same | indexed | aggregate page |
| College page `/[state]/college/[id]` | — | full | same | indexed | core content |
| Transfer table + matrix `/[state]/transfer` | — | full | same | indexed | read viz (built) |
| Transfer **Sankey** (planned) | — | full | same | indexed | read viz |
| Prereq **DAG** (`PrereqFlowChart`) | — | full | same | indexed | read viz (built) |
| Program page `/[state]/program/[slug]` | — | full | same | indexed | content |
| Outcomes / ROI (Scorecard tiles) | — | full | same | indexed | read data |
| Schedule **comparator view** (planned) | — | full grid | + save | indexed | read viz; only save gates |
| Planner **build** `/[state]/plan` | — | build + preview | + save | indexed | build = compute, not persist |
| Schedule **build** `/[state]/schedule` | — | build + preview | + save | indexed | same |
| `/ask` answer card | — (IP-metered 15/min) | answer | same | CDN-cacheable | LLM cost → rate-limit, not login |
| "Help me choose" quiz (planned, approved) | — | quiz → match | + optional save | funnel | top-of-funnel lead-in |
| New-term alerts (`NotifyBanner`) | enter email | subscribe w/ **email only** | same | n/a | low commitment → email, no account |
| Course Share button (`CourseTable:113`) | — | share public URL | same | n/a | shares a public page |
| Blog `/blog` | — | full | same | indexed | content / SEO |
| Demand heatmap (planned, advisor) | — | aggregate view | same | maybe | system data, no PII — off the student axis |
| Coverage-gap dashboard (planned, advisor) | — | aggregate view | same | n/a | articulation-officer tool |

### Tier WRITE-GATED — page public, persist needs login (built with `openLoginModal()`)

| Feature | Trigger | Logged-out | Logged-in | SEO | Rationale |
|---|---|---|---|---|---|
| Planner **save** | "Sign in to save" click | builds, can't persist | → `saved_plans` | none (client write) | persistence = identity |
| Schedule **save** | "Sign in to save" | builds, can't persist | → `saved_schedules` | none | mirrors planner |
| Favorite / bookmark course | star → modal | sees star | → `saved_courses` | none | per-user list |
| **Inline "notify me when a seat opens"** (NEW CTA) | CTA on full section → modal | sees CTA | seat alert on plan | none | needs *which* course = a plan = login |
| Bulk seat-watch (per plan) | account toggle | n/a | → `plan_seat_notifications` | none | tied to `saved_plans` |
| Transfer-progress (track universities) | save on transfer page | views, can't track | → `saved_transfers` | none | light persistence today; full tracker = Phase 3 |
| Program-of-study tracker (planned) | track program | preview | `transfer_goals` (planned) | none | needs schema + slug-drift fix (plan doc Ph3) |
| Progress tracker / check-off (planned) | check off → save | ephemeral preview | `transfer_goals` (planned) | none | owner flipped from no-login → persist = login |

### Tier LOGIN-ONLY — private, existence advertised (built / planned)

| Feature | Trigger | Logged-out | Logged-in | SEO | Rationale |
|---|---|---|---|---|---|
| Saved-plans dashboard `/account` | visit | redirect `/` | full dashboard | `noindex` (built) | private |
| Saved-plan view `/plan/[id]` | visit | redirect `?next=` | **own plan only**, 404 else | `noindex` (built) | private — **not** a public share |
| Alert delivery | — | — | emails (seat = account, term = email) | n/a | split by what's needed |
| Data export (planned) | account → export | n/a | `GET /api/account/export` | n/a | GDPR; not built |

### Tier N/A — absent / not planned

| Feature | Status | If ever built |
|---|---|---|
| Ratings / reviews | absent | WRITE-GATED + moderation + spam controls |
| Comments | absent | WRITE-GATED + moderation |
| **Public plan sharing** | not built | share-token table + public-read + `noindex` + privacy review → open question, not a tier yet |

---

## Section 2 — Gating-strategy narrative (the pattern)

**The line is drawn at *persistence and personal state*, never at *value*.** A feature is PUBLIC if a search engine can index it or a first-time visitor can read/compute it in one session — *including expensive visualizations* (Sankey, DAG, matrix, comparator views, outcomes). The instant a feature must **remember something for you across sessions/devices, send you something, or tie state to your identity**, it crosses into login. This is why a flashy multi-college comparator renders its grid publicly but gates "save this comparison," and why the prereq DAG — which *looks* like a premium logged-in feature — is fully public: it computes from public data and needs no memory of you.

**Three sub-rules make any new feature self-classifying:**

1. **Read is always public.** No exceptions — SEO is the business. Even a logged-in-*feeling* feature exposes its read view and gates only the write.
2. **Write / persist = login.** Save plan, save schedule, favorite, track transfer/program, set a seat alert. All fire `openLoginModal()` at the click, *after* value is built — never before.
3. **Email-only escape hatch for low-commitment notify.** New-term alerts take just an email because a full account would kill that conversion; seat alerts need to know *which* courses (a saved plan) and therefore require login. "Notify me" splits cleanly: needs personal state → login; needs only a destination → email.

**"Grow an engaged user base" tilts execution, not the line.** It means: advertise account value on public pages, prompt at the *first* persistence moment (not the second), add progressive triggers like the inline seat-notify CTA, and make the login modal sell the *specific* thing being saved ("Keep this plan — free, 10 seconds"). It does **not** mean moving the gate into browse/search/read — that would trade the dominant acquisition channel for marginal signups, a trade this product can't afford. The growth lever is *more reasons to sign up on public pages*, not *fewer things you can do without signing up*.

**Advisor / aggregate features sit off the student axis entirely.** Demand heatmaps and coverage dashboards describe *system* data, not personal state, so they're PUBLIC aggregates (or internal tooling) — never student-login. The one red line, from the feature-vision memory: if such a feature ever exposes "students tracking toward *your* program," that is selling student-intent data and is off-mission regardless of gating.

## Cross-cutting requirements (non-negotiable)

These make the matrix *safe* — they are derived from the adversarial critique, not optional polish:

- **Ads OFF on every LOGIN-ONLY / account route; personalization OFF for any under-18 account.** `AdSenseScript` mounts unconditionally (`app/layout.tsx:110`), so today it serves personalized ads to logged-in students — including under-18 dual-enrollees — on `/account` and `/plan/[id]`. Gate it off authed routes **before** ramping signups.
- **Compliance precedes prompt-ramp.** ToS page + age attestation (13+) + privacy rewrite (all Phase-1 in `auth-accounts-plan-v2.md`) must land *before* making signup prompts more prominent. Growing the base aggressively without these is the COPPA exposure.
- **Dismiss / redirect preserves the draft.** Every WRITE-GATED action must keep the in-progress plan/schedule/favorite through both modal-dismiss (React state) and the full-page OAuth redirect (versioned `sessionStorage` hand-off). The student must never lose work at the moment they convert.
- **Reads stay client-side-auth in `app/[state]/**`.** Never add server `createClient()` there; CI grep enforces.
- **Email capture carries consent.** The email-only new-term path collects PII from a population that includes minors — keep it single-purpose, add age/consent microcopy and a CAN-SPAM footer.

---

## Section 3 — Open questions (can't be resolved by planning)

1. **Public plan sharing — build it or not?** Today `/plan/[id]` is owner-private. A true shareable link needs a share-token table, public-read RLS, `noindex`, and a privacy review (a shared plan leaks a student's course choices). → *Owner product decision + a 1-day spike; default: don't build until asked.*
2. **Progress / program tracker persistence depends on Phase-3 schema.** `transfer_goals` / `transfer_goal_courses` aren't built, and `program_code` is null across all VA files (slug drift). → *Build Phase-3 schema first; the WRITE-GATED tier applies only once there's a store.*
3. **Heatmap / coverage-dashboard audience.** Student-public aggregate vs. advisor-login vs. internal-only? → *Owner picks audience; never cross the student-intent red line.*
4. **Signup-prompt prominence.** "Grow the base" wants visible prompts; the north-star wants low friction. The right level of an ambient "Save your work — free" affordance vs. purely contextual prompts is empirical. → *Instrument prompt-impression → conversion from day one; tune after ~1–2 weeks. Needs a baseline that doesn't exist yet.*
5. **Inline seat-notify CTA go-live.** The CTA is cheap, but real emails need custom SMTP + a global send circuit-breaker (plan doc Phase 4). → *Ship the CTA behind the existing dry-run flag; flip after a canary run.*
6. **Under-18 detection mechanism.** "Personalization off for minors" needs an age signal; attestation gives a 13+ boolean, not a birthdate. → *Decide whether attestation suffices or a birth-year is needed; legal input.*
7. **"Help me choose" quiz result persistence.** Save to account (write-gated) or stay ephemeral? → *Ship ephemeral public funnel first; add optional save if retention data shows demand.*

---

## Appendix — Adversarial critique (4 lenses) + confidence

**Lens 1 · SEO / crawl.** No row de-indexes a currently-indexed page — WRITE-GATED features keep their pages public and gate only the action; `/account` + `/plan/[id]` are already `noindex`. Risk surfaced + fixed: "grow user base" pressure could tempt gating the planner *build* or comparator *view* → encoded Sub-rule 1 ("read is always public") + client-side-auth-only guardrail as hard rules. **PASS.**

**Lens 2 · COPPA / under-18.** Found a real issue: AdSense serves personalized ads on authed routes to logged-in under-18 students (`layout.tsx:110`). Fixed: "ads off authed routes + no personalization for minors" is now a cross-cutting requirement, and ToS/age-gate/privacy are a prerequisite to prompt-ramp; added consent microcopy to the email-only path. **PASS, conditional on those three.**

**Lens 3 · Conversion friction.** The persistence-click trigger is well-placed (value built first), but save-click alone may under-convert against the growth goal. Fixed: prompts must be contextual + value-carrying, capped at ≤1 ambient affordance, never interstitial; and "draft survives dismiss + redirect" is an acceptance criterion on every WRITE-GATED row, so a bounced modal never costs the student their work. **PASS.**

**Lens 4 · Data coherence.** Found four features tiered as if stored when they aren't — progress tracker, program tracker, public sharing, data export. Fixed: all labeled PLANNED/contingent; transfer-progress labeled "light persistence today, full tracker = Phase 3." Built gates map cleanly to real tables. **PASS.**

**Confidence: ~96% on the *strategy*** (line at persistence/personal-state; reads always public; email escape-hatch for low-commitment notify; growth tilts execution, not the line). **What would falsify it:**

- Post-launch analytics show the save-click gate converts poorly *and* an earlier/softer gate converts far better *without* hurting SEO → "trigger only at persistence" is too conservative for the growth goal.
- Legal review finds email-only new-term capture from minors is non-compliant without an account/age-gate → even the escape hatch needs gating.
- Owner prioritizes public plan sharing → `/plan/[id]`'s private-only model needs a parallel public-token route (a real architecture change, not a tier tweak).
- A high-value feature emerges whose *read view itself* can't render without per-user state → "read is always public" meets its first genuine exception.

---

*See also: `docs/auth-accounts-plan-v2.md` (the corrected build plan: P0 pre-flight, security hardening, schema migrations, phased rollout).*

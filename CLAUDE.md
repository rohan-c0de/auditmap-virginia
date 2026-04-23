# Community College Path

A national community college course navigator. Helps students find classes, plan schedules, and understand transfer equivalencies across public community-college systems.

- **Live site:** communitycollegepath.com (Vercel project: `cc-coursemap`)
- **Brand name in user-facing copy:** "Community College Path" — not "CC CourseMap", not "AuditMap". The folder name `cc-coursemap` is legacy.
- **North star:** a first-generation student with no prior college experience should be able to use the site without help.

## Scope

The project is **national, expanding state-by-state**. East Coast is nearly complete. Never treat this as a Virginia-only tool — VA was the original scope but the architecture is multi-state.

Currently covered states (as of this writing): ct, dc, de, ga, ma, md, me, nc, nh, nj, ny, pa, ri, sc, tn, va, vt. Run `getAllStates()` for the authoritative list.

## Stack

Next.js 16 (App Router) + React 19 + TypeScript · Supabase (Postgres + SSR auth) · Tailwind v4 · Playwright + cheerio for scrapers · Resend for transactional email · Vercel hosting.

## Architectural invariants — do not violate

1. **Never hardcode state lists.** Derive from the registry via `getAllStates()` / `getStateConfig(slug)`. Commit `be494a7` removed every hardcoded state list specifically to make new-state expansion a config-only change. Components that need per-state values accept them as props; they do not import a `PLACEHOLDER_BY_STATE`-style map.
2. **State-specific defaults live in `StateConfig`.** Zip placeholders, senior-waiver citations, SIS URLs, `defaultZip`, `defaultZipCity`, etc. Never write ternary chains like `state === 'va' ? X : Y` in components.
3. **Per-state file layout is fixed.** Data in `data/{state}/`, scrapers in `scripts/{state}/`, config in `lib/states/{state}/config.ts`. Dynamic routing through `app/[state]/…`.
4. **Student data never runs through prod with fake values.** If a scraper fails, leave the existing data untouched rather than substitute placeholder courses.

## Environment variables

Source of truth: `.env.example` in repo root. Local dev uses `.env.local` (gitignored). Vercel holds the production values.

## Dev commands

- `npm run dev` — local Next server
- `npm run build` · `npm run lint`
- `npm run scrape:college -- <slug>` — scrape a single VA college (VCCS)
- `npm run enrich:college -- <slug>` — PeopleSoft enrichment for one VA college
- Per-state scrapers live at `scripts/{state}/…` — invoke directly with `tsx`

## Adding a new state

This is the most frequent multi-step workflow. See the `add-new-state` skill (`.claude/skills/add-new-state/`). Short version: bootstrap (data + config + registry) → course scraper → transfer data → prereqs → Supabase import. Each phase is its own PR.

## Where guidance lives

Before adding a new rule, recommendation, or reminder anywhere in this repo, ask which of these it is. Each category has one correct home. Putting the wrong thing in the wrong place either bloats a file no one wants to read or buries a rule no one will follow.

| Category | Question it answers | Home |
|---|---|---|
| Universal rule | "Every session, every task — what should I always do?" | `CLAUDE.md` (this file) |
| Workflow rule | "When I'm doing X specifically, what's the right sequence?" | Skill at `.claude/skills/{name}/SKILL.md` |
| Analysis framework | "When reviewing / evaluating, what lens do I apply?" | Agent at `.claude/agents/{name}.md` |
| Location-specific convention | "Why is this file / line / pattern this way?" | Comment at the site of the convention |
| Long-lived decision + rationale | "Why did we choose A over B?" | Code comment, or (if one exists) an ADR |
| Future work | "This should be built later" | GitHub issue — **not** a rule at all |

**Decision procedure** when tempted to add guidance:
1. Is this a **rule** (always-on behavior) or a **project** (build-once code / infra)? If project → GitHub issue. Stop.
2. If rule: **universal** (every session) or **situational** (specific workflow)? Universal → CLAUDE.md. Situational → skill.
3. Can this be **machine-enforced** (CI check, lint rule, hook, schema validation)? If yes, prefer that. Keep the human-readable rule only as a backstop, not the primary.

CLAUDE.md is always in context; every line here costs per-session tokens. Keep it tight. Use skills and code comments for the bulky stuff.

## Git — narrate as you go

The user is learning git in real time and wants to understand what's happening, not just approve blind steps. When running any git or `gh` command, narrate it in **one or two plain-English sentences** before or after the tool call:

- What the command does ("create a new branch off main" / "push this branch to GitHub" / "open a pull request")
- What state the repo is in after ("you now have 1 commit not yet on main" / "the branch is on GitHub but not merged yet")
- What the next step looks like and who does it ("now you click Merge on GitHub" / "I'll wait for you to confirm the PR is merged before starting the next branch")

Avoid jargon unless you define it inline. Say "squash and merge = collapse the branch's commits into one, then land it on main" the first time, not just "squash". If the user has already been told a concept this session, don't re-explain — just use it.

Branch naming convention used so far: `claude/<state>-phase<N><letter>-<topic>` (e.g. `claude/ma-phase2b-colleague`). Stick to that so the user sees a consistent pattern.

Merging is the user's job — they click "Squash and merge" on GitHub. Don't run `gh pr merge` on their behalf unless they explicitly ask.

**Don't push to a PR branch after you've told the user to merge.** GitHub squashes whatever is on the branch at merge-time; a commit pushed seconds after they click Merge becomes an orphaned dead commit on the remote branch and never reaches `main`. This has happened twice (PR #37 and PR #41). If you realize you need one more small edit after saying "go merge", either:
1. Wait for the merge to land, then open a tiny follow-up PR, or
2. Grab the user's attention before they click Merge ("one more commit coming, hold on").

Never push a commit and _hope_ the user hasn't merged yet. That's what caused the lost commits.

## Verifying your work — three checks, in order

Typecheck passing and a scraper completing without errors are necessary but not sufficient. Data can be wrong, APIs can return the right shape with broken content, and a PR that looks fine in isolation can break the UI for real users. Do these three, every time:

### 1. Pre-PR feature check ("does the feature I just shipped actually work?")
Before opening a PR that ships new data or a new endpoint, load the matching feature in local dev and exercise it end-to-end. Don't just hit the API — click through the UI the way the feature will be used:

- New course data for a state → load `/{state}` and search for a course; confirm sections render with the expected fields.
- New transfer data → load `/{state}/transfer`, pick a sending CC and a course, confirm the equivalency shows up.
- New prereq data → load the semester planner, type a course that you know has a prereq, confirm the prereq chain resolves.
- A bug fix → reproduce the bug path and confirm it's fixed.

Cost: usually under 5 minutes. Catches: "the JSON parsed but the field names don't match what the UI reads."

### 2. Post-merge prod check ("did Vercel actually ship it?")
After merging a PR, wait ~2-3 minutes for Vercel to redeploy, then load prod and verify one concrete thing changed:

- `curl communitycollegepath.com/api/{state}/…` returns the new data.
- The visible symptom that motivated the PR (empty page, missing state card, 404) is gone.

Cost: one minute. Catches: missing registry entries, static-import gaps (see the NH/MA `/colleges` bug), Vercel build failures, environment variable drift. Silence here looks identical to success — so always pick a specific thing to verify, not just "it looks fine."

### 3. Heuristic walkthrough at major milestones
After a whole state lands, or after a user-facing feature ships, walk through a concrete task against the live site using the `usability-reviewer` agent's nine lenses (information hierarchy, flow completeness, feedback & state, consistency, error recovery, affordances, data accuracy & trust, mobile parity, performance). Don't adopt a persona. Example task scope:

> "From a cold start at /, use the site to find a weekend accounting class at a Boston-area college that transfers to UMass Boston."

Walk through step by step. If any step dead-ends, shows no feedback, or produces inconsistent output across pages, that's a finding — quote the exact element and classify severity (blocker / friction / polish) and reach (universal / conditional / demographic).

Cost: 5–10 minutes. Catches: the things the other two checks miss — interaction bugs, UX cliffs, cross-feature inconsistencies, state drift in the URL vs. UI.

## Environment quirks

**This is NOT the Next.js you know.** Next 16 has breaking changes vs. training-data-era Next.js. Before writing routing, caching, or server-component code, read the relevant page in `node_modules/next/dist/docs/`. Heed deprecation notices.

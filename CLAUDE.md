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
5. **Scheduled scraping is declared in `StateConfig.scrapers`, not in workflow YAML.** The unified `scheduled-scrape.yml` reads the registry to build its matrix — adding a state to cron is a config edit, not a YAML edit. CI (`check:scrapers`) fails a PR that adds a state without declaring scrapers or including a `// manual-only: <reason>` marker.

## Environment variables

Source of truth: `.env.example` in repo root. Local dev uses `.env.local` (gitignored). Vercel holds the production values.

## Dev commands

- `npm run dev` — local Next server
- `npm run build` · `npm run lint`
- `npm run scrape:college -- <slug>` — scrape a single VA college (VCCS)
- `npm run enrich:college -- <slug>` — PeopleSoft enrichment for one VA college
- Per-state scrapers live at `scripts/{state}/…` — invoke directly with `tsx`

### Long-running commands MUST be detached

`Bash run_in_background: true` is capped at 10 min and its children are killed on session archive — we have lost two multi-hour runs this way (LACCD scrape, AZ auto-add-state Phase 2a). For any command expected to run >10 minutes (orchestrators, full-state scrapers, multi-college Playwright runs, programs scrapes), wrap it in the double-fork detach pattern so it reparents to init and survives:

```bash
( nohup <your-command> > /tmp/<task>.log 2>&1 < /dev/null & )
# verify: ps -o pid,ppid -p <pid>   # PPID must be 1
```

Then persist resume metadata to `/tmp/<task>-info.txt` (PID, log path, branch, ETA). The hook at `.claude/hooks/pre-detach-guard.sh` blocks `run_in_background: true` on known long-running scripts unless they're wrapped this way — if you hit a block, don't bypass; fix the invocation. Polls/checks of the detached process (`pgrep`, `tail`, `jq` on the log) run as normal foreground Bash. See memory `feedback_detach_long_running` for the full recipe.

## Adding a new state

This is the most frequent multi-step workflow. Two skills cover it:

- **`auto-add-state`** (`.claude/skills/auto-add-state/`) — autonomous; one command, one PR. Runs `scripts/lib/add-state.ts` end-to-end: bootstrap → fingerprint → scrape (Banner SSB / Colleague / Banner 8 templates) → articulation lookup → prereq aggregation. Surfaces a manual-TODO list for what couldn't be automated. Use when the user says "/auto-add-state ohio", "add Kentucky", or similar.
- **`add-new-state`** (`.claude/skills/add-new-state/`) — manual fallback; 5 phases, 5 PRs, full human control over each step. Use when the autonomous flow's TODOs need to be addressed one-by-one, when adding bespoke scrapers for custom-platform colleges, or when the user explicitly asks for the manual flow.

### Hard rule — build inline scrapers before the PR

When an auto-add-state run flags a college as `custom HTML/SPA` or `no SIS platform detected`, and its course-search page is publicly accessible (no SSO / no login wall), **build the bespoke scraper now in the same branch — do not defer as a TODO**. Same applies to multi-college clusters with a public guest endpoint (PeopleSoft Community Access patterns, etc.) — adapt the closest existing cluster template (e.g. `scripts/ca/scrape-laccd.ts`) inline.

Why: the user shouldn't have to come back later and re-investigate every college from scratch. One comprehensive PR > one shallow PR plus N follow-ups. The AZ run on 2026-05-24 shipped with 11 buildable colleges deferred as TODOs ("it's another 1-2 hours") — exactly the failure mode this rule prevents.

The hook at `.claude/hooks/pre-pr-build-check.sh` blocks `gh pr create` on auto-add-state branches when the orchestrator's result JSON shows buildable fingerprint TODOs that aren't matched by new scraper files committed on the branch. If you hit the block, build the scrapers — don't bypass. If a TODO is genuinely deferred (>half a day's work, blocked on investigation), record it with a commit subject `DEFERRED-scrapers: <one-line reason>` so the deferral is explicit and grepable.

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

## Git — branch and worktree awareness

**Before touching any file, always confirm which branch you're on and whether a worktree is active.**

```bash
git branch --show-current   # what branch am I on?
git worktree list            # are any worktrees checked out, and which branches do they hold?
```

This matters because:
- A branch checked out in a worktree cannot be checked out anywhere else simultaneously — attempting it corrupts state.
- The blog pipeline and add-state skills create worktrees on named branches. If you switch to or create a branch that matches an active worktree's branch, git will refuse or silently operate on the wrong tree.
- Files edited in the main repo at `.claude/worktrees/<name>/` affect the Next.js build even though they live in a worktree path — the MDX scanner picks them up.

**Concrete checks to run before starting any branch work:**
1. `git branch --show-current` — confirm you're on the right base (usually `main`).
2. `git worktree list` — if any worktrees are listed, confirm the branch you're about to create or check out is not already held by one.
3. If a worktree holds the target branch, either work inside that worktree's directory or remove it first (`git worktree remove <path>`).

Never assume the working directory is the main repo — skills like `blog-pipeline` and `auto-add-state` call `EnterWorktree`, which changes the CWD. After any skill completes, verify `pwd` and `git branch --show-current` before proceeding.

## Git — narrate as you go

The user is learning git in real time and wants to understand what's happening, not just approve blind steps. When running any git or `gh` command, narrate it in **one or two plain-English sentences** before or after the tool call:

- What the command does ("create a new branch off main" / "push this branch to GitHub" / "open a pull request")
- What state the repo is in after ("you now have 1 commit not yet on main" / "the branch is on GitHub but not merged yet")
- What the next step looks like and who does it ("now you click Merge on GitHub" / "I'll wait for you to confirm the PR is merged before starting the next branch")

Avoid jargon unless you define it inline. Say "squash and merge = collapse the branch's commits into one, then land it on main" the first time, not just "squash". If the user has already been told a concept this session, don't re-explain — just use it.

When the user asks what a git *concept* means (rebase, merge conflict, branch base, force-push, draft PR, etc.), treat it as an invitation to actually teach — explain from first principles with a concrete diagram or example tied to the current repo state. Prefer specificity over generality: "PR #62 is based on commit C; main has moved to G" beats "branches have a base commit." Assume nothing is obvious and define terms as you go, but only the first time they come up in a session.

Branch naming convention used so far: `claude/<state>-phase<N><letter>-<topic>` (e.g. `claude/ma-phase2b-colleague`). Stick to that so the user sees a consistent pattern.

Merging is the user's job — they click "Squash and merge" on GitHub. Don't run `gh pr merge` on their behalf unless they explicitly ask.

**Don't push to a PR branch after you've told the user to merge.** GitHub squashes whatever is on the branch at merge-time; a commit pushed seconds after they click Merge becomes an orphaned dead commit on the remote branch and never reaches `main`. This has happened twice (PR #37 and PR #41). If you realize you need one more small edit after saying "go merge", either:
1. Wait for the merge to land, then open a tiny follow-up PR, or
2. Grab the user's attention before they click Merge ("one more commit coming, hold on").

Never push a commit and _hope_ the user hasn't merged yet. That's what caused the lost commits.

## Pull request descriptions — lead with plain English

Every PR body must open with a short section that a non-technical reader could understand, written before the detailed tables / test plan / dependencies / commit lists. Two things to cover, in this order:

1. **What changes for someone using the site.** Concrete and specific: "the college page now shows a '1st-year retention 71%' tile in a new 'After enrollment' section." Not abstract: "improved transparency around outcomes." Name the page, the element, the visible value when relevant. If the change is invisible to users (build fix, infra refactor), say so plainly — "users see nothing new; this unblocks deploys that were failing at the 250 MB function-size cap" — instead of trying to manufacture a UX angle.
2. **What changes on the technical front, when there's a story worth telling.** A sentence or two on the mechanism: which file does the work, what the underlying data source is, what the gotcha was. Reviewers (and you, six months from now) learn what's possible by reading this.

Resist marketing copy. "Empowers students to make informed decisions" tells the reviewer nothing. "Adds three new tiles (retention, 1-year earnings, '% earning above HS median') sourced from federal College Scorecard API fields we weren't fetching before" tells them exactly what landed. **Completely accurate beats vaguely impressive every time** — if a change only helps a subset of pages, or has a known gap, name it.

The detailed tables, file lists, test plans, and dependency notes that already populate PR bodies stay — this is an addition at the top, not a replacement.

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

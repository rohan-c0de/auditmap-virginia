---
name: goal-driven-pr
description: Ship a well-scoped change as one clean, reviewable PR by front-loading judgment into a tight goal, grounding in real code, verifying hard, and stopping at the PR for review. Use when executing a detailed goal/spec handed to you, authoring such a goal, deciding how to split a feature into PRs, or shipping any non-trivial build-then-PR change.
---

# goal-driven-pr

A portable workflow for turning an intent into a merged change with minimal rework. The bet: **spend the judgment up front** — a tight, evidence-grounded goal plus a clear stop point — so execution runs autonomously and review happens once, on a self-contained diff, not mid-build.

It assumes the project already documents its own guardrails (branch/worktree isolation, tests, build, lint, any migration/deploy discipline) in its CLAUDE.md / memory. This is the *operating loop* that leans on them; it does not restate them.

## The loop

1. **Author (or sharpen) a tight goal** — see *Authoring a goal*.
2. **Ground before building** — read the real files you'll touch, and the real prod/external state you'll depend on, *first*. Cite specific `file:line` and actual schemas/APIs, never assumptions.
3. **Build** the smallest change that satisfies one concern.
4. **Verify hard** — see *Verification*.
5. **Open the PR** — plain-English first; name any gap. **Stop for review. Do not merge.**

## Authoring a goal

Self-contained and skimmable — someone (or a fresh session) can execute it without re-deriving context. Keep it tight; if your harness caps goal length, measure and trim to fit. Structure:

- **What & why** — the user-visible change + the reason, in a line or two. State what's explicitly **out of scope**.
- **Pre-flight** — isolation + safety checks to do first (create the branch/worktree; confirm prerequisites).
- **Ground** — name the *actual* files to read and what each provides, so the executor grounds in real code instead of guessing.
- **Steps** — concrete edits with real identifiers (paths, function/column names, exact strings where they matter).
- **Verify** — the checks that must pass before the PR, including how to prove behavior you can't fully exercise.
- **PR** — branch name, a *plain-English-first* body, and **DO NOT MERGE — stop for review.**

Ground the *goal itself* in real code before writing it — a goal full of invented filenames or wrong signatures wastes the whole execution.

## Scope: one concern per PR — split when subsystems differ

- Keep a PR to a single concern; a reviewer should hold the whole diff in their head.
- **Split** when parts touch different subsystems or carry different risk (a UI nudge vs. a new backend table; a data-model + capture step vs. the view that reads it). Sequence them; each lands and is verified on its own.
- **Stage only the files your change touched — never a blind `git add -A`.** Build steps and codegen routinely rewrite generated/derived files you must not commit.

## Surface genuine forks BEFORE building

When the request has a real fork — a product decision, an architecture choice, an MVP-vs-full scope — that materially changes what you build, **ask first** with a crisp options question; don't guess. Building the wrong large thing costs far more than one question. Reserve this for decisions that change the work; otherwise pick the obvious default and say so.

## Verification

Typecheck/lint green and "it ran without error" are necessary, not sufficient. Also:

- **Exercise the real path** the way it'll be used (load the page, hit the endpoint, run the flow) — not just a happy-path unit.
- **Use realistic inputs in at least one check.** Fixtures of round, simple values hide whole bug classes — a column that's an integer in the schema but a decimal in real data; a field that's always present in fixtures but null in prod. Run one check against real-shaped data.
- **When you can't run the path end-to-end** (needs an authenticated session, a third-party callback, prod-only state), prove the critical piece another way and **state the gap honestly in the PR**:
  - extract the logic into a pure function and unit-test it;
  - exercise the server/database side directly in a **rolled-back transaction** — do the write as the real role, assert, then abort so nothing persists;
  - leave the genuinely-unverifiable step as an explicit, *named* manual post-merge check — not hidden.
- **Verify against the deployed/real state, not your assumption of it.** Schemas drift; configs differ across environments. Check before you depend on it.

## PR + stop

- Lead the body with **what changes for a user**, in plain language, before the technical detail. Name known gaps — completely accurate beats vaguely impressive.
- Open the PR and **stop**. Merge is the reviewer's call. Don't push more commits after saying it's ready — a post-merge commit orphans.

## After merge

Confirm it actually shipped (a concrete post-deploy check), then do any promised manual check. Record durable, non-obvious lessons where the project keeps them — and prefer a machine-enforced check (CI / lint / hook) over prose when the lesson can be one.

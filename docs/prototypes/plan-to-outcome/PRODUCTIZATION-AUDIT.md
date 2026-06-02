# Plan-to-Outcome — Productization Audit

_Canonical backlog for taking the design concepts (`concepts/`) to the live site. 2026-06-02._

Tracks issue **#1039**. The concepts in `concepts/` are the **executable spec**; this doc maps
each one to what already exists in prod, what data gates it, and the order to build.

## Headline finding — this is an upgrade layer, not a rebuild

Prod already has a route **and** a component for nearly every concept (home search + US map,
course search, course-across-colleges detail, transfer, schedule with conflict detection,
college, programs, Scorecard outcomes, a prereq DAG, a degree planner, **and** a signed-in
dashboard). So "take these to prod" mostly means **upgrading the visualization/presentation of
features that already ship**, plus ~1–2 genuinely new surfaces and an honesty-hardening pass.

What's genuinely missing in prod today: **no Sankey, no matrix, no compare UI anywhere.** Those
are the net-new *visualizations* the concepts add.

## Reconciliation table

| Concept | Status | Prod route / component | Data gate (coverage) | Risk |
|---|---|---|---|---|
| home-search | Exists | `app/page.tsx` · `CourseSearchHero`+`USMap` | ready | — |
| us-map | Exists | `components/USMap.tsx` | registry collegeCount | — |
| courses | Exists (polish opt.) | `/[state]/courses` · `CourseTable` | courses, 51 states | low (`loadAllCourses` concurrency cap) |
| schedule | Exists | `/[state]/schedule` · `ScheduleBuilder`/`WeeklyCalendar` | sections, 51 | low |
| prereqs (DAG) | Enhance (swap render) | `components/PrereqFlowChart.tsx` | parsed edges, ~41 states | med (per-state quality: html/empty arrays) |
| transfers (matrix+Sankey) | Enhance (list → +matrix/flow) | `/[state]/transfer` · `TransferClient` (list only) | `transfers` table, status-queryable, ~30 states | med (course- vs mapping-level; verify in-state filter) |
| program viewbook | Enhance (presentation) | `/[state]/program/[slug]` · `ProgramRequirements` | programs, **~25–30 states** | med (programs coverage) |
| compare-outcomes | Enhance (richer view) | `CollegeScorecardSection` (tiles) | scorecard (national) | low–med (cut fluffy peer panel) |
| dashboard ("your path") | Enhance | `app/account` · `AccountDashboard` | **auth (#1067/#1068)** + progress model | med (sequence after auth) |
| compare-colleges (matrix) | Net-new (partly in course detail) | `/[state]/course/[code]` aggregates a course across colleges | sections + transfer, ready | med (cross-college join) |
| choose (quiz) | Net-new | NONE (owner-approved) | programs + honest fit signal | med (fit must be defensible / inferred-labeled) |

## Ranked backlog

**Foundation (do alongside Tier A):**
- Port concept design tokens → Tailwind `@theme` (`app/tailwind.source.css`; CLI-compiled, not Turbopack).
- Turn existing per-state helpers (`hasPrereqsCoverage`, `hasProgramsCoverage`, `transferSupported`) + audit-snapshot grades into the gating layer every feature uses.
- Add a CI check: **no fabricated / illustrative data in prod components** (the concepts' placeholder values must never leak).
- Port the prototype's invariant harness (gather-vs-render parity) to real tests.

**Tier A — ship first (ready, low-risk, enhances existing):**
1. ⭐ **Transfer matrix view** on `/transfer` — real status-queryable data, it's a table, decision-changing; the course-vs-mapping "best outcome" collapse is already solved in the concept. **Confirmed first ship.**

**Tier B — high value, ready, moderate effort:**
2. **Prereq DAG upgrade** — replace `PrereqFlowChart` with the clean-at-rest / hover-to-trace / reduced-edge rendering; gate by per-state prereq grade.
3. **Compare-colleges matrix** — add as a view on the existing course-detail route (already pulls a course across colleges).
4. **Program viewbook** presentation upgrade — gated on programs coverage.

**Tier C — needs more / dependencies:**
5. **Outcomes "compare" view** — assemble; drop the peer-earnings panel (flagged as fluff/misleading).
6. **Choose quiz** — net-new; the honest fit signal is the design problem to solve first.
7. **Dashboard "your path"** — sequence after the auth buildout (#1067/#1068) lands.

## Per-feature production recipe

> data loader (reuse existing / new Supabase query) → component (port the concept HTML/JS to
> React + Tailwind) → wire to real per-state data → honesty guardrails (flags, designed empty
> states) → flag on for ready states only → verify (the 3 checks: pre-PR feature click-through,
> post-merge prod check, heuristic walkthrough).

One PR per feature (or a small stack), behind a flag, per-state-gated, referencing the concept
file as the spec.

## Honesty as code (non-negotiable)

- Term-keyed seats; gather-vs-render parity (invariant harness → tests).
- "Reviewed ≠ transfers"; **course-level vs mapping-level counts** stated in-UI.
- In-state transfers only; inferred data labeled inferred (never shown as fact).
- No coverage grades shown to students (the live map signals available-vs-coming-soon only).
- No fabricated data / no selling student-intent data.

## Key data facts (verified in this audit)

- **Transfers:** `lib/transfer.ts` + `transfers` table; each mapping carries `is_elective` / `no_credit` (direct = neither). **One CC course → many universities** (one-to-many) → matrix must collapse to best outcome per course. ~30 states. ⚠️ **Verify the matrix's source is the in-state-filtered set** (raw layer mixes geography; an in-state rule strips it elsewhere, e.g. DC went empty).
- **Prereqs:** `data/{state}/prereqs.json` stores **parsed edges** (`courses[]`) + `lib/prereqs.ts` chain builder (AND-of-OR, cycle-safe) already powers the planner; `PrereqFlowChart` already renders a DAG. ~41 states; quality varies (`htmlContaminated`, `emptyCourseArrays` tracked in the audit snapshot).
- **Programs:** `data/{state}/programs/{college}.json`, structured (requirement groups, choose-N, OR-alternatives); ~25–30 states; no central loader (file discovery); platform variance.
- **Scorecard:** `data/{state}/scorecard/{id}.json` via `lib/scorecard.ts`; national coverage; ~2-yr lag.
- **Courses/sections:** Supabase + `data/{state}/courses/{college}/{term}.json`; term-keyed; 51 states. ⚠️ `loadAllCourses()` concurrency capped at 5 — do not raise (build-time pool saturation).
- **Per-state gating:** `lib/states/registry.ts` helpers + `docs/state-goals/_audit-snapshot.json` grades.

## Dependencies / sequencing

- Dashboard ← auth buildout (#1067/#1068).
- Program viewbook, choose quiz ← programs coverage (~25–30 states).
- Everything ← design tokens + gating layer + honesty CI (Foundation).

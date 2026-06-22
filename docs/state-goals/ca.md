# California (ca) — state goals

> **Current tier: B** · Limited by: **courses (term hygiene)** · _Refreshed 2026-06-22_
>
> Dimensions: `crs=B` `prq=A` `trf=A` `sc=A` `cfg=A`
>
> _Adjusted course coverage is effectively full (the unbuildable colleges are documented ceilings). The B-cap is now almost entirely term-code hygiene: the collector flags 10 "suspicious" + 1 stale term, but most are real 2026 terms in non-canonical encodings (`2026-FA`, `FA2026`, `26-FA`, …). A grader-vocabulary issue, partly a grading artifact._

## Diagnosis

- **Primary gap:** `gradeCourses()` returns B only because `suspicious>0 || stale>0` (coverage is already ≥95% adjusted). CA's 10 suspicious terms are largely encoding variants of valid current terms across 117 colleges; the lone stale `2025FA` is a genuine old term a re-scrape clears.
- **Cheapest lever** (grader term hygiene): teach the collector's `isSuspicious()` (`.claude/skills/state-audit/scripts/collect-audit-data.ts:213`) to recognize canonical-equivalent encodings (and real sub-sessions), ideally via a shared `lib/term-normalize.ts` also used on the courses read path so the UI groups terms consistently. Update `grade-snapshot.test.ts`.
- **Honesty:** partly a grading-artifact fix, not new student data. The durable win is consistent term labels in the UI. The stale `2025FA` is a separate re-scrape.
- **Effort:** medium — shared util + collector + snapshot test. Out of scope: per-college SIS scraper rewrites (coverage gaps are already ceiling-documented).
- **Programs / planner:** 18 program files, aligned ✅ (planner-ready).

## Goal checklist

### CA — current tier B (coverage maxed; limited by term-code hygiene)

This is the shared **ca/tx term-code hygiene** goal — one PR covers both states.

- [ ] Pre-flight: `WT=$(scripts/new-pr-worktree.sh term-normalize); cd "$WT"`.
- [ ] Add a canonical term normalizer (`lib/term-normalize.ts`): map separators / ordering / 2-3-digit-year variants → `YYYY<SEASON>[#]`; recognize real sub-sessions (MAY/DEC/SM/SUL/SUMINI/intersession) as valid.
- [ ] Use it in `isSuspicious()` / term collection so canonical-equivalent codes stop counting; optionally also on the courses read path for UI consistency.
- [ ] Update `grade-snapshot.test.ts` ca expected grade + a one-line justification.
- [ ] Re-scrape (or prune) the genuinely-stale `2025FA`; spot-check any far-future codes are real.
- [ ] Re-run collector for ca; `npm test`. Report suspicious/stale before→after. ca reaches A only if both hit 0; if not, say so honestly (stays B, with cleaner term labels).
- [ ] PR (branch `claude/term-normalize`): plain-English first ("term labels across CA colleges are now recognized in their many formats, so the data-quality grade reflects reality"). DO NOT MERGE — stop for review.

Definition of done: ca's suspicious-term count driven to ~0 via canonical recognition; stale cleared or named as a follow-up; snapshot test updated; honest about whether A is actually reached.

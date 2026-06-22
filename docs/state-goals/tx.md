# Texas (tx) — state goals

> **Current tier: B** · Limited by: **courses (term hygiene)** · _Refreshed 2026-06-22_
>
> Dimensions: `crs=B` `prq=A` `trf=A` `sc=A` `cfg=A`
>
> _Adjusted course coverage is full (unbuildable colleges are documented ceilings). The B-cap is term-code hygiene: 21 "suspicious" + 2 stale terms, but most suspicious ones are real terms in non-canonical encodings across 59 colleges (`2026-FA`, `226FA`, `26-FA`, `FA2026`, plus real sub-sessions `2026MAY`/`2026DEC`/`2026SUL`). Partly a grading artifact._

## Diagnosis

- **Primary gap:** courses graded B only because `suspicious>0 || stale>0` (coverage ≥95% adjusted). TX's 21 suspicious terms split into (a) encoding variants of valid 2026 terms, (b) real sub-sessions outside the FA/SP/SU/WI vocabulary (MAY/DEC/SM/SUL/SUMINI), and (c) far-future codes (`2028*`/`2029*`) worth a spot-check. The 2 stale (`2024FA`,`2025FA`) are genuinely old.
- **Cheapest lever** (grader term hygiene): the same shared `lib/term-normalize.ts` + `isSuspicious()` change as ca — one PR covers both states. Update `grade-snapshot.test.ts`.
- **Honesty:** partly a grading-artifact fix. The far-future `2028`/`2029` codes are NOT encoding noise — list them as a data follow-up (verify at the offending colleges; fix or exclude). Stale clears on a re-scrape.
- **Effort:** medium — shared util + collector + snapshot. Out of scope: per-college SIS rewrites (coverage already ceiling-documented).
- **Programs / planner:** 0 program files (A-tier extra).

## Goal checklist

### TX — current tier B (coverage maxed; limited by term-code hygiene)

Shared **ca/tx term-code hygiene** goal — one PR covers both (see `ca.md` for the core steps). TX-specific:

- [ ] In the normalizer, ensure TX's variants resolve: `2026-FA`/`226FA`/`26-FA`/`FA2026`/`S12026` → canonical; accept `2026MAY`/`2026DEC`/`2026-SM`/`2026SUL`/`2026SUMINI` as real sub-sessions.
- [ ] Spot-check the far-future codes (`2028FA`/`2028SP`/`2028SU`/`2029FA`/`2029SP`/`2027-SP`/`SP2027`) — if a college mis-emits a year, fix at the scraper or exclude; if they're real advance terms, allow them.
- [ ] Re-scrape / prune the stale `2024FA`,`2025FA`.
- [ ] Update `grade-snapshot.test.ts` tx expected grade; re-run collector + `npm test`; report suspicious/stale before→after. tx reaches A only if suspicious AND stale hit 0 — be honest if it stays B.

Definition of done: tx's suspicious count driven down via canonical recognition + far-future triage; stale cleared or named as a follow-up; snapshot updated; honest about whether A is reached.

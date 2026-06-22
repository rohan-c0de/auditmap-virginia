# Nebraska (ne) — state goals

> **Current tier: B** · Limited by: **courses** · _Refreshed 2026-06-22_
>
> Dimensions: `crs=B` `prq=A` `trf=B` `sc=A` `cfg=A`
>
> _The old F is cleared — transfers are now wired (B). Courses are 89% (8/9); the single gap, Nebraska College of Technical Agriculture (NCTA), is a tiny custom-HTML UNL ag college — buildable but low-value. Two separate levers could lift to A: the NCTA course scraper (courses B→A) or deepening transfers (B→A)._

## Diagnosis

- **Primary gap (this lever):** courses 89% (8/9). The lone gap is `nebraska-college-of-technical-agriculture` (ncta.unl.edu), a small custom-HTML site with no detected public SIS (not in fingerprint-baseline; clusters.json = singleton).
- **Disposition (honest):** buildable IF a public course-search endpoint exists — needs a live probe (`ncta.unl.edu/...` for a sections page or JSON). If public → build a small bespoke scraper inline; if login-walled → document as a ceiling. Low value: NCTA is tiny and courses is already B.
- **Secondary lever (out of scope here):** transfers are B (not A) — a separate improvement, not part of this courses flip.
- **Effort:** low (small custom scraper) but low-value. Programs present and planner-aligned (2 files).
- **Course colleges:** 1 probe (NCTA) / 0 blocked.

## Goal checklist

### NE — current tier B (limited by courses; transfers now wired at B)

- [ ] Pre-flight: `WT=$(scripts/new-pr-worktree.sh ne-ncta); cd "$WT"`.
- [ ] **Probe first** (audit hint is optimistic): check `ncta.unl.edu` for a public course/section listing or JSON endpoint (no SSO).
  - If public → build a small bespoke scraper → `data/ne/courses/nebraska-college-of-technical-agriculture/`; wire in `lib/states/ne/config.ts scrapers.courses`.
  - If login-walled / no public sections → add NCTA to `documentedCeilings.courseColleges` with the probe evidence.
- [ ] Re-run the collector for ne: courses A (9/9 or NCTA exempt), composite A.
- [ ] Pre-PR check: if built, load `/ne` and search an NCTA course.
- [ ] PR (branch `claude/ne-ncta`): plain-English first; state whether NCTA was built or ceilinged, with the probe result. DO NOT MERGE — stop for review.

Definition of done: NCTA either has real course data OR is a probe-verified documented ceiling; courses A; composite A.

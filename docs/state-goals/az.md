# Arizona (az) — state goals

> **Current tier: B** · Limited by: **courses** · _Refreshed 2026-06-22_
>
> Dimensions: `crs=B` `prq=A` `trf=A` `sc=A` `cfg=A`
>
> _95% course coverage (18/19). The single gap, Arizona Western, already has a wired Colleague scraper that only failed on a transient 502 — a re-run flips B→A. tohono-oodham is already a documented ceiling._

## Diagnosis

- **Primary gap:** courses 95% (18/19). The lone missing college, `arizona-western-college`, already has a wired Colleague scraper — it just didn't land data on the last run. Transfers (3 unis/31k), prereqs (clean), scorecard, config all A. (central-arizona-college, a prior gap, has since landed.)
- **Cheapest lever** (re-run a wired scraper): `scripts/az/scrape-colleague.ts` already declares AWC (host `colss-prod.ec.azwestern.edu`, documented in the file header). Last run hit a transient Ellucian-Cloud 502. Re-run; if the 502 persists, confirm the host resolves and retry — no new code.
- **Effort:** cheap — one re-run, no new scraper.
- **Course colleges:** 1 buildable (AWC, wired) / 0 blocked. `tohono-oodham-community-college` already in `documentedCeilings.courseColleges` (tribal Jenzabar behind login).
- **Programs / planner:** 0 program files — planner not GOLD (an A-tier extra, not gating).

## Goal checklist

### AZ — current tier B (limited only by courses; all other dims A)

- [ ] Pre-flight: `WT=$(scripts/new-pr-worktree.sh az-awc); cd "$WT"`.
- [ ] Re-run the wired Colleague scraper for Arizona Western: `npx tsx scripts/az/scrape-colleague.ts --college arizona-western-college` (host `colss-prod.ec.azwestern.edu`). Confirm sections land in `data/az/courses/arizona-western-college/`.
- [ ] If the host 502s again, verify it resolves (Ellucian-Cloud transient) and retry; do NOT substitute placeholder data.
- [ ] Re-run the collector for az: courses → A (19/19 with tohono-oodham exempt), composite → A.
- [ ] Pre-PR check: load `/az`, search an AWC course, confirm sections render with terms/credits.
- [ ] PR (branch `claude/az-awc`): plain-English first ("Arizona Western College now shows course sections on the site"). Stage only `data/az/courses/arizona-western-college/**`. DO NOT MERGE — stop for review.

Definition of done: AWC course data present; courses A (tohono-oodham documented ceiling); composite A.

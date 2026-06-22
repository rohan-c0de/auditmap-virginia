# Michigan (mi) — state goals

> **Current tier: B** · Limited by: **courses** · _Refreshed 2026-06-22_
>
> Dimensions: `crs=B` `prq=A` `trf=A` `sc=A` `cfg=A`
>
> _94% adjusted coverage (16/17); 14 tribal/blocked colleges are already documented ceilings. The one remaining real gap is Alpena, whose Colleague scraper is wired but returns 0 sections — a term-selector bug to debug. Fixing it flips B→A._

## Diagnosis

- **Primary gap:** courses 94% adjusted (16/17). The 14 blocked colleges (tribal/SSO/CAPTCHA/acalog) are recorded in `documentedCeilings.courseColleges`. The lone non-ceiling gap is `alpena-community-college`.
- **Cheapest lever** (debug a wired scraper): `scripts/mi/scrape-colleague.ts` declares alpena (host `acc-ss.colleague.elluciancloud.com`). `lib/states/mi/config.ts` explicitly notes alpena "responds 200 but the scraper finds 0 sections — a term-selector bug to debug (a deferred buildable), not a ceiling." Fix the term discovery for this tenant.
- **Effort:** low-medium — not a new scraper; a term-selector/term-code fix in the existing Colleague scraper. Compare alpena's term-selector markup against a working mi Colleague college.
- **Course colleges:** 1 buildable (alpena, wired but 0-section) / 14 documented ceilings.
- **Programs / planner:** 0 program files (A-tier extra only).

## Goal checklist

### MI — current tier B (limited only by courses; all other dims A)

- [ ] Pre-flight: `WT=$(scripts/new-pr-worktree.sh mi-alpena); cd "$WT"`.
- [ ] Reproduce: run `scripts/mi/scrape-colleague.ts` for alpena; confirm the host 200s but returns 0 sections.
- [ ] Debug the term query/selector for the `acc-ss.colleague.elluciancloud.com` tenant — compare against a working mi Colleague college's term handling; fix so the current term resolves.
- [ ] Land sections to `data/mi/courses/alpena-community-college/`.
- [ ] Re-run the collector for mi: courses → A (17/17 adjusted), composite → A.
- [ ] Pre-PR check: load `/mi`, search an Alpena course, confirm sections render.
- [ ] PR (branch `claude/mi-alpena`): plain-English first ("Alpena Community College now shows course sections"). Stage only the scraper fix + `data/mi/courses/alpena-community-college/**`. DO NOT MERGE — stop for review.

Definition of done: alpena course data present; courses A; composite A. The 14 documented ceilings stay as-is (not buildable).

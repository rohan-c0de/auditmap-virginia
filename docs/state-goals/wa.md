# Washington (wa) — state goals

> **Current tier: F** · Rank **#25 of 40** · Tranche: **NEXT** · Impact 5/5 · Effort: medium · Value/effort: **M**
>
> Dimensions: `crs=B` `prq=F` `trf=C` `sc=B` `cfg=A`
>
> _Big state, F only from prereqs WAF-blocked; rework the committed scraper to Playwright real-Chrome to beat AWS WAF (or ceiling-accept) -> off F._

## Diagnosis

- **Primary gap:** Prereqs F is the sole composite limiter: scrape-catalog-prereqs.ts is committed+correct but all 11 acalog catalogs return AWS WAF bot challenges (HTTP 202 x-amzn-waf-action) on the plain fetch() it uses, so no data/wa/prereqs.json exists and ctcLink exposes no inline prereq text. Courses healthy (33/34), transfers wired but thin (UW only).
- **Cheapest lever** (build-prereqs): Rework scripts/wa/scrape-catalog-prereqs.ts from fetch() to Playwright real-Chrome (stealth) to clear the AWS WAF challenge across the 11 acalog catalogs, producing data/wa/prereqs.json — lifts prereqs F→pass and the composite off F.
- **Effort:** medium — The prereq scraper logic (catoid/navoid per catalog, prereq-block extraction, merge) is already written and committed; the only blocker is the headless fetch() tripping AWS WAF. Converting it to a Playwright/real-Chrome stealth pass to clear the challenge is a focused 1-4hr scraper job, not a from-scratch build. If WAF proves unbeatable, demote to cheap (record a documented prereqs ceiling so composite stops being F).
- **Course colleges:** 0 buildable / 1 blocked (of the missing set)
- **Programs / planner:** 0 program files · no programs · planner-ready: no
- **Shippable (B+) bar met:** no

> Notes: The 1 missing course college, Northwest Indian College, is a tribal college outside SBCTC (not on ctcLink), served via a WordPress site — genuinely blocked and low-value; 33/34 = B is already at ceiling. Transfers are wired with 37,902 UW mappings (C, thin: 1 university); a cheap+ lever is adding a 2nd receiver (WSU/Western/Central/Evergreen) via the same wpId-table pattern in scrape-transfer-uw.ts to reach B. Prereqs WAF blocker is documented in lib/states/wa/config.ts but NOT recorded in audit documentedCeilings, so the audit treats it as a true F. Config A, scorecard B (33/34). No programs (Phase 5+ deferred), so plannerReady=no.

## Goal checklist

### WA — current tier F (limited by prereqs)

- [ ] **Beat the WAF on prereqs (composite lever).** Convert `scripts/wa/scrape-catalog-prereqs.ts` from plain `fetch()` to a Playwright real-Chrome/stealth pass (the 11 acalog catalogs at bellevue/centralia/ghc/greenriver/highline/olympic/pierce/shoreline/skagit/nscc/sfcc return HTTP 202 `x-amzn-waf-action: challenge`). Extraction/catoid/navoid logic already exists — only the transport changes. Run it, commit `data/wa/prereqs.json`, flip `prereqs` in `lib/states/wa/config.ts` off `aggregate-from-courses` to the catalog scraper.
- [ ] **If WAF is unbeatable, record the ceiling instead (cheap fallback).** Add prereqs to `documentedCeilings` so the composite stops being dragged to F by an accepted, documented blocker.
- [ ] **Transfers C→B (optional, medium).** Add a 2nd university receiver (WSU / Western / Central / Evergreen) to `scripts/wa/scrape-transfer-uw.ts` using the existing `wpId`/`wpSlug` table pattern; declare in config scrapers.
- [ ] **Leave Northwest Indian College as-is (blocked).** Tribal college outside SBCTC, WordPress-only, not on ctcLink — low value; 33/34 courses is the practical ceiling.
- [ ] Programs are Phase 5+ — skip for B+ finish.

**Definition of done:** `data/wa/prereqs.json` populated (or prereqs documented as a WAF ceiling), composite off F, courses/transfers/config/scorecard unchanged or improved.

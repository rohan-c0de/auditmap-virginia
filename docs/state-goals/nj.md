# New Jersey (nj) — state goals

> **Current tier: C** · Rank **#14 of 40** · Tranche: **NOW** · Impact 5/5 · Effort: cheap · Value/effort: **H**
>
> Dimensions: `crs=C` `prq=A` `trf=A` `sc=A` `cfg=A`
>
> _Big state; re-run wired colleague for camden+ocean (fix ocean's bare base URL) -> 89%, then document the 3 Jenzabar/custom colleges as ceiling._

## Diagnosis

- **Primary gap:** 5 of 18 colleges lack course data (78%); but camden+ocean are Colleague guest-scrapeable and ALREADY in scripts/nj/scrape-colleague.ts's college list yet produced no output — they just need a re-run/URL fix. salem (custom, no endpoint) + sussex/warren (Jenzabar .jnz portal forms, no public course search) are blocked. Transfers/prereqs/config all A.
- **Cheapest lever** (wire-existing-scraper): Re-run scripts/nj/scrape-colleague.ts for camden and ocean (already wired); diagnose/fix ocean's base URL (bare https://ocean.edu likely needs a selfservice. Ellucian host) — lifts courses C→B at ~89% coverage.
- **Effort:** cheap — camden + ocean are already declared in COLLEAGUE_COLLEGES (scrape-colleague.ts lines 38, 47) with Colleague /Student/Courses guest endpoints but have no data dir — re-running the existing scraper (fixing ocean's bare ocean.edu base URL, likely needs selfservice. subdomain) is well under an hour and lifts courses 78%→89% (C→B). No new scraper code needed.
- **Course colleges:** 2 buildable / 3 blocked (of the missing set)
- **Programs / planner:** 1 program files · aligned ✅ · planner-ready: partial
- **Shippable (B+) bar met:** no

> Notes: camden+ocean already in scrape-colleague.ts COLLEAGUE_COLLEGES (lines 38,47) but no data/nj/courses/{camden,ocean}/ dir exists → scrape returned 0 sections (gated or wrong host). ocean base URL is bare https://ocean.edu (no selfservice. subdomain, no elluciancloud host) — most likely the failure; camden uses selfservice.camdencc.edu. salem=custom/no courseSearchUrl/low-confidence (blocked); sussex=my.sussex.edu .jnz ICS Admissions portlet, warren=mywarren ICS Admissions — both Jenzabar portal/forms, not public course search (blocked). With camden+ocean fixed → 16/18 = 89%, one shy of the 90% bar; the remaining 3 are a genuine Jenzabar/custom ceiling. Programs: only bergen.json (111 programs, college_slug=bergen, aligned); other 17 colleges have no programs so full planner is data-limited, not misalignment.

## Goal checklist

### NJ — current tier C (limited by courses; transfers/prereqs/config all A)

- [ ] Re-run the EXISTING colleague scraper for the two already-wired-but-empty colleges: `tsx scripts/nj/scrape-colleague.ts --college camden` and `--college ocean`. Both are in COLLEAGUE_COLLEGES (lines 38, 47) but have no `data/nj/courses/{slug}/` dir.
- [ ] Fix ocean's base URL: line 47 is bare `https://ocean.edu` (no `selfservice.` host). Probe `selfservice.ocean.edu/Student/Courses` and `ocean-ss.colleague.elluciancloud.com`; update the map, re-scrape. This is the likely 0-section cause.
- [ ] If camden also returns 0, confirm guest access at `selfservice.camdencc.edu/Student/Courses?guestUser=true`; the scraper already falls back to guestUser=true.
- [ ] Commit new course data → courses 14/18 → 16/18 = 89% ≈ B tier.
- [ ] Document the ceiling for the remaining 3: salem (custom, no public course search), sussex + warren (Jenzabar `.jnz` ICS Admissions portal forms, no public catalog). Add them to documentedCeilings.courseColleges so 89% counts as the shippable ceiling.
- [ ] (GOLD, optional) Programs: only `data/nj/programs/bergen.json` exists (111 programs, aligned). Extend `scripts/nj/scrape-programs.ts` to other colleges with Acalog catalogs to widen planner coverage.

Definition of done: camden+ocean course data committed (courses ≥89%, B), the 3 Jenzabar/custom colleges recorded as documented ceilings, transfers/prereqs/config remain A.

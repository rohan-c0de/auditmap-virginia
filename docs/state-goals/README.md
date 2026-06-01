# State goals — finish-line plan

_Generated 2026-06-01 from the canonical `/state-audit` collector (`.claude/skills/state-audit/scripts/collect-audit-data.ts`) plus a 40-agent effort/lever diagnosis workflow. Grades respect `documentedCeilings`._

**How to use:** open `{slug}.md` for any unfinished state and paste its **Goal checklist** into a fresh Claude session — each is written to be actionable cold. Tick states off the tracker below as they cross the line. Re-run the collector to regenerate `_audit-snapshot.json` and re-grade.

> ⚠️ **Registration ≠ data completeness.** All 50 states + DC are in the registry; this plan is about raising the *data quality* of the 40 that aren't yet A-tier.

## Tier distribution (51 states)

| Tier | Count | States |
|------|-------|--------|
| A | 11 | al, ct, de, ga, hi, ky, me, nv, sc, tn, ut |
| B | 7 | co, dc, fl, la, mn, nh, ri |
| C | 17 | ar, az, ca, il, ma, md, mi, mo, mt, nc, nd, nj, nm, or, pa, tx, vt |
| D | 6 | ia, ny, oh, sd, va, wv |
| F | 10 | ak, id, in, ks, ms, ne, ok, wa, wi, wy |

**Done (A-tier, 11):** al, ct, de, ga, hi, ky, me, nv, sc, tn, ut

## 🎯 The single biggest lever

**Run one batched 'documented-ceiling' audit pass that records each state's genuinely-unbuildable colleges (tribal/SSO/auth-gated) and complete-but-thin transfer sets as documentedCeilings, so the auditor stops penalizing fixed structural limits as open gaps. This is a config/audit-source edit plus an audit re-run per state — no scraping. It applies the already-accepted CO/DC/NH pattern uniformly to the ~12 states sitting below their true ceiling only because the ceiling was never recorded.**

- **Category:** `documented-ceiling-accept`
- **States affected:** mt, mn, la, pa, ak, ma, ar, id, wy, tx, or, wv
- **Estimated states moved up a tier:** ~8
- **Why:** Across the set, the single most common reason a state sits below its achievable tier is that its hard structural limits (independent tribal colleges with no public SIS, SSO/SAML/Workday-gated registration, thin-but-complete transfer coverage) are real ceilings that the audit's documentedCeilings list does not yet contain — so coverage % is computed against a denominator the state can never reach. mt, mn, la, ak each flip essentially straight to A/B+ from this alone (mt 60%->effective 100%, mn 93%->A, la 92%->A, ak F->B+). pa and ma stop being graded as fixable-C and read at their true B+ ceiling. ar/tx/or/wv get their unbuildable colleges excused so the remaining cheap course wins actually clear the bar. id/wy flip off F the moment transfers are accepted as a no-portal ceiling. It is the lowest cost-per-tier action because it is pure metadata, batchable in one PR, and the rationale already exists in each state's config comments and scraper headers — it just needs to be recorded where the auditor reads it.

> ⚖️ **Honest caveat:** the biggest lever is a *re-grading* move — recording genuine structural ceilings (tribal colleges with no public SIS, SSO/Workday-gated registration, complete-but-thin transfers) so the audit stops penalizing unreachable denominators. It does **not** add student-facing data; it makes the grades reflect reality. The *data* wins live in the secondary levers below.

## Secondary levers (batchable, real data gains)

- **Re-run the already-wired-but-empty course scrapers across states where the scraper host map already contains the college but no data landed (transient 502 / wrong subdomain / term-resolution). Pure re-run + occasional host fix, zero new code. Cheapest course-coverage gains in the set.**
  _states: md, az, nj, ny, oh, tx, ia, ks, fl_
- **Wire/build a single statewide articulation scraper for the 'transfers-buildable' states whose composite is F only because transfer-equiv.json is empty but a public state portal exists (TransferIN/in.gov, Transfer Nebraska, OCEP VITA Oklahoma). One source per state, ~1-4hr each, flips F->A/B. Distinct from the no-portal states (ak/id/wy) which take the ceiling path instead.**
  _states: in, ne, ok_
- **Re-land the orphaned MS program-alignment commit e4134a06 (#964) — a squash-merge race left 252 MS programs on disk with short-slug filenames the planner can't resolve. Pure data rename + internal college_slug fix, no scrape, unlocks 4 plannable colleges. Audit other states for the same filename != institutions.college_slug pattern while touching it.**
  _states: ms_
- **Convert two prereq blockers that are pure cleanup/transport fixes: NC's 8 HTML-contaminated prereq entries (regex strip <br>, re-extract codes, C->A) and WA's prereq scraper switching from fetch() to Playwright real-Chrome to beat the AWS WAF challenge (F->pass). Both lift composite with no new data model work.**
  _states: nc, wa_

## Fastest realistic path

The fastest realistic path is to front-load two near-zero-cost batches before any new scraping. First, a single 'documented-ceiling' audit pass that records each state's genuinely-unbuildable colleges (tribal/SSO/Workday/SAML) and complete-but-thin transfer sets as ceilings — this alone moves roughly 8 states (mt, mn, la, ak, plus pa/ma/ar/or reading at their true tier) without touching a scraper, because they are penalized only for a denominator they can never reach. Second, a re-run/host-fix sweep of the ~9 states whose course scrapers are already wired but produced no data (md, az, nj, ny, oh, tx, ia, ks, fl), plus VA's config-only transfer-cron wire (an outright D->A) and MS's orphaned-program-commit re-land. Of the 40, roughly 18-20 are cheap wins (ceiling-accepts, re-runs, regex/config edits, one-scraper portal builds for in/ne/ok), and about 8-10 are genuine medium builds (ca/mi/mo/nm/wa course or articulation scrapers). The hard slog tail is ~6 states — wi (12 bespoke WTCS scrapers), il/ma (mostly SSO-blocked), ia, ks transfers — where the 90% bar is structurally out of reach and the right move is to build the cheap wins and ceiling-document the rest so they ship at B/B+ rather than chase unwinnable coverage. Prioritize the big-reach cheap states (VA, NC, FL, AZ, NJ, NY-partial) in the 'now' tranche for maximum student impact per hour.

## Impact ÷ effort ranking (all 40 unfinished)

| # | State | Name | Tier | Impact | Effort | V/E | Tranche | Rationale |
|---|-------|------|------|--------|--------|-----|---------|-----------|
| 1 | [va](va.md) | Virginia | D | 5 | cheap | H | now | Big state, all 5 dims A-grade data already on disk; D only because robust 8-univ/15,483-row transfer scrapers aren't declared in config — a one-edit cron wire flips D->A. |
| 2 | [md](md.md) | Maryland | C | 4 | cheap | H | now | All dims A except courses 81%; the 3 missing colleges (ccbc/cecil/garrett) already have wired scrapers that just need a re-run -> 16/16, no new code. |
| 3 | [nc](nc.md) | North Carolina | C | 5 | cheap | H | now | Huge state one regex pass from B+: 8 prereq entries have raw <br> + empty courses[]; strip and re-extract -> prereqs C->A, courses/transfers already A. |
| 4 | [az](az.md) | Arizona | C | 5 | cheap | H | now | Large state; AWC re-run (transient 502) + central-AZ coursedog lands courses ~95% with tohono-oodham as documented ceiling -> composite A-/A. |
| 5 | [ak](ak.md) | Alaska | F | 1 | cheap | H | now | Single tribal college; F only because no-portal transfers isn't recorded as a ceiling — a metadata edit flips F->B+/A with everything else already A/B. |
| 6 | [la](la.md) | Louisiana | B | 3 | cheap | H | now | Everything built/wired incl 5 aligned programs; record northshore (LoLA SSO) as a courses ceiling and 92% becomes A -> composite A. |
| 7 | [mn](mn.md) | Minnesota | B | 3 | cheap | H | now | 26/28 courses, all else A, planner-ready; document the 2 independent tribal colleges as ceilings -> courses A, composite A. No scraping. |
| 8 | [mt](mt.md) | Montana | C | 2 | cheap | H | now | All dims A except courses 60%; the 4 missing are tribal/auth-gated ceilings — recording them lifts courses 60%->effective 100%, composite C->A. |
| 9 | [ms](ms.md) | Mississippi | F | 3 | cheap | H | now | Re-land orphaned #964 (252 programs, pure rename) for an instant planner GOLD win; courses 7% is a separate medium slog, so do the cheap data fix now. |
| 10 | [ri](ri.md) | Rhode Island | B | 1 | cheap | H | now | Single-college state, fully built; transfers B is a hard ceiling (both RI public unis mapped) — annotate ceiling + re-run, done. |
| 11 | [dc](dc.md) | DC | B | 1 | cheap | H | now | Single college, all dims A except transfers which is an in-state-rule ceiling (no in-jurisdiction receiver) — already at finish line, just confirm ceiling. |
| 12 | [co](co.md) | Colorado | B | 3 | medium | M | now | Shippable bar met (courses/prereqs/config/scorecard A, transfers documented ceiling); only GOLD programs remain (curate catalog configs) — accept as B or pursue planner. |
| 13 | [fl](fl.md) | Florida | B | 5 | cheap | H | now | Huge state already at 93%; wire fscj's on-disk 2,963-course catalog + document pensacolastate Workday ceiling -> courses A, composite A. |
| 14 | [nj](nj.md) | New Jersey | C | 5 | cheap | H | now | Big state; re-run wired colleague for camden+ocean (fix ocean's bare base URL) -> 89%, then document the 3 Jenzabar/custom colleges as ceiling. |
| 15 | [nh](nh.md) | New Hampshire | B | 2 | cheap | M | now | Already shippable; transfers a hard ceiling (UNH/Plymouth no public DB, Keene wired). Accept; optional nashuacc programs for 7/7 planner. |
| 16 | [pa](pa.md) | Pennsylvania | C | 5 | cheap | M | next | Large state; 5 missing colleges all Workday/SAML/custom-blocked per scraper headers — record as ceilings so composite reads at true B+ (no buildable course wins). |
| 17 | [in](in.md) | Indiana | F | 3 | medium | H | next | Single-college (Ivy Tech), all dims A except empty transfers; build one TransferIN/Core Transfer Library scraper (portal exists) -> F->A. |
| 18 | [ne](ne.md) | Nebraska | F | 2 | medium | H | next | Courses B, all else A; F is empty transfers only — one Transfer Nebraska scraper (portal exists) flips F->B/A. |
| 19 | [ok](ok.md) | Oklahoma | F | 3 | medium | M | next | Implement the OCEP/VITA transfer scraper (currently a stub) to flip composite off F; courses 7/13 needs ~4 template scrapers as a follow-on. |
| 20 | [ar](ar.md) | Arkansas | C | 2 | medium | M | next | All dims A except courses 12/14; build 2 bespoke scrapers (ANC, SouthArk) after a quick SIS probe, adapting existing AR colleague/Jenzabar templates -> A. |
| 21 | [tx](tx.md) | Texas | C | 5 | medium | M | next | Largest state but courses 90% unreachable; re-run 3 wired colleges (galveston/southmost/north-central) then document the 19 SSO/custom as ceiling -> shippable B+. |
| 22 | [wy](wy.md) | Wyoming | F | 1 | medium | M | next | F is empty transfers; investigate WCCC matrix or accept no-portal ceiling (cheap) + record central-wyoming SAML course ceiling -> composite B. |
| 23 | [id](id.md) | Idaho | F | 2 | medium | M | next | Accept no-portal transfers ceiling (10-min, flips off F) then build/ceiling CSI's Campus-Management-Corp course gap to clear 90%. |
| 24 | [vt](vt.md) | Vermont | C | 1 | medium | M | next | Single college, every dim A except transfers thin (UVM only); add VTSU as 2nd receiver or accept ceiling -> C->B, otherwise maxed. |
| 25 | [wa](wa.md) | Washington | F | 5 | medium | M | next | Big state, F only from prereqs WAF-blocked; rework the committed scraper to Playwright real-Chrome to beat AWS WAF (or ceiling-accept) -> off F. |
| 26 | [ny](ny.md) | New York | D | 5 | medium | M | next | Huge state; re-run 5 wired Banner hosts (49%->62%) + strip 250 HTML prereqs (C->A), then ceiling the 13 no-SIS colleges -> D->C/B. |
| 27 | [ks](ks.md) | Kansas | F | 3 | hard | M | next | Cheap config + re-run 5 wired colleges lifts courses to ~75%, but F is binding transfers with no portal — hard investigation or ceiling needed to clear F. |
| 28 | [oh](oh.md) | Ohio | D | 5 | medium | M | next | Large state; re-run 2 wired hosts + 1 Jenzabar -> ~55%, add 2nd transfer receiver (OTM/TAG); 8 custom colleges + 90% bar make full A a hard tail. |
| 29 | [ca](ca.md) | California | C | 5 | medium | M | next | Highest student reach; ~9 detected colleges wire into existing templates (65%->85%) but the 90% bar needs ~27 custom re-fingerprints — biggest partial win, not a clean finish. |
| 30 | [mi](mi.md) | Michigan | C | 5 | medium | M | next | Big state; build one Coursedog scraper (henry-ford+lake-michigan) + alpena re-run, then ceiling the 12 blocked — realistic cap ~61%, document the rest. |
| 31 | [nm](nm.md) | New Mexico | C | 2 | medium | M | later | All else A; wire ruidoso coursedog (on-disk) then re-fingerprint clovis/luna/nmmi/mesalands — needs investigation + 1-2 scrapers to clear 90%. |
| 32 | [nd](nd.md) | North Dakota | C | 1 | medium | M | later | Add CCCC+NHSC institution codes to the wired NDUS PS scraper (verified public) + ceiling Sitting Bull -> 7/7 courses, but PS endpoint is flaky. |
| 33 | [sd](sd.md) | South Dakota | D | 1 | medium | M | later | seniorWaiver config fix + transform on-disk Mitchell coursedog dump + ceiling 3 PDF/no-catalog colleges; 2nd transfer receiver optional -> D->C/B. |
| 34 | [mo](mo.md) | Missouri | C | 3 | medium | M | later | Fingerprint + build SLCC (largest, un-probed) + 2 others, ceiling 2 SSO colleges -> 11/11 buildable clears 90%; investigation-gated. |
| 35 | [ma](ma.md) | Massachusetts | C | 5 | hard | M | later | Big state, programs 15/15 aligned; probe massbay PeopleSoft (1 win) then document 6 SAML/auth-gated colleges as ceilings -> courses no longer caps, composite B. |
| 36 | [wv](wv.md) | West Virginia | D | 2 | medium | M | later | Document 5 SSO/SAML/WAF colleges as ceilings + build 1 Colleague guest scraper (southern) -> 4/4 reachable covered, composite D->B. |
| 37 | [or](or.md) | Oregon | C | 4 | medium | L | later | Courses a hard ceiling (all 8 missing SSO/staff-portal); document them, then the real mover is adding a 2nd transfer receiver (PSU/UO) for C->B. |
| 38 | [il](il.md) | Illinois | C | 5 | hard | L | later | Large state but most of 19 missing colleges are Jenzabar/SSO/custom-blocked; only elgin re-run is cheap — 90% unreachable, ceiling-document to ship at B. |
| 39 | [ia](ia.md) | Iowa | D | 2 | medium | L | later | Courses 31%; 6 template-buildable (re-run colleague + wire Jenzabar/Banner) reaches ~69%, but 5 custom/unknown need fresh fingerprints to clear 90%. |
| 40 | [wi](wi.md) | Wisconsin | F | 4 | hard | L | later | F from prereqs (cheap aggregate fix), but courses 25% with 12 WTCS singletons each on a distinct custom platform (0 clusters) = a ~12-scraper greenfield slog. |

## Progress tracker

### NOW — cheap, high-impact (do first)
- [x] **va** (D→**A**) — Virginia: ✅ DONE — wired the 8 external-portal transfer scrapers into `StateConfig.scrapers.transfers`; transfers D→A, composite **A**.
- [ ] **md** (C) — Maryland: All dims A except courses 81%; the 3 missing colleges (ccbc/cecil/garrett) already have wired scrapers that just need a re-run -> 16/16, no new code.
- [x] **nc** (C→**B**) — North Carolina: Huge state one regex pass from B+: 8 prereq entries have raw <br> + empty courses[]; strip and re-extract -> prereqs C->A, courses/transfers already A.
- [ ] **az** (C) — Arizona: Large state; AWC re-run (transient 502) + central-AZ coursedog lands courses ~95% with tohono-oodham as documented ceiling -> composite A-/A.
- [x] **ak** (F→**B**) — Alaska: ✅ documented transfers ceiling (no AK articulation portal; single tribal college) → transfers F→B, composite B (at ceiling; remaining B is prereqs/config, data-limited)
- [ ] **la** (B) — Louisiana: Everything built/wired incl 5 aligned programs; record northshore (LoLA SSO) as a courses ceiling and 92% becomes A -> composite A.
- [ ] **mn** (B) — Minnesota: 26/28 courses, all else A, planner-ready; document the 2 independent tribal colleges as ceilings -> courses A, composite A. No scraping.
- [ ] **mt** (C) — Montana: All dims A except courses 60%; the 4 missing are tribal/auth-gated ceilings — recording them lifts courses 60%->effective 100%, composite C->A.
- [ ] **ms** (F) — Mississippi: Re-land orphaned #964 (252 programs, pure rename) for an instant planner GOLD win; courses 7% is a separate medium slog, so do the cheap data fix now.
- [ ] **ri** (B) — Rhode Island: Single-college state, fully built; transfers B is a hard ceiling (both RI public unis mapped) — annotate ceiling + re-run, done.
- [ ] **dc** (B) — DC: Single college, all dims A except transfers which is an in-state-rule ceiling (no in-jurisdiction receiver) — already at finish line, just confirm ceiling.
- [ ] **co** (B) — Colorado: Shippable bar met (courses/prereqs/config/scorecard A, transfers documented ceiling); only GOLD programs remain (curate catalog configs) — accept as B or pursue planner.
- [ ] **fl** (B) — Florida: Huge state already at 93%; wire fscj's on-disk 2,963-course catalog + document pensacolastate Workday ceiling -> courses A, composite A.
- [ ] **nj** (C) — New Jersey: Big state; re-run wired colleague for camden+ocean (fix ocean's bare base URL) -> 89%, then document the 3 Jenzabar/custom colleges as ceiling.
- [ ] **nh** (B) — New Hampshire: Already shippable; transfers a hard ceiling (UNH/Plymouth no public DB, Keene wired). Accept; optional nashuacc programs for 7/7 planner.

### NEXT — medium effort or lower reach
- [ ] **pa** (C) — Pennsylvania: Large state; 5 missing colleges all Workday/SAML/custom-blocked per scraper headers — record as ceilings so composite reads at true B+ (no buildable course wins).
- [ ] **in** (F) — Indiana: Single-college (Ivy Tech), all dims A except empty transfers; build one TransferIN/Core Transfer Library scraper (portal exists) -> F->A.
- [ ] **ne** (F) — Nebraska: Courses B, all else A; F is empty transfers only — one Transfer Nebraska scraper (portal exists) flips F->B/A.
- [ ] **ok** (F) — Oklahoma: Implement the OCEP/VITA transfer scraper (currently a stub) to flip composite off F; courses 7/13 needs ~4 template scrapers as a follow-on.
- [ ] **ar** (C) — Arkansas: All dims A except courses 12/14; build 2 bespoke scrapers (ANC, SouthArk) after a quick SIS probe, adapting existing AR colleague/Jenzabar templates -> A.
- [ ] **tx** (C) — Texas: Largest state but courses 90% unreachable; re-run 3 wired colleges (galveston/southmost/north-central) then document the 19 SSO/custom as ceiling -> shippable B+.
- [ ] **wy** (F) — Wyoming: F is empty transfers; investigate WCCC matrix or accept no-portal ceiling (cheap) + record central-wyoming SAML course ceiling -> composite B.
- [ ] **id** (F) — Idaho: Accept no-portal transfers ceiling (10-min, flips off F) then build/ceiling CSI's Campus-Management-Corp course gap to clear 90%.
- [ ] **vt** (C) — Vermont: Single college, every dim A except transfers thin (UVM only); add VTSU as 2nd receiver or accept ceiling -> C->B, otherwise maxed.
- [ ] **wa** (F) — Washington: Big state, F only from prereqs WAF-blocked; rework the committed scraper to Playwright real-Chrome to beat AWS WAF (or ceiling-accept) -> off F.
- [ ] **ny** (D) — New York: Huge state; re-run 5 wired Banner hosts (49%->62%) + strip 250 HTML prereqs (C->A), then ceiling the 13 no-SIS colleges -> D->C/B.
- [ ] **ks** (F) — Kansas: Cheap config + re-run 5 wired colleges lifts courses to ~75%, but F is binding transfers with no portal — hard investigation or ceiling needed to clear F.
- [ ] **oh** (D) — Ohio: Large state; re-run 2 wired hosts + 1 Jenzabar -> ~55%, add 2nd transfer receiver (OTM/TAG); 8 custom colleges + 90% bar make full A a hard tail.
- [ ] **ca** (C) — California: Highest student reach; ~9 detected colleges wire into existing templates (65%->85%) but the 90% bar needs ~27 custom re-fingerprints — biggest partial win, not a clean finish.
- [ ] **mi** (C) — Michigan: Big state; build one Coursedog scraper (henry-ford+lake-michigan) + alpena re-run, then ceiling the 12 blocked — realistic cap ~61%, document the rest.

### LATER — hard slog / structural ceilings
- [ ] **nm** (C) — New Mexico: All else A; wire ruidoso coursedog (on-disk) then re-fingerprint clovis/luna/nmmi/mesalands — needs investigation + 1-2 scrapers to clear 90%.
- [ ] **nd** (C) — North Dakota: Add CCCC+NHSC institution codes to the wired NDUS PS scraper (verified public) + ceiling Sitting Bull -> 7/7 courses, but PS endpoint is flaky.
- [ ] **sd** (D) — South Dakota: seniorWaiver config fix + transform on-disk Mitchell coursedog dump + ceiling 3 PDF/no-catalog colleges; 2nd transfer receiver optional -> D->C/B.
- [ ] **mo** (C) — Missouri: Fingerprint + build SLCC (largest, un-probed) + 2 others, ceiling 2 SSO colleges -> 11/11 buildable clears 90%; investigation-gated.
- [ ] **ma** (C) — Massachusetts: Big state, programs 15/15 aligned; probe massbay PeopleSoft (1 win) then document 6 SAML/auth-gated colleges as ceilings -> courses no longer caps, composite B.
- [ ] **wv** (D) — West Virginia: Document 5 SSO/SAML/WAF colleges as ceilings + build 1 Colleague guest scraper (southern) -> 4/4 reachable covered, composite D->B.
- [ ] **or** (C) — Oregon: Courses a hard ceiling (all 8 missing SSO/staff-portal); document them, then the real mover is adding a 2nd transfer receiver (PSU/UO) for C->B.
- [ ] **il** (C) — Illinois: Large state but most of 19 missing colleges are Jenzabar/SSO/custom-blocked; only elgin re-run is cheap — 90% unreachable, ceiling-document to ship at B.
- [ ] **ia** (D) — Iowa: Courses 31%; 6 template-buildable (re-run colleague + wire Jenzabar/Banner) reaches ~69%, but 5 custom/unknown need fresh fingerprints to clear 90%.
- [ ] **wi** (F) — Wisconsin: F from prereqs (cheap aggregate fix), but courses 25% with 12 WTCS singletons each on a distinct custom platform (0 clusters) = a ~12-scraper greenfield slog.

### ✅ Done (A-tier)
- [x] **al** — Alabama
- [x] **ct** — Connecticut
- [x] **de** — Delaware
- [x] **ga** — Georgia
- [x] **hi** — Hawaii
- [x] **ky** — Kentucky
- [x] **me** — Maine
- [x] **nv** — Nevada
- [x] **sc** — South Carolina
- [x] **tn** — Tennessee
- [x] **ut** — Utah

# New York (ny) — state goals

> **Current tier: D** · Rank **#26 of 40** · Tranche: **NEXT** · Impact 5/5 · Effort: medium · Value/effort: **M**
>
> Dimensions: `crs=D` `prq=C` `trf=A` `sc=C` `cfg=A`
>
> _Huge state; re-run 5 wired Banner hosts (49%->62%) + strip 250 HTML prereqs (C->A), then ceiling the 13 no-SIS colleges -> D->C/B._

## Diagnosis

- **Primary gap:** 19 of 37 colleges have no course-section data (49% coverage); transfers (A, 254K mappings/36 unis) and config (A) are healthy. Of the 19 missing, only 5 are cheaply buildable (wired Banner SSB hosts that failed last scrape); the other 14 lack a public course-section SIS (Acalog/OmniUpdate program-catalogs, PDF-only, or auth-gated).
- **Cheapest lever** (wire-existing-scraper): Re-run the already-wired scripts/ny/scrape-suny-banner-ssb.ts for the 5 declared-but-failed hosts (jefferson-cc, suny-broome-cc, suny-ulster, monroe-cc, nassau-cc) — suny-broome smoke-tested 1,205 live sections; this adds 5 colleges (49%->62%) with zero new code.
- **Effort:** medium — Cheapest wins are an hour or less (re-run the already-wired scrape-suny-banner-ssb.ts for 5 failed hosts; regex-strip 250 HTML-contaminated prereq entries). But reaching the courses >=90% bar is hard: 13-14 colleges have no public course-section endpoint documented in-repo (Acalog/OmniUpdate are program catalogs with no live sections; FMCC/Schenectady/Sullivan PDF-only; tompkins auth-gated), so a true B+ on courses needs many bespoke or auth scrapers. Medium = one re-run + one regex pass lifts composite D->C without clearing the course ceiling.
- **Course colleges:** 5 buildable / 14 blocked (of the missing set)
- **Programs / planner:** 21 program files · aligned ✅ · planner-ready: partial
- **Shippable (B+) bar met:** no

> Notes: Course DATA (sections) for NY comes only from Banner SSB (scrape-suny-banner-ssb.ts) + Colleague (scrape-suny-colleague.ts) + CUNY (scrape-cuny.ts, 7 cols) + bespoke cayuga/herkimer. The _suny-catalog-fingerprint.md table documents PROGRAM catalogs (Acalog/OmniUpdate/SmartCatalog/PDF), NOT live section search — so Acalog colleges (erie, suny-orange, suny-niagara, hudson-valley, westchester, etc.) have programs/prereqs but no section feed. 5 missing colleges have wired Banner hosts that failed last run (term-resolution/WAF), the cheapest fix. tompkins-cortland-cc Colleague host declared but /Student/Courses 404s unauth (DEFERRED, auth flow). north-country banner.nccc.edu = NTLM-gated (blocked). FMCC/Schenectady/Sullivan PDF-only. Prereqs C: 250 CUNY Coursedog entries carry raw <p>/<a> curriculum-committee HTML blobs — pure regex/strip cleanup. Programs 21/21 filenames already aligned to college_slug (no misalignment bug). Transfers + config both A.

## Goal checklist

### NY — current tier D (limited by courses; transfers A, config A)

- [ ] Re-run wired Banner SSB for the 5 declared-but-failed hosts: `npx tsx scripts/ny/scrape-suny-banner-ssb.ts` (jefferson-cc, suny-broome-cc, suny-ulster, monroe-cc, nassau-cc). suny-broome smoke-tested 1,205 live sections; likely term-resolution/WAF. Per-college: `--college suny-broome-cc`. Lands +5 colleges → 23/37 (62%). Courses D→C.
- [ ] Clean prereq HTML contamination: 250 entries in `data/ny/prereqs.json` carry raw `<p>`/`<a>` CUNY Coursedog narrative. Add a strip-HTML + drop-narrative-blob pass to `scripts/ny/scrape-catalog-prereqs.ts` (or a one-off sanitizer) and re-emit. Prereqs C→A.
- [ ] tompkins-cortland-cc: Colleague host declared in `scrape-suny-colleague.ts` but `/Student/Courses` 404s unauth — build Playwright login flow if pursued (DEFERRED; medium).
- [ ] Remaining 13 missing colleges (erie, suny-orange, suny-niagara, hudson-valley, westchester, clinton, genesee, mvcc, fmcc, jamestown, suny-sullivan, north-country, fit): no public course-section SIS in-repo — only program catalogs (Acalog/OmniUpdate) / PDF / NTLM. Document as a course ceiling OR investigate each for a Banner/Colleague/CollegeScheduler endpoint (hard, per-college).
- [ ] (Gold) Extend programs beyond 21/37 to lift planner readiness.

Definition of done: courses ≥90% of non-ceiling colleges OR a written course ceiling for the 13-14 no-SIS colleges; prereqs HTML-clean; transfers+config stay A.

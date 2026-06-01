# North Carolina (nc) — state goals

> **Current tier: C** · Rank **#3 of 40** · Tranche: **NOW** · Impact 5/5 · Effort: cheap · Value/effort: **H**
>
> Dimensions: `crs=B` `prq=C` `trf=A` `sc=A` `cfg=A`
>
> _Huge state one regex pass from B+: 8 prereq entries have raw <br> + empty courses[]; strip and re-extract -> prereqs C->A, courses/transfers already A._

## Diagnosis

- **Primary gap:** Prereqs dim is C: 8 of ~hundreds of entries have raw <br> HTML in their text field and empty courses[] (parser never extracted codes). All other dims pass: courses B (58/58 covered, 0 missing), transfers A (20 universities / 25,687 mappings / wired), config A, scorecard A. No programs data (Acalog scraper unwired) — A-tier extra only.
- **Cheapest lever** (clean-prereqs): Run a regex cleanup over the 8 contaminated entries in data/nc/prereqs.json (BTB 103, EDU 234A, MRN 121, MSC 256, PHM 120, PHM 136, VET 220, WBL 115U): strip <br>, split on the "Take ... - Must be..." clauses, and populate courses[] from the XXX-NNN codes. Lifts prereqs C→A and composite to B+.
- **Effort:** cheap — The only defect is 8 prereq entries in data/nc/prereqs.json contaminated solely by ",<br>" separators between "Take XXX-NNN - Must be..." clauses, with empty courses[]. A regex pass to strip <br>, split clauses, and re-extract course codes is well under an hour and lifts prereqs C→A.
- **Course colleges:** 0 buildable / 0 blocked (of the missing set)
- **Programs / planner:** 0 program files · no programs · planner-ready: no
- **Shippable (B+) bar met:** no

> Notes: Prereqs.json structure: {courseCode: {text, courses[]}}. The 8 contaminated entries all have empty courses[], so fixing them both de-contaminates display and recovers lost prereq edges for the planner. courses.missing[] is empty — no course scrapers needed. Transfers already excellent (20 in-state university receivers, cron-wired). Programs: data/nc/programs/ does not exist; manualOnly flags "Acalog program scraper not yet wired up" — building it is the only path to GOLD/A planner tier but is a separate medium effort, not required for shippable.

## Goal checklist

### NC — current tier C (limited by prereqs)

- [ ] Clean the 8 HTML-contaminated entries in `data/nc/prereqs.json`: `BTB 103`, `EDU 234A`, `MRN 121`, `MSC 256`, `PHM 120`, `PHM 136`, `VET 220`, `WBL 115U`. Each has raw `,<br>` joining "Take XXX-NNN - Must be..." clauses and an empty `courses[]`. Strip `<br>`, split clauses, and re-extract course codes (normalize `XXX-NNN`→`XXX NNN`) into `courses[]`. This lifts prereqs C→A and composite to B+. (cheap, <1hr)
- [ ] Re-run `/state-audit nc` (or the scorecard) to confirm prereqs no longer reports "HTML contamination" and composite rises.
- [ ] (A-tier extra, optional) Wire an Acalog program scraper for NC into `scripts/nc/` + `StateConfig.scrapers`, output to `data/nc/programs/<college_slug>.json` with filenames aligned to `institutions.json` `college_slug` so the degree-path planner can see them. Medium effort; not required for shippable.

Definition of done: prereqs dim is A (no HTML contamination, contaminated entries' `courses[]` populated), courses/transfers/config/scorecard remain A/B, and the audit composite is B+ or better.

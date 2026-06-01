# Nebraska (ne) — state goals

> **Current tier: F** · Rank **#18 of 40** · Tranche: **NEXT** · Impact 2/5 · Effort: medium · Value/effort: **H**
>
> Dimensions: `crs=B` `prq=A` `trf=F` `sc=A` `cfg=A`
>
> _Courses B, all else A; F is empty transfers only — one Transfer Nebraska scraper (portal exists) flips F->B/A._

## Diagnosis

- **Primary gap:** Transfers is the sole blocker: transfer-equiv.json is [] (0 mappings, 0 universities, unwired, no scraper, no documented ceiling) → drags composite to F. Courses B (8/9, only NCTA missing), prereqs A, config A, scorecard A all healthy; programs present and planner-aligned.
- **Cheapest lever** (investigate-articulation): Investigate Nebraska's statewide articulation portal (Transfer Nebraska, transfer.nebraska.edu), build scripts/ne/scrape-transfer.ts, populate data/ne/transfer-equiv.json, and declare transfers in lib/states/ne/config.ts scrapers — this alone lifts composite F→B.
- **Effort:** medium — One investigation + one scraper. NE's statewide articulation source (Transfer Nebraska / transfer.nebraska.edu, run by the state college + university system) is simply not registered — the audit's "no articulation portal" means unwired, not nonexistent. Building and wiring a transfers scraper is 1-4hr and flips the only failing dimension. NCTA course gap is trivial/low-value (already B).
- **Course colleges:** 1 buildable / 0 blocked (of the missing set)
- **Programs / planner:** 2 program files · aligned ✅ · planner-ready: yes
- **Shippable (B+) bar met:** no

> Notes: Courses already B (8/9); only NCTA (ncta.unl.edu, tiny UNL ag college, not in fingerprint-baseline) missing — buildable but low-value. Prereqs/config/scorecard all A. Programs: 2 files (southeast, western-nebraska), both filenames match institutions.json college_slug and internal college_slug — planner can see them. The single F is transfers (empty transfer-equiv.json, no ceiling). Fingerprint-baseline.json predates NE and has no NE entries, so SIS-platform judgment for missing college came from clusters.json (NCTA = singleton, ncta.unl.edu).

## Goal checklist

### NE — current tier F (limited by transfers)

- [ ] **Investigate articulation (cheapest high-value).** Check Nebraska's statewide transfer portal — Transfer Nebraska at transfer.nebraska.edu (NE state colleges + University of Nebraska system course-equivalency tool). Find a public/guest course-equivalency or API endpoint. If genuinely none exists publicly, document it as a transfers ceiling in `lib/states/ne/config.ts` and the audit ceiling list (accept-as-is) — that alone clears the composite blocker.
- [ ] **Build the scraper** `scripts/ne/scrape-transfer.ts` (model on `scripts/me/scrape-transfer-mainestreet.ts` or `scripts/ct/scrape-transfer-all.ts`). In-state targets only (UNL/UNO/UNK + Chadron/Peru/Wayne state colleges). Drop any cross-state rows.
- [ ] **Write** `data/ne/transfer-equiv.json` with non-trivial mappings (currently `[]`).
- [ ] **Wire cron**: add `transfers: [{ scripts: ["scripts/ne/scrape-transfer.ts"], runner: ... }]` to `scrapers` in `lib/states/ne/config.ts` (remove the `// manual-only: transfers` marker).
- [ ] **Verify** at `/ne/transfer`: pick a sending CC + course, confirm equivalency renders.
- [ ] (Optional, low value) NCTA course scraper (ncta.unl.edu, 1 college) to push courses 89%→100%; courses is already B so skip unless going for gold.

Definition of done: `/ne/transfer` shows real in-state equivalencies, transfers scraper cron-wired, composite ≥ B.

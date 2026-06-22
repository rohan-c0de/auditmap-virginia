# Montana (mt) — state goals

> **Current tier: B** · Limited by: **courses** · _Refreshed 2026-06-22_
>
> Dimensions: `crs=B` `prq=A` `trf=A` `sc=A` `cfg=A`
>
> _Three of the four tribal/auth-gated colleges are already documented ceilings; coverage is 89% (8/9). The single remaining gap, Fort Peck CC, is a deferred-buildable (Jenzabar auth-gated, but public PDF schedules exist) — its config author explicitly declined to call it a ceiling. NOT a cheap flip._

## Diagnosis

- **Primary gap:** courses 89% (8/9). Already-documented ceilings: aaniiih-nakoda, stone-child, highlands-college-of-montana-tech. The lone non-ceiling gap is `fort-peck-community-college`.
- **Disposition (honest):** `lib/states/mt/config.ts` marks fort-peck `DEFERRED-scrapers`: its interactive Jenzabar JICS (`fpcportal.jenzabarcloud.com`) is auth-gated, BUT term-by-term **PDF class schedules are public** on a Webflow CDN (linked from fpcc.edu). The author's note verbatim: "Needs a PDF extractor — distinct, larger effort. **NOT a ceiling (data is public), just deferred.**"
- **B is fair.** Two honest paths to A:
  1. **Accept B** — fort-peck is one tiny tribal college; B is honest. (recommended unless going for A)
  2. **Build a PDF extractor** — fetch the public term PDFs and parse sections → `data/mt/courses/fort-peck-community-college/`. A new capability (PDF parsing), medium effort. This is the only legitimate path to A — do NOT ceiling-document public data to game the grade.
- **Effort:** accept-B is free; the PDF extractor is a genuine medium build.
- **Course colleges:** 0 cleanly buildable / 1 deferred (fort-peck, PDF) / 3 documented ceilings.
- **Programs / planner:** manual-only (A-tier extra).

## Goal checklist

### MT — current tier B (limited only by courses; all other dims A)

- [ ] **Decide:** accept B (honest — fort-peck is tiny) OR build the PDF extractor for A.
- [ ] If building: pre-flight `WT=$(scripts/new-pr-worktree.sh mt-fortpeck); cd "$WT"`.
- [ ] Locate the public term-schedule PDFs (linked from fpcc.edu/academics; hosted on the Webflow CDN). Build a PDF→sections extractor (new capability) writing `data/mt/courses/fort-peck-community-college/`. Wire it in `lib/states/mt/config.ts scrapers.courses`, or mark `// manual-only:` with a reason if it can't be cron-stable.
- [ ] Do NOT add fort-peck to `documentedCeilings` — the config author already ruled it's not a ceiling (data is public).
- [ ] Re-run the collector for mt: courses A (9/9), composite A.
- [ ] PR (branch `claude/mt-fortpeck`): plain-English first; note the PDF-extraction mechanism. DO NOT MERGE — stop for review.

Definition of done: mt accepted at B (no change) OR fort-peck PDF sections landed + wired → courses A, composite A. No ceiling-gaming.

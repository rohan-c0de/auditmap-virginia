# Plan-to-Outcome journey — prototype README

**Open `journey.html` in any browser.** No server, no build. One self-contained file
(data + CSS + JS inlined). The selection lives in the URL hash, so reloading or sharing
the link restores exactly where you were.

## Current look & feel (this version)
- **On-brand visual design** matching communitycollegepath.com: **teal** accent (`teal-600`), slate/gray neutrals, white surfaces, the **Geist** typeface, and a consistent inline **line-icon** set (no emoji). **Light by default; a ☀️/🌙 toggle** switches to a fully-themed dark mode (every surface is variable-driven, so both are readable).
- **Plan step is card-based, not a line graph.** No connector lines — each course card shows its prerequisite inline ("take after ACCT 1100"). It **opens focused** ("classes you can take now") with a **"Show the full plan — all N semesters"** expander that reveals the semester-column view.
- **Simple interactions** (no mode toggle): tap a card to add it to your schedule; tap the ○ corner to mark a class you've already taken.
- **Login to save + personalize:** free to explore everything; signing in (mock in this prototype) is required to save completed-course progress and the personalized "next semester." No "saved on this device."
- Earlier passes' content (4-step flow, honesty rules, the app-wide invariant harness, all the bug fixes) still applies; the sections below are the running history.

## What it anchors on (all REAL data from the repo)
- **State / college / program:** Georgia · Atlanta Technical College · Accounting A.S. (67 cr)
- **Prereqs:** `data/ga/prereqs.json` (in-program edges → layered DAG)
- **Sections / seats / times:** `data/ga/courses/{atlanta,gwinnett,chattahoochee,albany}-tech/*.json`
- **Transfers:** `data/ga/transfer-equiv.json` (to West Georgia / Georgia State / UGA / Georgia Tech)
- **Outcomes:** `data/ga/scorecard/atlanta-tech.json` + `scorecard-programs/atlanta-tech.json`

## The journey (carry-forward linkage)
1. **Plan** — seat-colored prereq DAG. Click open courses → they enter a cart.
2. **Schedule** — the cart pre-fills a multi-college weekly grid; work hours blocked, full/conflicting sections dimmed.
3. **Transfer** — the planned courses → a chosen university; ✓ direct / ≈ elective / ✕ no-credit. University selector recomputes live.
4. **Outcomes** — earnings p25–median–p75, net-price-by-income (negative = aid exceeds cost), Pell vs non-Pell.

## Prompt fix-requirements that are demonstrated
- **Color de-collision:** seats use green/amber/red; transfer uses indigo/slate/red **plus ✓ ≈ ✕ icons** — never confusable.
- **One design system:** shared tokens, card shell, legend, footnotes across all 4 steps.
- **Honest empty states:** Pell/non-Pell at Atlanta Tech is federally suppressed → shows "Not enough graduates to report" rather than a fabricated number. West Georgia transfer <40% → a "heads up" warning.
- **Computed layout:** DAG levels are derived by topological ranking (not hand-placed); schedule grid uses real minute math.
- **Mobile:** the weekly grid degrades to a per-day list under 680px.
- **Carry-forward + URL state:** changing the program/cart in Step 1 re-derives Steps 2–4; state is shareable via the hash.

## Correctness fixes (post-critique)

Two bugs from the self-critique were fixed and verified in-browser:

1. **AND/OR prerequisites are now read from the real text, not guessed.** Previously *any*
   course with >1 prereq was drawn dashed, implying "choose one" — which falsely told a
   student that `ACCT 2120 ← ACCT 1100 AND ACCT 1105` was a choice. Now `prereqRelation()`
   inspects the connectors between the actual course tokens in `prereqs.json` text:
   - **solid** = all required (AND) — e.g. ACCT 2120
   - **dashed + "1 of N"** = genuine choice (OR) — e.g. BUSN 1440 (any 1 of 7)
   - **dotted + "⚠ verify"** = mixed/unparseable → shown neutrally with the exact rule on
     hover, never as a fabricated choice — e.g. ACCT 2100
   OR relationships also now level by *earliest* possible term (min+1), not latest.

2. **Online/async sections no longer vanish.** The grid filtered to `days && start`, which
   dropped **60% of sections (133 of 222, incl. all 91 online)** — the working-adult's most
   relevant option. Sections with no fixed time now appear in a dedicated **"Anytime" lane**,
   grouped by course, labeled "🖥 online · anytime", open-first, full dimmed.

## Second pass — the 6 remaining critique items + ideas (all verified in-browser)

3. **Real proportional Sankey (was fixed-width).** Transfer step now draws filled ribbons
   whose **width = credits**, across three columns (your plan → each course → outcome
   buckets). 40 ribbons, 18 distinct heights for the full Accounting program — you see the
   *magnitude* of what carries over, not just a tally.
4. **Fair transfer denominator.** Courses with no published mapping are pulled into their own
   "No transfer data" bucket and **excluded from the %** — e.g. "7 of 57 credits (12%) …
   · 10 cr have no data" instead of deflating the score by counting unknowns as failures.
5. **Earnings vs peers + state median.** The 10-year earnings chart now shows the anchor
   college against its top peers with a **dashed state-median reference line** (GA median
   $33,018); the anchor is highlighted. Context, not a lonely number — and it honestly shows
   Atlanta Tech sits *below* the state median.
6. **Credit-aware layout.** Columns are now packed to **~16 credits/term** (Sem 1: 16cr,
   Sem 2: 15cr, …) instead of raw topological levels; a **barycenter pass** reduces edge
   crossings; and on phones the DAG **swaps to a per-semester list** (no more horizontal
   overflow).

Ideas:
1. **"You are here" completion overlay.** Tap a course's ◌ corner (or switch tap-mode to
   "mark done") to check it off — saved to **localStorage**, no login. Done courses grey out
   (strikethrough); courses whose prereqs are now satisfied light up **⭐ eligible now**;
   "Only eligible now" filters the map and "+ Add N eligible to cart" jumps you to scheduling.
   Marking ACCT 1100 done correctly unlocks ACCT 1105.
2. **Transfer→Plan loop ("Transfer-optimized" lens).** Toggle it in Step 1 to badge every
   course with its verdict to the selected university (✓ ≈ ✕ ?) and **de-emphasize the
   non-transferring ones**, so the plan itself shows you what to prioritize — closing the loop
   from Step 3 back to Step 1.

## Third pass — bug-hunt fixes (all verified in-browser)

A hard self-review found these; all fixed:

1. **Term/seat inaccuracy (critical).** The data had been a mixed-term "franken-snapshot"
   (home college Spring-only, others Fall-only) while the UI labeled everything as one term —
   so DAG seat colors were mislabeled and Plan/Schedule disagreed. **Re-extracted term-aware:**
   `seatAggByTerm` is keyed by term, the DAG reads the selected term, and a **term selector**
   (limited to terms the home college actually has: Spring/Summer 2026) drives everything.
   Verified: switching Spring→Summer changes ACCT 1100 from 18/158 → 28/75 real seats.
2. **Evening classes were clipped.** Grid was 8 AM–6 PM, hiding 36 evening sections (6–9:20 PM) —
   the working-adult's slots. Now **8 AM–9:30 PM**; verified 10 evening blocks render.
3. **Malformed full-day block.** A "12:00 AM–11:59 PM" placeholder drew as a full-height bar.
   Now span/duration-guarded and routed to the Anytime lane.
4. **Sankey ribbons floated off their nodes** (started 90 px away). Now **attached at the bar
   edge**; verified 0 detached / 20 attached, with a text halo so labels stay legible over ribbons.
5. **No course-vs-course conflict detection.** Added a real **feasibility check** (backtracking
   over sections, treating Anytime/online as always-compatible): a banner says "✓ All N fit
   together" (with an example combination) or warns when they can't, and the conflict-free
   combination is **outlined in green** on the grid.
6. **Day parser** hardened (two-letter Tu/Th before single letters; handles "MTWThF").
7. **Stepper accessibility** — now `role=button`, `tabindex=0`, `aria-current`, keyboard-activatable.
8. **Negative net price** — added a tooltip explaining "grant aid exceeds the estimated cost of
   attendance" (verified real in source: atlanta-tech avgNetPrice −$914), so it doesn't read as broken.
9. **Prereq parsing** uses a digit-boundary match so "ACCT 1100" can't match inside "ACCT 11000".

**Build gotcha (worth repeating):** `journey.html` = `journey.head.html` (inlined data) +
`journey.app.html`. Changing `journey-data.json` requires rebuilding the head, then re-concatenating.

## Fourth pass — student-first + beautiful + bug-free (all 4 tiers, verified in-browser)

**Tier 1 — bugs:** (1) weekly-grid blocks were misaligned from the time labels (PXMIN 22 vs 24px rows) → tied px/min to row height; a 9 AM block now sits exactly on the 9 AM row. (2) every in-step toggle jumped the page to the top → `scrollTo` now fires only on step change (verified scroll 300→300 on toggle). (3) "eligible now" ignored out-of-program gen-ed/placement prereqs → now flags "＋ also: ENGL" on the node + tooltip, and the legend/footnote say "eligible = in-program prereqs met." (4) `allCourses` now dedupes by code (a course in two requirement groups can't double-render).

**Tier 2 — student-first:** a **landing/entry screen** with 3 on-ramps ("I know my major" / "Help me choose" / "Just tell me what to take next"); a **"🎯 Your next semester"** assembler that builds a ready-to-register, conflict-free, work-aware, transfer-prioritised list (verified: filled cart with 13 cr / 3 picks); a **cost & time strip** (real tuition ÷ credits → ~$7,571, ~5–6 semesters); a **seat-urgency nudge** ("⏰ Act soon: 8 classes filling"); **Save/share** (copies the URL state) + **Talk to an advisor**; and a **plain-language pass** with a tap-to-define glossary on jargon (prerequisite, transfer, net price…).

**Tier 3 — beautiful:** **light/dark theme toggle** (persisted) + **print** styles; warmth (gradient bg, soft shadows, hover/eligibility motion) with **prefers-reduced-motion** honored; **focus-visible** + keyboard-operable on-ramps and stepper; reduced node-badge overload (transfer-lens mode hides AND/OR/＋ clutter, kept in tooltip); and an elevated **schedule comparator** (one-line "4 colleges compared · 26 open · 58 anytime" summary + alternating row shading).

**Tier 4 — gold mines:** an **outcomes-first discovery** explorer on the landing — a pay-target slider that ranks the college's programs (real 1-yr earnings) and peer colleges (real 10-yr earnings) by what clears your number, with "Plan this" on the data-complete program; and an **ROI narrative** on Outcomes ("tuition ≈ 3 months of a graduate's pay," honestly showing the college sits −$2,668 below the state median).

## Fifth pass — QA bug-hunt on tiers 2–4 (found & fixed)

A dedicated QA sweep of the new code caught three more bugs:
1. **Reload skipped the welcome screen.** `saveURL` wrote `step=1` even while on the landing, so a refresh (or "Start over" + refresh) jumped straight to Plan. Fixed: the URL stays bare on the landing; a reload now returns to the welcome screen. (Deep/shared links still carry `start=1` and restore state.)
2. **ROI overstated the low-income benefit ~2.2× (a trust violation).** The "a low-income student may net" figure multiplied the *annual* net price (−$1,731/yr) by **semesters** (5) → "+$8,655." Net price is per *year*; fixed to multiply by **years** (remainCr ÷ 30) → "+$3,866 over the degree." (Honest, and the card still shows the college sitting −$2,668 *below* the state median.)
3. **Discovery explorer didn't collapse on mobile** (hard-coded 2-column grid). Fixed with a `.disco-grid` class + a ≤680px media query; verified single-column at 375px.

Verified clean afterward: completion cascade (econ 0/67→4/67 on marking a 4-cr course done), term switch (Spring↔Summer changes seats), discovery empty states at the slider extremes, and **zero console errors** across the full flow.

**Known-acceptable (not fixed, by design / prototype scope):** no theme toggle on the landing screen; "Start over" keeps your completed-courses progress (saved on the device); the ROI edge case when *every* course is marked done shows "+$0 / 1 month"; glossary definitions use `title` tooltips (no touch long-press).

## Sixth pass — QA bug-hunt (found & fixed)

1. **Weekend classes were invisible (a real, persona-relevant bug).** The grid hard-coded Mon–Fri (`if(d<1||d>5)`), but `gather()` still collected Saturday sections, the comparator summary counted them, and `feasibility()` could even pick a Saturday section as the green "conflict-free combination" — which then highlighted *nothing* on the grid. There are 3 real Saturday morning classes (ACCT 1100/1105/FYES), and Saturday is prime time for working students. **Fixed:** day columns are now dynamic — Mon–Fri always, plus Sat/Sun *only when a section actually meets then*. Verified: a cart with a Saturday class shows a Sat column with the section drawn; a weekday-only cart correctly shows none.

**Checked and clean (not bugs):** the "176 duplicate sections" are online sections that legitimately share an empty-time signature (distinct offerings, shown individually in the Anytime lane), not real duplicates; Sunday handling is symmetric to Saturday (0 in this data); no console errors across the flow.

**Known limitation (reported, not a bug):** "eligible now" and the next-semester assembler use the *home college's* offerings (seat data is home-college-keyed for term consistency), so a course offered only at another college this term isn't suggested. Defensible for a "your college's plan, then shop sections elsewhere" model; a fully multi-college "offered this term" check would be the production upgrade.

## Seventh pass — invariant guard + more QA fixes

- **Invariant guard added (per request).** `schedule()` now asserts every gathered TIMED section is renderable — each meeting day has a column AND the time fits the 8 AM–9:30 PM window. Violations are surfaced loudly (a `console.warn` + a visible "data issue" note) instead of being silently dropped. By construction it fires if anyone re-hardcodes the weekday grid, so the gather-vs-render bug class can't regress quietly. Verified: passes silently on good data.
- **Transfer denominator display bug.** When a cart's courses have *no* mapping to the selected university, a `||1` divide-guard leaked into the UI as "0 of 1 credits." Fixed: shows a clean "None of your N planned courses have published transfer data to <university> yet" (with correct has/have grammar). Verified with a FYES-only cart → Georgia Tech.
- **Two glossary label↔definition mismatches.** "College Scorecard" was showing the *net-price* definition, and a credential stat was glossing the wrong phrase. Fixed: added a proper College Scorecard definition; removed the mismatched gloss.
- **Checked clean:** no timed sections fall outside the 8 AM–9:30 PM window in the data (so no time-clipping bug); no console output anywhere.

## Eighth pass — app-wide invariant harness

Generalized the schedule invariant into a small app-wide harness (`inv()` / `flushInv()`), so every view self-checks that its render can represent everything it computed. Violations are collected per render, logged to console with specifics, and surfaced as a dismissible QA badge (hidden when clean). Assertions wired in:
- **Plan:** every course has a DAG position; the cart contains only in-program courses; **every assembler ("Your next semester") pick has a section the schedule can actually render** (the requested check).
- **Schedule:** every timed section is drawable (day has a column + time in window); cart in-program.
- **Transfer:** no planned course is silently dropped from the flow; every status maps to a bucket.
- **Outcomes:** the anchor college appears in the earnings chart whenever peers exist.

Verified: badge stays hidden across all five views on the real data (so the app is internally consistent), **fires precisely** when a violation is injected (bogus cart course → "⚠ 1 invariant issue" + a console line naming the course), and **clears** when clean data returns. This makes the whole gather-vs-render bug family — and several others — self-reporting instead of silent.

## What's faked/stubbed vs. production
- **Work hours** are a hardcoded illustrative block (Mon/Wed/Fri 3–7pm) — production would let the student draw them.
- **College/program are fixed** to one anchor; production drives these from the registry + program loader for any state that clears the data bar.
- **Data is inlined** as a static JSON snapshot; production reads the live Supabase/loader data.
- **DAG layout** is a lightweight in-file topological pass; production would use elkjs/dagre for arbitrary depth and AND/OR groups (the OR distinction here is a dashed-edge simplification).
- **Sankey** is hand-routed SVG ribbons; production would use d3-sankey for proportional widths.

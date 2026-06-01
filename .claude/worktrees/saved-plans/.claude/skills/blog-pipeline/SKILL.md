---
name: blog-pipeline
description: Run the trigger-based blog generation pipeline for Community College Path — detect signals (cluster gaps, data deltas, keyword demand), pick the highest-value candidate, draft an MDX article that conforms to BRIEF.md, run quality gates, and open a draft PR. Use whenever the user wants to publish a new blog post, asks "what should we write next", checks the blog backlog, mentions blog cadence, or wants to evaluate whether the corpus has gaps. Also use when scheduled invocation triggers blog work, or when the user asks to audit existing posts for staleness.
---

# Blog pipeline

Programmatic blog generation for Community College Path. The system is **trigger-based, not cadence-based**: most invocations should produce zero PRs. A post ships only when a real signal fires. Output is always a **draft PR** — a human reviews and merges.

The editorial constitution lives at `content/blog/BRIEF.md`. This skill is the *pipeline* around BRIEF.md — when to write, what to write, and how to enforce quality. It does not replace BRIEF.md; it operationalizes it.

## When to invoke this skill

- "Time to write a new post" / "draft the next blog article" / "what should we publish?"
- "Audit the blog corpus" / "what's missing?" / "any stale posts?"
- A scheduled GitHub Action trigger fires the pipeline
- After adding a new state, transfer agreement, or senior-waiver rule (data-delta trigger may have fired)

## When NOT to invoke

- A user asks to *edit* an existing post — that's a regular edit task, not a pipeline run.
- A user asks for general blog/SEO advice — answer directly; the pipeline is for shipping concrete drafts.
- Cross-state transfer content. Per the user's standing memory, transfer mappings are in-state only.

## The four-stage flow

Every invocation follows this sequence. Don't skip stages — silent failures here ship bad posts.

```
1. DETECT     → run all three trigger detectors, collect candidates
2. PRIORITIZE → rank candidates, skip already-drafted slugs, keep ALL qualifying
3. DRAFT      → for each candidate in priority order, call the LLM
4. GATE & PR  → for each draft, run quality gates and open a draft PR
```

Stages 3 and 4 loop per candidate. A single invocation can produce N draft PRs where N is the number of qualifying candidates returned by the detectors.

### Stage 1 — Detect

Run the detectors in parallel. Each returns 0..N candidate briefs. See `references/triggers.md` for the full design of each trigger source.

```bash
npx tsx .claude/skills/blog-pipeline/scripts/detect-cluster-gaps.ts > /tmp/blog-candidates-c.json
npx tsx .claude/skills/blog-pipeline/scripts/detect-data-deltas.ts > /tmp/blog-candidates-a.json
npx tsx .claude/skills/blog-pipeline/scripts/detect-prereq-bottlenecks.ts > /tmp/blog-candidates-d.json
npx tsx .claude/skills/blog-pipeline/scripts/detect-hybrid-density.ts > /tmp/blog-candidates-e.json
npx tsx .claude/skills/blog-pipeline/scripts/detect-late-start-density.ts > /tmp/blog-candidates-f.json
npx tsx .claude/skills/blog-pipeline/scripts/detect-course-scarcity.ts > /tmp/blog-candidates-g.json
npx tsx .claude/skills/blog-pipeline/scripts/detect-course-explainer-demand.ts > /tmp/blog-candidates-h.json
npx tsx .claude/skills/blog-pipeline/scripts/detect-transfer-receiver-patterns.ts > /tmp/blog-candidates-i.json
# Trigger B (keyword/search) — see references/triggers.md for CSV + GSC sources
```

**GSC refresh (run before every pipeline invocation):** If `~/gsc_token.json` exists, pull fresh Search Console data first — it feeds Trigger B with real click and impression signals:

```bash
source ~/gsc-venv/bin/activate && python3 ~/gsc_audit.py
```

This writes `~/gsc_audit_output.json`. The detect stage reads `blog_queries` (impressions with 0 clicks) and `quick_wins` (position 5–20, low CTR) from that file and promotes them as Trigger B candidates. If the script is unavailable or fails, continue without it — the other detectors are unaffected.

A candidate brief is JSON with: `triggerSource`, `topic`, `targetReader`, `searchIntentHypothesis`, `articleType` (`general` | `state-spoke` | `college-spoke` | `hub`), `state` (or `null`), optional `college` (slug), `cluster` (or `null`), `nonDuplicateRationale`, `dataSlicePaths` (file paths whose contents the drafter must read).

**College-spoke articles** are pinned to a specific institution within a covered state (e.g., Germanna Community College, Wake Tech, Brookdale Community College). They draft from that institution's `audit_policy` data — costs, contact email, application steps — and target search-intent tail like "[college name] audit class." The hub is general; the spoke is institutional. The renderer still routes the article under its `state` for navigation; the `college` field ties it to the institution for cluster-gap detection and cross-linking. Word-count range: 800–1500.

If all detectors return zero candidates, **stop and report "no triggers fired this run"**. This is the expected outcome most of the time.

**Data-driven detectors write precomputed slice files** (under `.blog-pipeline/slices/`) and reference them in `dataSlicePaths`. The drafter consumes those slices verbatim — every numeric claim in the article must come from a slice file, not LLM speculation. The prereq-bottleneck detector is the first such detector; future ones (course-availability, instructor-density, transfer-mapping patterns) follow the same convention.

**GSC-driven detectors are a separate pattern** (introduced 2026-05-11 with issue #368). Instead of reading data presence, they read search demand: parse `~/gsc_audit_output.json` for queries matching a specific pattern (e.g., course-code-shaped queries with 0 clicks at top-10 positions) and emit candidates for content that would convert that demand. The slice file for a GSC-driven candidate combines (a) the GSC stats backing the candidate (impressions, position, query variants), and (b) the actual product data the article must cite. Use this pattern when search demand is the strongest signal — typically for capture-existing-demand content, not for expanding into new theme areas.

### Stage 2 — Prioritize

Detector `rankScore` is a *data-presence* signal, not an editorial-value signal. Sorting by rankScore alone systematically over-picks templated articles for clusters where every state has the same shape of data (statute citations, audit policies). Pre-2026-05-10 the pipeline drafted a stack of senior-waiver and audit-at-college spokes for that exact reason, and the user pushed back: "We have tons of other good data. Why are you always writing about that instead?"

Apply the rules below in order. They override rankScore.

#### Step 2a — Check detector output for empty candidate lists

Every detector self-filters: before emitting a candidate for a state or college, it checks `articles[]` in `content/blog/index.ts` and skips entries that already have a spoke. A cluster is naturally exhausted when its detector returns zero candidates — no hardcoded spoke-count cap is needed or correct (a cap would fire before all covered states have spokes, and would need manual updating whenever new states are added).

If all detectors return zero candidates after self-filtering, **stop and report "no triggers fired this run"** — that's the signal to add a new hub, a new detector, or new state data before drafting more. Do not manufacture candidates to fill a batch.

#### Step 2b — Bias toward data depth

Within the remaining candidates, prefer articles whose `dataSlicePaths` include precomputed slice files (`.blog-pipeline/slices/...`) or large structured datasets (`data/{state}/courses/`, `data/{state}/transfer-equiv.json`, `data/{state}/prereqs.json`) over articles that source from a single config field. The latter become templated; the former force the drafter to reason from real numbers and produce posts that BRIEF.md actually wants.

If two candidates tie on cluster-non-saturation, pick the one whose data slice has more numeric content the article must cite. A prereq-bottleneck candidate with a 200-entry slice file outranks a state-spoke whose only data input is a one-paragraph `seniorWaiver` config block.

#### Step 2c — Cover BRIEF.md themes the corpus is missing

`content/blog/BRIEF.md` § "What kinds of articles to create" lists nine theme areas. Audit which themes have ≥ 3 spokes vs. which have 0. Push candidates that fill 0-spoke themes ahead of candidates that pile onto already-covered themes, even when rankScores favor the latter.

As of 2026-05-11 (update this after each batch):
- ✅ Heavily covered: transfer confusion (18 spokes), senior waivers (13 — see issue #366 for ~25 more eligible states), session timing (10 spokes — MD, TN, MA, NY, NC, VA, CT, SC, GA, FL; PRs #347), audit-at-college (9 college spokes)
- ⚠️ Lightly covered: prereq sequencing (16 spokes — FL, GA, MD, NC, SC, DE, MA, RI, NY, PA, DC, CT, NH, TN, VA, VT; detector exhausted — all covered states have spokes), hybrid-course-density (9 spokes — ME, MD, MA, VA, SC, NC, KY, AL, NY; detector exhausted — no more slice data for covered states), late-start-by-state (15 spokes — NH, GA, SC, TN, MD, NC, DE, RI, FL, KY, MS, MA, VT, AL, DC; detector exhausted — all covered states have spokes), course-availability (hub + 6 spokes: NC, GA, KY, VA, TN, SC (PRs #336, #346); FL and AL still pending)
- ⚠️ Lightly covered: course-explainer (1 hub + 3 spokes as of 2026-05-11: SDV 100 + BIO 101 at DCC, EXSC 240 at Frederick CC — GSC-driven detector live, can produce more spokes when GSC data surfaces them)
- ⚠️ Lightly covered: transfer-receiver patterns (1 hub + 1 spoke as of 2026-05-11: `which-universities-are-toughest-transfer-receivers` hub + `georgia-transfer-receivers-compared` spoke — detector live, 11 more states queued)
- ❌ Zero coverage: cross-college schedule building (BRIEF.md §3), instructor density, program-level content, cost-of-college / financial vertical (issue #369), community-college comparison content (issue #370)

The next batches should disproportionately fill the lightly- and zero-covered themes. That's where the real editorial value sits.

**New cluster issues filed during 2026-05-11 SEO review** (#366-#375): these encode the highest-leverage editorial gaps identified from Search Console data. The proposed clusters in the table below now have corresponding GitHub issues with hub-article briefs and detector designs.

#### Step 2d — Cap any single cluster's share of a batch

No more than **3 articles from the same cluster** in a single batch run, regardless of how many candidates the detector found. Rotate across themes. A batch of 10 articles drafting 8 from one cluster is a saturation-in-disguise pattern and produces drafter-quality decay (G4 catches some; subjective sameness it doesn't).

If a cluster only has 1–2 candidates that pass steps 2b–2c, take all of them. If it has 4+, take the top 3 by rankScore and defer the rest.

#### Step 2e — Skip already-drafted slugs

Read `.blog-pipeline/cooldown.json` and skip any candidate whose slug appears there. The original 2-per-7-days rate cap was removed in favor of relying on the quality gates: G1 word-count, G3 banned-phrase, and G4 embedding similarity already block thin or near-duplicate output, which is what a rate cap was a crude proxy for. Reviewer throughput is the real bottleneck — the human can ignore unreviewed PRs without skill changes.

The ledger file name is preserved (`cooldown.json`) for backward compatibility with existing entries, even though it no longer enforces a cooldown.

#### Step 2f — Final ordering after the filters

Among the candidates that survive steps 2b–2e, draft in this priority order:

1. Data-delta candidates from a brand-new state (registry just gained an entry)
2. Data-driven detector candidates (prereq-bottleneck and any future ones) for under-covered BRIEF.md themes
3. Cluster-gap candidates for hubs with 1–2 existing spokes (the cluster is proven but shallow)
4. Cluster-gap candidates for hubs with 3+ existing spokes (established cluster, filling remaining state gaps)
5. Data-delta candidates from a new transfer agreement or senior-waiver rule change
6. Keyword candidates (only when both intent quality and product alignment are high)

Within each band, rankScore breaks ties.

### Stage 3 — Draft

The drafter is a single LLM call. Read `references/prompt-template.md` for the exact prompt structure — it wraps `content/blog/BRIEF.md` verbatim with the candidate brief and data slice.

The drafter must produce, in this order:
1. The full BRIEF.md "Output expectations" block (title, type, target reader, search intent, strategic rationale, review-cadence flag, full draft, suggested links, follow-up companions)
2. The exact `ArticleMeta` object to insert into `content/blog/index.ts`
3. The full `.mdx` file body to write to `content/blog/<slug>.mdx`

Cluster spokes must be drafted only after reading the existing hub article — pass the hub's full text into the prompt. Spokes that don't reference their hub fail the quality gates.

### Stage 4 — Gate and PR

Run the quality gates against the draft. See `references/quality-gates.md` for the full gate list and the banned-phrase set.

```bash
npx tsx .claude/skills/blog-pipeline/scripts/quality-gates.ts \
  --draft /tmp/blog-draft.json \
  --slug <slug>
```

If any gate fails for a given candidate, **do not open a PR for that candidate**. Report which gate failed, mark that candidate as skipped in the run summary, and continue to the next candidate in priority order. Do not "fix and retry" silently — a gate failure means the drafter produced something the brief wouldn't accept, and that signal is worth surfacing to the human even if other candidates in the same batch ship cleanly.

A failed candidate does NOT abort the rest of the batch. Each candidate is drafted and gated independently.

If all gates pass:

1. Branch: `claude/blog-<trigger-source>-<slug>` (e.g., `claude/blog-cluster-gap-pa-senior-waivers`)
2. Apply the edit: insert the `ArticleMeta` into `content/blog/index.ts` and write `content/blog/<slug>.mdx`
3. Run `npm run build` locally to prove the edit compiles. If the build fails, do not open the PR.
4. Update `.blog-pipeline/cooldown.json` with the new entry (slug + ISO timestamp)
5. Update `.blog-pipeline/snapshot.json` if a data-delta trigger fired (so the same delta doesn't refire)
6. `gh pr create --draft` with the body from the BRIEF.md output block, plus the reviewer checklist below

Reviewer checklist (paste into PR body):

```markdown
## Reviewer checklist
- [ ] Read for fluff. Any "Top N tips" energy? Any generic education-blog filler?
- [ ] Verify factual claims (cite the data slice paths the drafter used)
- [ ] Click every internal link — do they resolve to existing posts/tools?
- [ ] State-specific posts: confirm StateToolsCTA renders top + bottom
- [ ] Cluster spokes: confirm the hub link is present and a sibling spoke is referenced
- [ ] If review-cadence flag is true, add a calendar reminder for annual review
```

## Adding new clusters and detectors

When the existing clusters all saturate (Stage 2a returns only saturated candidates), the pipeline is signaling that the next investment should be **a new cluster or a new detector**, not more drafting against the existing surface. Adding a hub article unlocks dozens of state-spoke candidates; adding a data-driven detector unlocks per-state article potential against data the repo already collects.

### Underused data sources (as of 2026-05-10)

The repo has substantial data the pipeline doesn't currently mine:

- **Course sections per state**: `data/{state}/courses/<college>/<term>.json`. 50,000+ sections for many states. Includes start dates, instructors, modes (in-person/hybrid/online), credits, days, prereqs. Used today only for session-timing distinct-start-date counts.
- **Transfer equivalencies**: `data/{state}/transfer-equiv.json`. 78k entries in FL, 122k in MD, 53k+ in TN/GA/NC. Used today only as a rankScore signal; not mined for direct-vs-elective patterns, receiver tightness, or course-portability analysis.
- **Prereq graphs**: `data/{state}/prereqs.json`. Used by `detect-prereq-bottlenecks.ts`. Pattern proven; one cluster (`prereq-chains-guide`) ready for state-spoke drafting.
- **Programs and degree maps**: `data/{state}/programs/`. Untapped.
- **Section modes**: every section has `mode` (in-person, hybrid, online). Hybrid course density per state per term — never analyzed.
- **Instructor data**: section records carry `instructor`. Per-course instructor variance — never analyzed.
- **Section availability and timing**: `start_date`, `start_time`, `days`, `seats_open`. Late-start patterns, evening/weekend density, fill states — never analyzed.

### Cluster ideas to build next

These map to BRIEF.md theme areas with 0 or 1 spokes. Each, once seeded with a hub, opens 15–24 state-spoke candidates by detector convention.

| Proposed cluster | Hub article topic | Detector | BRIEF.md theme | Issue |
|---|---|---|---|---|
| `prereq-chains-guide` (hub exists) | (existing) | ✅ `detect-prereq-bottlenecks.ts` | §7 Prereqs | — |
| `course-availability-guide` ✅ hub + detector live | "Which Community College Courses Are Actually Hard to Find" | ✅ `detect-course-scarcity.ts` — classifies courses as universal/scarce/point-source; 8 state spokes pending | §2 Registration timing | — |
| `hybrid-course-density-guide` (hub exists; spokes pending) | (existing) | ✅ `detect-hybrid-density.ts` | §8 Online vs hybrid | — |
| `late-start-by-state-guide` (hub exists; spokes pending) | (existing) | ✅ `detect-late-start-density.ts` | §2 Registration timing | — |
| `cross-college-scheduling-guide` | "Taking Classes at More Than One Community College" (existing standalone) | (no detector needed; per-state spokes editorially driven) | §3 Cross-college | — |
| `transfer-receiver-patterns-guide` ✅ hub + detector + 1 spoke live (2026-05-11) | (hub: `which-universities-are-toughest-transfer-receivers`) | ✅ `detect-transfer-receiver-patterns.ts` mines `data/{state}/transfer-equiv.json` per (state, receiver), filters to receivers with ≥200 mappings, emits per-state candidates ranked by direct-% spread + log of aggregate mappings. Slice file per state with toughest/most-generous flagged. Emits 12 candidates against current data (NJ, GA, NC, MD, MA, SC, PA, TN, NY, DE, VA, FL). | §1 Transfer confusion | [#367](https://github.com/rohan-c0de/cc-coursemap/issues/367) |
| `instructor-density-guide` | "Same Course, Different Instructor: How [Course] Staffs Across [State]" | new: per-course instructor count from `data/{state}/courses/`; emit per-course-per-state spokes for high-variance combos | (cross-cuts §3 and §6) | — |
| `course-explainer-guide` ✅ hub + detector + 3 spokes live (2026-05-11) | (hub: `community-college-course-codes-explained`) | ✅ `detect-course-explainer-demand.ts` reads `~/gsc_audit_output.json` for course-code-shaped queries with high impressions + low CTR; emits a candidate per high-demand course code with state + college extracted from quoted phrases. Dedup matches on state+college+code signature plus a same-code-any-context guard so general-context candidates don't duplicate college-specific spokes. **First detector that reads search demand, not data presence.** | §6 College-specific | [#368](https://github.com/rohan-c0de/cc-coursemap/issues/368) |
| `cost-of-college-guide` ⭐ **high-RPM financial vertical** | "What Community College Actually Costs in 2026 (After Aid)" | (initially no detector; editorially driven national + state-pair spokes) | new theme #10 (financial) | [#369](https://github.com/rohan-c0de/cc-coursemap/issues/369) |
| `comparison-guide` ⭐ **high-CTR comparison content** | "Community College vs 4-Year University: Real Cost-and-Outcome Breakdown 2026" | (no detector; state-pair generation is mechanical over neighboring states) | new theme #11 (comparison) | [#370](https://github.com/rohan-c0de/cc-coursemap/issues/370) |

When a cluster idea above looks ready, the implementation pattern is:

1. Write the hub article (general explainer, 1500-2500 words). This is editorial work, not pipeline output.
2. Add the hub entry to `content/blog/index.ts` with `clusterRole: "hub"`.
3. Implement the detector under `.claude/skills/blog-pipeline/scripts/detect-<theme>-<pattern>.ts` following the `detect-prereq-bottlenecks.ts` template — read data, compute stats, write a slice file per state to `.blog-pipeline/slices/<theme>/<state>.json`, emit candidates with `dataSlicePaths` pointing at the slice.
4. Update `SKILL.md` "Bundled scripts" table to register the new detector.
5. Update Stage 2c "covered themes" tally so future runs reflect the new cluster.

The detector pattern enforces data-grounded drafting: every numeric claim in the resulting article has to come from the slice file, which makes the article concretely useful instead of templated boilerplate.

## Kill switch

If a bad post ships, disable the pipeline immediately by creating an empty file at the repo root:

```bash
touch .blog-pipeline/DISABLED
```

Every detector script checks for this file at startup and exits 0 if present. Remove the file to re-enable. The scheduled GitHub Action also checks for this file before running.

## Snapshot management

The data-delta detector compares current registry/data state against `.blog-pipeline/snapshot.json`. To bootstrap or rebuild the snapshot (e.g., after a corpus rewrite):

```bash
npx tsx .claude/skills/blog-pipeline/scripts/snapshot-state.ts > .blog-pipeline/snapshot.json
```

Commit the snapshot — it's the source of truth for "what was the world like last time we ran." A missing snapshot makes every state and every transfer agreement look new, which would flood the pipeline.

## Scheduled invocation

The pipeline is wired to run on a cron via `.github/workflows/blog-pipeline.yml`. The workflow runs the detectors on a schedule (default: weekly Mondays at 14:00 UTC) and invokes Claude Code with this skill if any candidates surface. Most weeks: zero PRs. That's the design.

If you (Claude) are invoked from inside the workflow, behave identically to a manual invocation — the four stages don't change.

## Bundled scripts

| Script | Purpose |
|---|---|
| `scripts/detect-cluster-gaps.ts` | Trigger C — find hubs with missing state spokes; for the `audit-at-college-guide` cluster, surfaces per-college spokes for institutions with rich `audit_policy` data. Detectors return rankScore by data-presence; Stage 2 (Prioritize) is responsible for editorial-value filtering on top |
| `scripts/detect-data-deltas.ts` | Trigger A — diff current data against last snapshot |
| `scripts/detect-prereq-bottlenecks.ts` | Trigger D — mine `data/{state}/prereqs.json` for chain depth and blocker courses; emits a candidate per state with ≥5 chains of depth ≥3, plus a precomputed stats slice the drafter must consume. Pattern template for future data-driven detectors |
| `scripts/detect-hybrid-density.ts` | Trigger E — mine `data/{state}/courses/<college>/<term>.json` for hybrid/online/in-person mode share; emits a candidate per state where hybrid ≥ 3% of sections, plus a precomputed stats slice. The 3% threshold filters out states where hybrid is unmarked (FL, TN, GA, CT, DE, DC categorize blended sections as in-person rather than hybrid in scraped data) |
| `scripts/detect-late-start-density.ts` | Trigger F — mine `data/{state}/courses/<college>/2026FA*.json` for sections starting > 2 weeks after the standard fall start date; emits a candidate per state where late-start ≥ 5% of fall sections, plus a precomputed stats slice. The LATE_CUTOFF date is hardcoded for the current term — update annually before fall registration |
| `scripts/detect-course-scarcity.ts` | Trigger G — mine `data/{state}/courses/<college>/<term>.json` for cross-college course coverage; classifies each course as universal/common/selective/scarce/point-source; emits a candidate per state where multiChoiceCount ≥ 50 and collegeCount ≥ 5, plus a precomputed slice at `.blog-pipeline/slices/course-scarcity/{state}.json`. Fires for NC, GA, KY, VA, TN, SC, FL, AL. States without common course numbering (MD, NY) don't fire. Hub article `which-community-college-courses-are-hard-to-find` must exist before spokes are gated |
| `scripts/detect-course-explainer-demand.ts` | Trigger H — **first GSC-driven detector**. Reads `~/gsc_audit_output.json` for course-code-shaped queries (regex `/([a-z]{2,4})[\s-]*(\d{2,4})/`) with aggregate impressions ≥ 30, CTR ≤ 5%, best position ≤ 20. Aggregates by course code across query variants, extracts state + college from quoted phrases (e.g. `"danville community college"`), writes slice file to `.blog-pipeline/slices/course-explainer/<code>.json` with full GSC stats. Emits a candidate per qualifying code as `college-spoke` (state + college resolved), `state-spoke` (only state resolved), or `general` (no context). Hub `community-college-course-codes-explained` must exist before spokes gate |
| `scripts/detect-transfer-receiver-patterns.ts` | Trigger I — mine `data/{state}/transfer-equiv.json` per (state, in-state receiver university). For receivers with ≥200 mappings, classify each course as direct/elective/no-credit and compute percentages. Emit one candidate per state with ≥3 qualifying receivers and ≥1,000 aggregate mappings. Slice at `.blog-pipeline/slices/transfer-receivers/<state>.json` includes per-receiver stats + toughest/mostGenerous flags + directPctRange. Rank score rewards direct-% spread (story richness) over raw volume. Hub `which-universities-are-toughest-transfer-receivers` must exist before spokes gate |
| `scripts/snapshot-state.ts` | Capture current registry/data state |
| `scripts/quality-gates.ts` | Run all quality gates against a draft |

**Note on detector vs. prioritization roles:** Detectors are intentionally permissive — they flag everything that *could* support an article. The skill's Stage 2 rules (saturation cap, theme diversity, BRIEF.md coverage) decide what *should* draft this run. Don't push editorial filtering down into the detectors; keep them mechanical and reproducible, and let SKILL.md's prioritization stage do the editorial work.

Trigger B (keyword/search-intent) is intentionally manual for v1: drop a CSV at `.blog-pipeline/keyword-candidates.csv` with columns `query,monthly_volume,intent_quality_0_to_5,product_alignment_0_to_5`. The pipeline reads it during the detect stage. Wire to DataForSEO or similar later when the manual flow proves valuable.

## References

- `references/triggers.md` — full design of each trigger source, including detector algorithms and "what counts as material"
- `references/quality-gates.md` — gate definitions, thresholds, banned-phrase list, and rationale for each
- `references/prompt-template.md` — the exact LLM prompt template that wraps BRIEF.md
- `content/blog/BRIEF.md` (in repo) — editorial constitution. Read this before drafting, every time.
- `CLAUDE.md` (in repo) — architectural invariants, especially the no-hardcoded-state-lists rule

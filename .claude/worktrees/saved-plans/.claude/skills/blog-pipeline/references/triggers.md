# Triggers — full design

The pipeline has three trigger sources. Each is a detector that returns 0..N candidate briefs. Most runs of most detectors return zero — that's the intent.

## Trigger A — Site data deltas

**Fires when:** the underlying data the blog depends on materially changes between the last snapshot and now.

### What counts as material

Material (fires a candidate):
- A new state appears in the registry (`getAllStates()` returned N+1 vs. last snapshot)
- A new sending↔receiving university pair appears in any `data/{state}/transfer-equiv.json` (a new statewide articulation pathway, not a one-course addition)
- A `StateConfig.seniorWaiver` field changes (citation, age threshold, audit-vs-credit distinction)
- A new institution (college) appears in `data/{state}/institutions.json`

Not material (ignored):
- Course catalog churn — courses added/removed/renamed within an existing college
- ZIP code refreshes
- Scraper run timestamps
- PeopleSoft enrichment summary changes
- Any change to a file the public site does not render

The split exists because course-catalog churn is constant and high-volume — wiring it to the blog would produce daily noise. Statewide articulation changes are rare and high-value.

### Snapshot location

`.blog-pipeline/snapshot.json` at repo root. Committed. Format:

```json
{
  "version": 1,
  "capturedAt": "2026-05-02T14:00:00.000Z",
  "states": ["ct", "dc", "de", "ga", "ma", "md", "me", "nc", "nh", "nj", "ny", "pa", "ri", "sc", "tn", "va", "vt", "wv"],
  "transferPairs": {
    "va": ["nvcc->gmu", "nvcc->vt", "..."],
    "nc": ["..."]
  },
  "seniorWaivers": {
    "va": {"age": 60, "auditOnly": false, "citation": "VA Code § 23.1-..."},
    "nc": {"age": 65, "auditOnly": true, "citation": "..."}
  },
  "institutions": {
    "va": ["nvcc", "tcc", "..."],
    "nc": ["..."]
  }
}
```

The detector loads this, recomputes the same shape from current code/data, and diffs.

### Candidate brief shape from Trigger A

```json
{
  "triggerSource": "data-delta",
  "deltaType": "new-state" | "new-transfer-pair" | "senior-waiver-change" | "new-institution",
  "topic": "Pennsylvania transfer pathways: how PASSHE and the state community college system work together",
  "targetReader": "PA community college student planning to transfer to a public 4-year",
  "searchIntentHypothesis": "PA student searching 'community college transfer pennsylvania' wants to know if their CCAC credits will count at Pitt or Penn State",
  "articleType": "state-spoke",
  "state": "pa",
  "cluster": "transfer-credit-guide",
  "nonDuplicateRationale": "Existing cluster has VA, NC spokes — no PA spoke. Confirmed via getClusterArticles('transfer-credit-guide').",
  "dataSlicePaths": ["data/pa/transfer-equiv.json", "lib/states/pa/config.ts"]
}
```

## Trigger C — Cluster gap detection

**Fires when:** an existing hub article has missing spokes for states (or colleges) that have the relevant data.

### Algorithm

For each article with `clusterRole === 'hub'`:
1. Get all spokes via `getClusterArticles(hub.cluster)`. Note which states (and colleges, for per-college clusters) are covered.
2. **For per-college clusters** (currently `audit-at-college-guide`): for each institution in `data/{state}/institutions.json` across covered states, gate on rich data presence (e.g., `audit_policy.allowed && application_process.steps.length >= 3 && contact_email`); emit a `college-spoke` candidate per qualifying institution that isn't already covered.
3. **For state-spoke clusters**: for each state in `getAllStates()` not yet covered, gate on theme-specific data:
   - Transfer-themed hubs: `transferSupported === true` and `data/{state}/transfer-equiv.json` ≥ 5 entries.
   - Senior-waiver-themed hubs: `StateConfig.seniorWaiver` exists.
   - Session-timing-themed hubs: institution count ≥ 1 (we have data on the state).
4. Rank remaining gaps by `institutionCount * 2 + transferEquivCount` (a data-presence proxy). Emit ALL qualifying candidates — Stage 2 of the pipeline filters for editorial value, saturation, and theme diversity.

The detector is intentionally permissive. It does not cap candidates per hub or per run. Editorial filtering (which clusters are saturated, which themes are under-covered) happens in SKILL.md Stage 2 — see "Stage 2 — Prioritize" for the saturation cap and theme-diversity rules.

### Why "gaps with data backing" only

A spoke without underlying data becomes filler. The reader hits "Pennsylvania transfer pathways" expecting a substantive guide and gets a thin generic restatement of the hub. That's the failure mode BRIEF.md is designed to prevent. The detector enforces it at the trigger layer.

### What this detector does NOT do

- It does not consider whether a cluster is already saturated. A cluster with 13 spokes will still surface every additional state's gap — the saturation check happens at Stage 2.
- It does not account for which BRIEF.md theme has the most/fewest existing posts. Theme-diversity is also a Stage 2 concern.
- It does not enforce a per-hub or per-run cap. The earlier cap (`gaps[0]`) was removed in 2026-05; the per-hub-per-run cap (one candidate per hub) was likewise removed.

This separation matters: detectors should be reproducible and mechanical, so detector output is itself a reviewable surface for "what *could* draft." The skill's prioritization stage is where the editorial judgment lives.

## Trigger B — Keyword / search-intent

**Fires when:** external search demand reveals an uncovered topic.

### Source 1 — GSC audit (primary, automated)

Before each pipeline run, refresh GSC data:

```bash
source ~/gsc-venv/bin/activate && python3 ~/gsc_audit.py
# writes ~/gsc_audit_output.json
```

Read two sections of the output:

**`blog_queries`** — queries where one of our blog pages already shows up in Google but gets 0 clicks (impressions > 0, clicks = 0). These prove search demand exists and we're close to ranking — a topic refinement or new companion article can capture the traffic.

**`quick_wins`** — queries where a course/college page ranks position 5–20 with low CTR. A blog post explaining the course or concept can lift the entire cluster.

For each entry, synthesize a candidate brief: the `query` becomes the `searchIntentHypothesis`, the page URL informs `state` and `articleType`. Treat `impressions` as a proxy for monthly volume. Apply the same filters as the CSV source (intent ≥ 3, alignment ≥ 3, no near-duplicate against existing posts).

Prioritize `blog_queries` with position < 20 — these are one article away from page 1.

### Source 2 — manual CSV

For topics not yet appearing in GSC, drop a file at `.blog-pipeline/keyword-candidates.csv`:

```csv
query,monthly_volume,intent_quality_0_to_5,product_alignment_0_to_5
"how to drop a class without owing tuition",1900,4,3
"can i take community college classes while in high school virginia",480,5,5
```

The detector:
1. Reads the CSV (returns zero candidates if file is missing — that's fine)
2. Filters to rows where `monthly_volume >= 200`, `intent_quality >= 3`, `product_alignment >= 3`
3. For each surviving row, runs an embedding-similarity check against existing articles. Reject if cosine similarity > 0.82 against any existing post.
4. Returns surviving rows as candidate briefs

The thresholds are intentional. 200/mo is the floor where ranking is worth the effort. Intent and alignment ≥ 3 filters out vanity traffic — the visitor must plausibly use Community College Path.

### v2 — fully automated

Wire to DataForSEO, Ahrefs MCP, or Google Trends only after the GSC + CSV flow proves which kinds of queries actually convert to good articles. Premature automation here will fill the pipeline with junk.

### Why this trigger is third-priority

Keyword candidates lack the natural product alignment that data-delta and cluster-gap candidates have built in. They're easier to write filler for. Treat them as supplementary — don't let them dominate the publishing mix.

## Output contract for all detectors

Each detector script:
- Exits 0 on success (even with zero candidates)
- Writes JSON to stdout: `{"candidates": [...]}`
- Writes diagnostics to stderr (so stdout stays clean for piping)
- Checks `.blog-pipeline/DISABLED` at startup; exits 0 with empty candidates if present
- Never modifies state — purely read-only. Snapshot updates happen in the gate-and-PR stage, not here.

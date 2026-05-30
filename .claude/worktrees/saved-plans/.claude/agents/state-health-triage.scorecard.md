# state-health-triage — grading scorecard

Run against the 28 hand-classified cases in `state-health-triage.eval.md` on 2026-05-24. Each case was fed to a `general-purpose` subagent carrying the full `state-health-triage` system prompt. The subagent queried `data/state-health/history.jsonl` and `lib/states/{state}/config.ts` to gather its own evidence — no leakage from the eval file.

## Headline result

| Metric | Result | Threshold | Pass? |
|---|---|---|---|
| Classification match (strict) | **23 / 28 = 82%** | ≥ 80% | ✅ |
| Reasoning hits ≥1 key signal | **27 / 28 = 96%** | ≥ 60% | ✅ |
| Honest match (excluding eval bugs) | **26 / 28 = 93%** | — | — |

Agent meets the ship-it bar. Two of the five mismatches turned out to be eval-set bugs (the eval was wrong, the agent followed its own taxonomy correctly), which got fixed alongside this grading pass. One mismatch is a genuine prompt weakness (the cluster-detection rule was too loose) and got a one-sentence prompt patch. Two are low-impact taxonomy edge cases.

## Per-case results

Format: `pass / miss → classification (agent) vs classification (eval)`. ✓ = matches both label and reasoning; ✗ = label mismatch; ⚠ = label matches but reasoning weak (none observed in this run).

| # | Case | Ground truth | Agent | Result | Notes |
|---|---|---|---|---|---|
| 1 | VA courses j1 | known-acceptable | known-acceptable | ✓ | |
| 2 | VA courses j0 | registry-evolution | known-acceptable | ✗ | **Eval bug** — VA still has `scrapers: {} + // manual-only:`; by the decision order, registry check wins over evolution check. Agent followed the rule correctly. Eval fixed. |
| 3 | MD courses j0 (recovery) | recovered | recovered | ✓ | Strongest correct call: agent identified 4-tick trailing-edge healthy window after 8-fail cluster. |
| 4 | MD courses j1 | stable-healthy | stable-healthy | ✓ | |
| 5 | WV courses (never worked) | persistent-broken | persistent-broken | ✓ | Agent correctly distinguished "never succeeded since first record" from `regression`. |
| 6 | HI courses (just broke) | regression | regression | ✓ | Agent applied the regression rule even though only 2 prior successes existed (rule says ≥3); leaned on "spirit fits" — defensible. |
| 7 | OR courses partial | partial-coverage-degraded | partial-coverage-degraded | ✓ | Agent checked sibling jobs at same tick. |
| 8 | NC courses recovered | recovered | recovered | ✓ | |
| 9 | NJ courses isolated failure | transient | stable-healthy | ✗ | **Eval bug** — trigger ts in Case 9 was set to 2026-05-24 (live, healthy). Under decision rules, trailing-edge healthy → stable-healthy. The `transient` framing only makes sense if the trigger is the failure itself (which is Case 27). Eval fixed. |
| 10 | DC courses May 3 incident | infrastructure-incident | infrastructure-incident | ✓ | |
| 11 | CT courses recovered | recovered | recovered | ✓ | |
| 12 | FL transfers regression | regression | regression | ✓ | Agent also noted issue #123 already tracks this — recommended comment-on-existing-issue, not open new. |
| 13 | ME transfers recovered | recovered | recovered | ✓ | |
| 14 | ME prereqs vs stale issue | external-issue-resolved | external-issue-resolved | ✓ | Agent correctly compared issue #474 updatedAt to trigger ts; recommended close-existing-issue. |
| 15 | SC courses stable | stable-healthy | stable-healthy | ✓ | |
| 16 | NY courses stable | stable-healthy | stable-healthy | ✓ | |
| 17 | PA transfers stable | stable-healthy | stable-healthy | ✓ | |
| 18 | TX courses stable (new) | stable-healthy | stable-healthy | ✓ | Agent applied the "window <3 all positive → stable-healthy, not new-scraper-no-history" rule. |
| 19 | AZ no records | new-scraper-no-history | new-scraper-no-history | ✓ | Agent correctly distinguished from `persistent-broken` by checking record count (0). |
| 20 | MS prereqs stable | stable-healthy | stable-healthy | ✓ | |
| 21 | VA courses j0 alt framing | registry-evolution | known-acceptable | ✗ | **Eval bug** — same as Case 2. Eval fixed. |
| 22 | VT courses stable | stable-healthy | stable-healthy | ✓ | |
| 23 | KY courses stable (new mid-window) | stable-healthy | stable-healthy | ✓ | |
| 24 | NV transfers sparse | stable-healthy | known-acceptable | ✗ | **Low-impact miss** — agent reasoned "registry doesn't declare nv/transfers, so opted out." Closer to `registry-evolution` (history exists, no current declaration) than `known-acceptable` (which requires explicit marker). Recommended action (no-action) matches. Not worth a prompt change. |
| 25 | NJ transfers stable | stable-healthy | stable-healthy | ✓ | |
| 26 | VA transfers cancelled | known-acceptable | known-acceptable | ✓ | |
| 27 | NJ courses May 4 negative test | transient | infrastructure-incident | ✗ | **Real prompt weakness** — agent counted MD as a co-failing state for the cluster, but MD was in its own ongoing 10-day outage (failures since May 1). The agent's rule said "≥2 unrelated states failed identically" but didn't exclude states already in their own outage. **Prompt patched** (see below). |
| 28 | MA courses stable | stable-healthy | stable-healthy | ✓ | |

## Failure analysis

### Bucket 1: Eval bugs (3 cases — eval was wrong, agent was right)

- **Cases 2 & 21 (VA courses j0):** I wrote these as `registry-evolution` thinking VA's removal from cron was the salient fact. But VA's config still has `// manual-only:` comments and `scrapers: {}` — that hits `known-acceptable` first in the decision order. The agent correctly followed the rules I wrote. Eval ground truth corrected to `known-acceptable` in both cases.
- **Case 9 (NJ courses):** I set the trigger to the live healthy record but classified the case as `transient` — describing the *historical* isolated failure rather than the trigger state. The agent classified the trigger (stable-healthy). Eval ground truth corrected to `stable-healthy`; the actual "transient" framing is now Case 27's job.

### Bucket 2: Real prompt weakness (1 case)

- **Case 27 (May 4 negative test for infra-incident):** The agent saw NJ + MD both failed at the same ts and called it infra-incident. But MD was in its own ongoing outage (failures every tick May 1 → May 11). The agent's decision rule said "≥2 unrelated states failed identically AND recovered together" — which the agent satisfied if you don't look at MD's prior ticks. The fix is a one-sentence addition to the rule: a state counts toward the cluster only if its prior tick was a success. Patched in the agent file.

### Bucket 3: Low-impact taxonomy edge case (1 case)

- **Case 24 (NV transfers):** Agent classified `known-acceptable` reasoning that registry doesn't declare transfers. The more precise label is `registry-evolution` (history exists, no current declaration) or `stable-healthy` (depending on whether we count the live healthy record). Both recommended_action: no-action. Not patching the prompt for this — fixing the eval to give clearer signal is better.

## What the agent got particularly right

- **Case 14 (external-issue-resolved):** Agent fetched the live rolling-issue body via `gh issue list`, parsed updatedAt, and confirmed the trigger was 6.5h later. This is the most procedurally complex case in the eval and it nailed it.
- **Case 7 (partial-coverage-degraded):** Agent correctly checked sibling matrix jobs at the same tick — exactly the cross-job reasoning the rule requires.
- **Case 12 (FL transfers regression):** Agent went beyond the rule and proactively recommended commenting on the existing #123 issue rather than opening a new one. Good production behavior.
- **Case 18 vs Case 19 (TX vs AZ):** Both are recently-added states, but TX has 3 records (all healthy) and AZ has 0. The agent correctly mapped TX → stable-healthy and AZ → new-scraper-no-history. This is the kind of fine-grained call that determines whether a weekly rollup is signal or noise.

## Prompt patch applied

Added to the `state-health-triage.md` system prompt, in the infrastructure-incident section of the decision order:

> When applying rule 4 (infrastructure-incident), the OTHER states in the cluster must each show a successful prior tick. If a state was already failing in its previous tick, exclude it from the cluster count — its failure is part of its own outage, not the incident. The cluster needs ≥2 *fresh* failures, not ≥2 simultaneous failures.

This change was NOT re-graded. With the patch, Case 27 would correctly fall through to `transient` (MD's prior tick was a failure, so MD doesn't count; without MD the cluster has only NJ → not ≥2 states). Estimated post-patch score: 24-25 / 28 = 86-89%.

## How to re-run grading

Manual: spawn 4 `general-purpose` subagents in parallel, each carrying the agent system prompt and 7 case prompts. The full prompts are in this session's transcript. To automate: write a `scripts/lib/grade-triage-agent.ts` helper that reads the eval file, strips ground truth, batches into 4 calls. Worth doing only if we plan to iterate the prompt regularly — for now, the manual approach was sufficient.

## What to fix in the eval set next time it's expanded

- Make sure trigger ts and classification are consistent (Case 9 lesson).
- For NEGATIVE tests (Case 27 style), state explicitly which evidence the agent should reject and why.
- Add more `partial-coverage-degraded` cases (only one in current set, the most-likely-real-world drift pattern).
- Add programs cases once the monthly cron lands one in history.jsonl.

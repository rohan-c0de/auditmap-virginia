# state-health-triage — evaluation set

Ground-truth classifications for the `state-health-triage` agent (not yet written). Each case is a real situation drawn from `data/state-health/history.jsonl` (Apr 30 – May 24, 2026 seed window). The agent is run against each case; if its classification matches the **Classification** below and its reasoning covers the **Key signals**, the case passes.

Target accuracy before shipping the agent: ≥80% match on Classification, ≥60% of cases hit all Key signals.

---

## Classification taxonomy

The agent must output exactly one of these labels per (state, datatype, job_index) triplet. Labels were chosen to map directly to weekly-rollup-issue sections; if a new pattern emerges that doesn't fit, prefer adding a new label over stretching an existing one.

| Label | Meaning | Recommended action |
|-------|---------|--------------------|
| `known-acceptable` | Registry has an explicit `// manual-only:` marker or `scrapers: {}` opt-out covering this failure | No action — suppress from rollup |
| `registry-evolution` | History shows this (state, datatype, job_index) used to run but current registry no longer declares it | No action — suppress from rollup; this is just a stale historical signal |
| `persistent-broken` | ≥3 consecutive failures, currently declared in registry, no recent successes in window | Open or update investigation issue |
| `regression` | Last 1–2 ticks failed but ≥3 prior consecutive successes in window | Watch — if it persists to ≥3 fails, escalate to `persistent-broken` |
| `transient` | One isolated failure surrounded by successes (1 fail in last 8+ ticks) | No action |
| `recovered` | Past failures present in window but ≥3 most-recent ticks are healthy | No action — close any open investigation issue for this scraper |
| `infrastructure-incident` | Multiple unrelated states failed at the same `ts` then recovered together | No action per-state — note the run as suspect |
| `partial-coverage-degraded` | One matrix job for this state failed but other jobs for same state+datatype are healthy in same tick | Open scraper-scoped issue (not state-scoped) |
| `stable-healthy` | All ticks in window are success, no failures | No action — proof of life only |
| `new-scraper-no-history` | Current registry declares this scraper but history.jsonl has zero records for it | Watch — first cron tick will produce real signal |
| `external-issue-resolved` | An open rolling-issue or per-state issue claims this is broken but live record shows healthy | Comment on / close the stale issue |

---

## Background context the agent is allowed to use

- The full `data/state-health/history.jsonl` file (append-only JSONL; one record per state × scraper-job × tick).
- The current `lib/states/registry.ts` and per-state `lib/states/{state}/config.ts` files — specifically the `scrapers` field and any `// manual-only:` comments.
- The current open rolling issues (`gh issue list --label scraper-health`) — bodies + last-updated timestamp.
- For a small number of cases, the agent may need to look at run logs (`gh run view --log-failed`) but this is expensive; prefer history-derived signal.

The agent must NOT modify files, push commits, open or close issues directly. Output is a markdown rollup the user reviews.

---

## Cases

### Case 1 — VA courses cancellation, registry opt-out
**Classification:** `known-acceptable`

**Trigger (most recent tick for va/courses):**
```
ts: 2026-05-20T09:41:25Z, state: va, datatype: courses, job_index: 1, conclusion: cancelled
```

**Recent history (va, courses, job 1):** All 16 ticks in window show `cancelled`. No successes ever.

**Registry context:** `lib/states/va/config.ts` declares `scrapers: {}` with the comment `// manual-only: courses — VA PeopleSoft scraper consistently exceeds the 6h GitHub Actions timeout; run manually when needed.`

**Key signals the agent must surface:**
- `cancelled` (not `failure`) — typically GitHub Actions cancelled due to timeout
- Registry has explicit `manual-only` documentation for this exact reason
- Pattern is 100% consistent (no flapping)

**Reasoning:** The failure mode is documented and the registry has already opted out of scheduled runs. Alerting on this is noise.

---

### Case 2 — VA courses job 0 historical flapping after registry removal
**Classification:** `registry-evolution`

**Trigger:** No tick after May 20, 2026 for va/courses/job_0.

**Recent history (va, courses, job 0):**
```
Apr 30 – May 3 morning: cancelled (×5)
May 3 evening – May 8: success (×6)
May 11: cancelled (×1 flap)
May 13 – May 20: success (×4)
```

**Registry context:** Current `lib/states/va/config.ts` has `scrapers: {}` — no courses scraper declared at all.

**Key signals:** Mixed past behavior (some successes, some cancellations); but no current declaration means none of it is actionable now.

**Reasoning:** History shows this matrix job used to exist; current registry no longer declares it. Stale signal. Agent should recognize that "no current declaration" overrides any historical drift pattern.

---

### Case 3 — MD courses job 0, 10-day outage then recovery
**Classification:** `recovered`

**Trigger:** `ts: 2026-05-24T15:59:32.654Z, state: md, datatype: courses, job_index: 0, status: healthy`

**Recent history (md, courses, job 0):**
```
Apr 30 – May 1: success (×2)
May 1 22:12 – May 11: failure (×8 consecutive)
May 13 – May 24: success (×6 consecutive, including live healthy)
```

**Registry context:** `md` has active `scrapers.courses` declarations; nothing about manual-only.

**Key signals:**
- ≥3 most-recent ticks are healthy
- Failures are present in window but trailing edge is clean
- Recovery point (May 13) is sharp, not flapping

**Reasoning:** Was broken for 10 days (May 1–11), fixed between May 11 and May 13. Currently stable. If a per-state investigation issue was opened during the outage, this is the cue to close it.

---

### Case 4 — MD courses job 1, stable parallel to job 0's outage
**Classification:** `stable-healthy`

**Trigger:** `ts: 2026-05-24, state: md, job_index: 1, status: healthy`

**Recent history (md, courses, job 1):** All 16 ticks in window show `success` / `healthy`.

**Key signals:** Zero failures; not affected by job 0's outage.

**Reasoning:** Different scraper script within the same state. Useful as a counter-example: just because `md/courses` had problems doesn't mean every md scraper did. Helps the agent reason about per-job granularity.

---

### Case 5 — WV courses, never succeeded since first appearance
**Classification:** `persistent-broken`

**Trigger:** `ts: 2026-05-24T15:59:32.654Z, state: wv, datatype: courses, job_index: 0, status: failed`

**Recent history (wv, courses, job 0):**
```
2026-05-18T10:13:18Z: failure
2026-05-20T09:41:25Z: failure
2026-05-24T15:59:32.654Z: failure (live)
```
Only 3 records total. No success ever in window.

**Registry context:** `lib/states/wv/config.ts` declares `scrapers.courses` including `scripts/wv/scrape-eastern-wv.ts`. No `manual-only` marker.

**Key signals:**
- 3 consecutive failures
- First appearance May 18 (no earlier records) — suggests new scraper added then
- Registry says it should run, but it has yet to produce data

**Reasoning:** This is the classic "added but never worked" pattern. Distinct from a regression because there's no prior success to regress from. Likely indicates the scraper has a bug it ships with, or the SIS endpoint changed after fingerprinting.

---

### Case 6 — HI courses regression
**Classification:** `regression`

**Trigger:** `ts: 2026-05-24T15:59:32.654Z, state: hi, datatype: courses, job_index: 0, status: failed`

**Recent history (hi, courses, job 0):**
```
2026-05-18T10:13:18Z: success
2026-05-20T09:41:25Z: success
2026-05-24T15:59:32.654Z: failed (live)
```

**Registry context:** `hi` is currently in registry with active courses scraper.

**Key signals:**
- Last tick failed
- Previous 2 ticks were success
- Only 3 ticks of history — not enough yet to call `persistent-broken`

**Reasoning:** Broke between May 20 and May 24. Could be transient (one-off) or the start of a real regression. Watch next 1–2 ticks; if it stays failed, reclassify as `persistent-broken`.

---

### Case 7 — OR courses, only job 0 broken
**Classification:** `partial-coverage-degraded`

**Trigger (or, courses, multiple jobs at same ts):**
```
2026-05-24T15:59:32.654Z: job 0 → failed
2026-05-24T15:59:32.654Z: job 1 → healthy
2026-05-24T15:59:32.654Z: job 2 → healthy
2026-05-24T15:59:32.654Z: job 3 → healthy
2026-05-24T15:59:32.654Z: job 4 → healthy
2026-05-24T15:59:32.654Z: job 5 → healthy
```

**Recent history (or, courses, job 0):** Live failure is the first record we have for OR job 0. Other OR jobs all healthy.

**Registry context:** `or` has multiple scraper scripts grouped into 6 matrix jobs.

**Key signals:**
- One matrix job failed
- 5 sibling matrix jobs at same tick are healthy
- Same state, same datatype, different scripts

**Reasoning:** This is a per-scraper bug, not a per-state bug. The right investigation scope is the specific script in job 0 (likely `scripts/or/scrape-banner-ssb.ts` per issue #124). State-scoped issue would be wrong framing.

---

### Case 8 — NC courses, recovered from past failures
**Classification:** `recovered`

**Trigger:** `ts: 2026-05-24, state: nc, datatype: courses, job_index: 0 + 1, status: healthy`

**Recent history (nc, courses):** 29 successes + 3 historical failures scattered earlier in window. Last 6+ ticks all healthy.

**Registry context:** `nc` is fully featured; courses scrapers are stable.

**Key signals:**
- 3 historical failures present (somewhere mid-window)
- Trailing edge clean — most recent ≥3 ticks healthy

**Reasoning:** Past instability is now resolved. Suppress from current rollup. Useful for the agent to recognize that `recovered` ≠ `stable-healthy`: NC had real problems recently and that's worth tracking quarterly even if not weekly.

---

### Case 9 — NJ courses, one isolated failure
**Classification:** `transient`

**Trigger:** `ts: 2026-05-24, state: nj, datatype: courses, status: healthy`

**Recent history (nj, courses, job 0):** 14 ticks total in window. 1 failure (May 4 00:01:17Z). 13 successes including all of last 5 ticks.

**Key signals:**
- Single failure
- Surrounded by successes both before and after
- No correlated failures at that timestamp (only NJ job 0 failed; other states succeeded)

**Reasoning:** Likely a transient network or runner-availability issue. Single events are noise.

---

### Case 10 — DC + CT simultaneous failure (May 3 incident)
**Classification:** `infrastructure-incident`

**Trigger (multiple states, same ts):**
```
2026-05-03T02:30:05Z: dc courses → failure
2026-05-03T02:46:28Z: dc courses → failure
2026-05-03T02:30:05Z: ct courses → failure
2026-05-03T02:46:28Z: ct courses → failure
2026-05-03T02:30:05Z: md courses → failure (part of MD's longer outage)
```

**Recent history:** DC and CT both stable before and after May 3. Both back to success by May 3 23:45.

**Key signals:**
- Multiple unrelated states failed within a 16-minute window
- All failures clustered at one cron-tick burst (likely two retries close together)
- Same datatype across all affected states

**Reasoning:** When N ≥ 2 unrelated states fail at the same ts with no shared scraper code, the failure is almost certainly infrastructure (GitHub Actions runners, network, registry resolution). Do NOT alert per-state. Surface as one suspect-run note in the rollup.

(Note: MD also failed at the same ts but MD has its own separate persistent outage Apr 30 – May 11. The agent should not lump MD into the DC/CT cluster.)

---

### Case 11 — CT courses also confirmed recovered
**Classification:** `recovered`

**Trigger:** `ts: 2026-05-24, state: ct, datatype: courses, job_index: 0, status: healthy`

**Recent history (ct, courses, job 0):** May 3 had 2 failures (the infrastructure incident). Every other tick is success. Last ~10 ticks all healthy.

**Key signals:** Failures localized to the May 3 incident, full recovery since.

**Reasoning:** Slightly subtle — the May 3 failure should be classified as `infrastructure-incident` for the rollup, but the *current state* of ct/courses is `recovered`. These are two different framings: the rollup section "May 3 infrastructure incident" includes the failure event; the state-by-state status table marks ct/courses as recovered.

---

### Case 12 — FL transfers regression
**Classification:** `regression`

**Trigger:** `ts: 2026-05-24T15:59:34.366Z, state: fl, datatype: transfers, job_index: 0, status: failed, detail: "matrix job conclusion=failure"`

**Recent history (fl, transfers, job 0):**
```
2026-05-09T10:52:32Z: success
2026-05-13T11:59:13Z: success
2026-05-16T10:58:22Z: success
2026-05-20T12:18:26Z: success
2026-05-24T15:59:34.366Z: failure (live)
```

**Registry context:** `fl` has active transfers scraper declared; no manual-only marker.

**Key signals:**
- 4 consecutive successes
- Most recent tick failed
- This is the only recent transfers failure across all states

**Reasoning:** Transfer scrapers (state articulation portals) tend to be more stable than course scrapers because portals change less often. A regression here is more likely to indicate a real portal change (URL moved, login wall added) than a transient. Worth a `regression` flag and watching the next transfers cron tick (Wed/Sat).

---

### Case 13 — ME transfers, very old failure long resolved
**Classification:** `recovered`

**Trigger:** `ts: 2026-05-24T15:59:34.366Z, state: me, datatype: transfers, status: healthy`

**Recent history (me, transfers, job 0):**
```
2026-04-30T04:18:55Z: failure (first record in window)
2026-05-02 onward: success (×6+)
2026-05-24: healthy (live)
```

**Key signals:**
- One failure at the very start of window
- ≥6 consecutive successes since
- Failure is >3 weeks old

**Reasoning:** Resolved long ago. Don't surface. Could even be filtered from the window for being too stale, but the eval prefers explicit `recovered` over silent omission to give the agent practice with old-but-clean cases.

---

### Case 14 — ME prereqs, contradicts open issue #474
**Classification:** `external-issue-resolved`

**Trigger:** `ts: 2026-05-24T15:59:35.665Z, state: me, datatype: prereqs, status: healthy, detail: "prereqs.json present (115412 bytes)"`

**Recent history:** Only 2 records for me/prereqs in window (May 17 success, May 24 healthy). Both successful.

**External context:** Rolling issue #474 "Scraper health — prereqs" (last updated 2026-05-24T09:29:30Z, before our live snapshot) lists `me` under the `empty` section: `prereqs.json is empty (2 bytes)`.

**Key signals:**
- Live record contradicts the rolling-issue claim
- Live timestamp is later than rolling-issue update
- File size jumped from 2 bytes → 115 KB between the rolling-issue tick and the live snapshot

**Reasoning:** Someone (probably the user) populated `data/me/prereqs.json` between the cron tick that wrote #474 and our live check. The rolling issue is stale. The agent should comment on #474 with this finding so the user can close the empty-state entry.

---

### Case 15 — SC courses, baseline stable
**Classification:** `stable-healthy`

**Trigger:** `ts: 2026-05-24, state: sc, datatype: courses, status: healthy`

**Recent history (sc, courses):** 32 success records across both jobs throughout the entire window. Zero failures.

**Reasoning:** Reference baseline. The agent should emit a small "stable" section for these so the user can see proof of life across the fleet. If `stable-healthy` ever drops out of the rollup, that's itself a signal worth investigating.

---

### Case 16 — NY courses, baseline stable
**Classification:** `stable-healthy`

**Trigger:** `ts: 2026-05-24, state: ny, datatype: courses, status: healthy`

**Recent history:** 16 successes, zero failures.

**Reasoning:** Same as Case 15. Multiple stable cases let the agent confirm the "everything fine" pattern rather than just learning failure shapes.

---

### Case 17 — PA transfers, single-scraper stable
**Classification:** `stable-healthy`

**Trigger:** `ts: 2026-05-24, state: pa, datatype: transfers, status: healthy`

**Recent history (pa, transfers, job 0):** 14 successes, zero failures.

**Reasoning:** Note this is on the *transfers* side, which has a much sparser cadence (W/Sa) than courses. Stable across both transfer ticks per week and the live snapshot.

---

### Case 18 — TX courses, recently added, all successful
**Classification:** `stable-healthy`

**Trigger:** `ts: 2026-05-24, state: tx, datatype: courses, status: healthy` (×4 jobs)

**Recent history (tx, courses):** First records appear 2026-05-18 (5 days before live snapshot). 3 successful ticks across 4 matrix jobs since.

**Key signals:**
- New entry in registry, but every observation has been success
- 12 total success records, zero failures

**Reasoning:** New state but the scraper works. Distinguish this from `new-scraper-no-history` (next case): TX has *some* history, all positive. The agent should not penalize a state for being new if its records are clean.

---

### Case 19 — AZ / CA / OH courses, declared but zero records
**Classification:** `new-scraper-no-history`

**Trigger:** No records in `data/state-health/history.jsonl` for `az/courses`, `ca/courses`, `oh/courses`, `mo/courses`.

**Registry context:** `az`, `ca`, `oh`, `mo` all declare `scrapers.courses` in current registry. (They were filtered out of the live snapshot as "matrix job not found in workflow run" because the anchor run predated their addition.)

**Key signals:**
- Registry declares scrapers
- Zero observations
- States were added to registry between the most recent historical run and now

**Reasoning:** Cannot classify as broken or healthy without data. Surface as "watch — first cron tick will produce signal" and re-evaluate after one M/W/F cycle. Important: do NOT classify as `persistent-broken` just because there's no success record.

---

### Case 20 — MS prereqs, one tick, healthy
**Classification:** `stable-healthy`

**Trigger:** `ts: 2026-05-24, state: ms, datatype: prereqs, status: healthy`

**Recent history (ms, prereqs, job 0):** 2 records total in window (May 17 success + May 24 healthy live).

**Key signals:** All observations positive, but only 2 datapoints.

**Reasoning:** Sparse-but-clean. Distinct from `new-scraper-no-history` because there IS history; just not much. Agent should call it stable but note low sample size for any quarterly trend analysis.

---

### Case 21 — VA courses job 0 historical flap (Apr 30 – May 11)
**Classification:** `registry-evolution`

**Trigger:** No current record (filtered out; va has no current scrapers declared).

**Recent history:** As detailed in Case 2 — alternating cancelled/success/cancelled/success.

**Key signals:** Behavior was inconsistent. Then registry was changed to remove va/courses entirely.

**Reasoning:** A pre-removal flap. After removal, the records become historical only. Same root classification as Case 2 (different framing). Worth including because the agent will need to handle the same pattern from different angles (one a job_index=1 cancelled-only, one a job_index=0 mixed-history). Both → registry-evolution.

---

### Case 22 — VT courses, sparse stable
**Classification:** `stable-healthy`

**Trigger:** `ts: 2026-05-24, state: vt, datatype: courses, status: healthy`

**Recent history (vt, courses, job 0):** 16 successes, zero failures across whole window.

**Reasoning:** Same shape as SC/NY but for a single-college state (VT has only one community college system). The agent should not weight a one-college state lower than a multi-college state — both are equally "stable."

---

### Case 23 — KY courses, mid-window addition, all healthy
**Classification:** `stable-healthy`

**Trigger:** `ts: 2026-05-24, state: ky, datatype: courses, status: healthy`

**Recent history (ky, courses, job 0):** First record May 8 or so; consistent successes through window. ~7 ticks.

**Reasoning:** Like TX in Case 18 but a smaller sample. Tells the agent that "added mid-window" is fine as long as records are clean.

---

### Case 24 — NV transfers + NV prereqs, one-record cases
**Classification:** `stable-healthy` (each)

**Trigger:** `state: nv, datatype: transfers, status: healthy` (one record); same for `nv, prereqs`.

**Recent history:** Single observation in window for each.

**Key signals:** Very sparse. Both successful.

**Reasoning:** Edge case for the agent — one datapoint is the bare minimum to classify as anything other than `new-scraper-no-history`. The agent should NOT refuse to classify and should NOT escalate to `regression` for single positive observations. "Stable but sparse" is the right call.

---

### Case 25 — NJ transfers, multi-week stable
**Classification:** `stable-healthy`

**Trigger:** `ts: 2026-05-24T15:59:34.366Z, state: nj, datatype: transfers, status: healthy`

**Recent history (nj, transfers, job 0):**
```
2026-05-06T11:44:55Z: success
2026-05-09T10:52:32Z: success
2026-05-13T11:59:13Z: success
2026-05-16T10:58:22Z: success
2026-05-20T12:18:26Z: success
2026-05-24T15:59:34.366Z: healthy
```

**Reasoning:** 6 consecutive successes on the transfers cadence. Counterweight to the FL transfers regression in Case 12 — shows the agent that not every transfers scraper is fragile; FL is genuinely an outlier.

---

### Case 26 — VA transfers cancelled, same shape as Case 1
**Classification:** `known-acceptable`

**Trigger:** `state: va, datatype: transfers, job_index: 0, conclusion: cancelled` (historical, multiple ticks)

**Registry context:** Same as Case 1 — `lib/states/va/config.ts` has `// manual-only: transfers` comment.

**Reasoning:** Cross-datatype version of Case 1. Tests that the agent applies the manual-only signal across all four datatypes when the registry has the marker, not just to courses.

---

### Case 27 — Run 25294595320 (May 4 00:01), large multi-state cluster
**Classification:** `infrastructure-incident`

**Trigger:** Run 25294595320 (2026-05-04T00:01:17Z) has multiple state failures in the same window:
- `dc courses → success (recovered same run)`
- `nj courses job 0 → failure`
- `md courses job 0 → failure` (part of its own outage)
- `va courses job 1 → cancelled`

**Key signals:**
- Three close-together runs on May 4 between 00:01 and 08:35 — looks like cron retries
- Mix of failure / cancelled / success across states within minutes of each other

**Reasoning:** Subtler than the May 3 incident (Case 10) — cancellations and failures are mixed, MD has its own ongoing outage, NJ is the lone clean fail-and-recover. The agent must NOT conclude this is a global infrastructure issue just because multiple things failed in a tight window. Without clear "many unrelated states failed identically and recovered identically" signature, this is just normal noise + MD's outage continuing. Classification edge case: prefer `transient` for NJ (Case 9) over `infrastructure-incident` here, because the signature isn't strong enough.

---

### Case 28 — MA courses, fully stable across both jobs
**Classification:** `stable-healthy`

**Trigger:** `ts: 2026-05-24, state: ma, courses, status: healthy` (job 0 + job 1)

**Recent history:** 26 successful records across both jobs in window.

**Reasoning:** Reference case for a two-job state where both jobs are clean. Lets the agent practice multi-job aggregation: when all matrix jobs for a state are stable-healthy, the state-level summary is also stable-healthy.

---

## How to use this file

1. To grade the agent: feed each Case's **Trigger** and **Recent history** plus the file path to `data/state-health/history.jsonl` and the registry. Compare the agent's classification + reasoning to the Case's ground truth.
2. A case **passes** if classification matches exactly AND the agent's reasoning mentions ≥1 Key signal listed in the case.
3. Target: ≥80% pass rate before shipping the agent into the weekly cron.
4. When iterating the agent's system prompt, focus first on the **mis-classifications** (false labels), then on **incomplete reasoning** (right label, weak justification). Don't try to fix everything at once.

## Notes for whoever extends this eval

- The seed dataset (623 records, Apr 30 – May 24, 2026) is shallow on certain patterns: programs is absent entirely; `partial-coverage-degraded` only shows up via OR; `infrastructure-incident` only has one strong instance (May 3). Future expansion should target these gaps deliberately rather than just adding more cases of the over-represented `stable-healthy` shape.
- The 11-label taxonomy may collapse over time as the agent runs in production. If two labels never differ in recommended action, merge them.
- When the live `--history-out` wiring lands in CI (separate follow-up PR), real cron records will arrive every M/W/F/Sa/Sun. The eval set should be re-checked against any new patterns at that point and extended if needed.

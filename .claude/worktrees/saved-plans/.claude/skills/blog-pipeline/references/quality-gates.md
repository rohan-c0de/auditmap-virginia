# Quality gates

Every gate is a hard block. A draft that fails any gate does not become a PR. The goal is to surface problems to the human, not to silently retry until something passes — silent retries hide systematic drafter issues.

## Gate list (all must pass)

### G1 — Word count within BRIEF.md range
- Focused explainer (`articleType: general` and topic is conceptual): 600–1200 words
- State spoke: 1000–1800 words
- Hub: 1500–2500 words

Rationale: BRIEF.md says "match depth to topic, do not pad." Word counts catch both fluff (too long) and thin content (too short).

### G2 — Internal-link density
- ≥ 1 `<ProductCallout>` component OR a markdown link to a tool page (`/{state}`, `/{state}/transfer`, `/{state}/colleges`, `/starting-soon`, `/blog`)
- ≥ 2 markdown links to other existing blog posts (slug must match an entry in `content/blog/index.ts`)
- For state-specific posts: at least 1 markdown link to a `/{state}/...` route (matches existing corpus convention; `<StateToolsCTA>` is wired into renderer chrome, not embedded in MDX)
- For cluster spokes: a link to the hub article AND a link to at least one sibling spoke

Rationale: BRIEF.md §"Internal linking rules" — these aren't suggestions, they're how the corpus compounds value.

### G3 — No banned phrases
The drafter is calibrated against BRIEF.md, but recent LLMs slip into marketing tone under load. The banned set:

- "Top N" / "Top 10" / "Top 5" headlines or H2s
- "comprehensive guide to all your" + anything
- "Look no further"
- "In today's world" / "In today's fast-paced"
- "your education needs"
- "unlock your potential"
- "game-changer" / "game-changing"
- Em-dash-led marketing colons ("Community College Path — your one-stop shop for…")
- Any sentence containing both "journey" and "education"

Rationale: BRIEF.md §"Tone rules" forbids hypey startup voice. These phrases are the most common drift signals.

### G4 — Embedding similarity vs existing corpus
- Compute embeddings (Voyage `voyage-3` or OpenAI `text-embedding-3-small`) for the new draft and every existing article in `content/blog/`.
- Reject if cosine similarity > **0.82** against any existing post.

Rationale: prevents accidental duplication when a trigger fires near an existing post's territory. The 0.82 threshold is calibrated for the current corpus — tune it as the corpus grows. State-specific posts often hit 0.78 against their hub legitimately, so 0.82 leaves headroom.

### G5 — Build passes
Run `npm run build`. The MDX must compile, the `ArticleMeta` insert must typecheck, and Next must successfully generate the static page for the new slug.

Rationale: catches malformed frontmatter, MDX syntax errors, broken JSX components, and slug collisions.

### G6 — BRIEF.md output block present
The drafter's output must include all nine items from BRIEF.md §"Output expectations":
1. Recommended title
2. Article type
3. Target reader
4. Search intent
5. Strategic rationale
6. Review-cadence flag (yes/no + reason)
7. Full draft
8. Suggested internal link opportunities
9. Companion article suggestions (or explicit "none")

The PR body uses items 1–6 and 8–9 as the strategic-framing section. If any are missing, the PR body would be incomplete.

## What gates intentionally do NOT check

- Tone subtlety (sycophancy, hedging, over-qualification) — humans catch this on review
- Factual accuracy — the human reviewer must verify against the data slice
- "Is this topic worth writing" — that's the trigger's job, not the gate's
- Grammar and spelling — Next/MDX build catches the structural stuff; prose-level issues are reviewer territory

The gates are a tripwire for systematic failure modes, not a substitute for editorial review. If you find yourself adding gates to catch increasingly subtle issues, the drafter prompt needs work instead.

## Gate output format

`scripts/quality-gates.ts` exits non-zero on failure and writes a JSON report to stdout:

```json
{
  "draft": "<slug>",
  "gates": [
    {"id": "G1", "passed": true, "detail": "1240 words, within state-spoke range"},
    {"id": "G2", "passed": false, "detail": "Only 1 article-to-article link found (need 2)"},
    {"id": "G3", "passed": true, "detail": "No banned phrases"},
    {"id": "G4", "passed": true, "detail": "Max similarity 0.71 vs slug 'virginia-...' "},
    {"id": "G5", "passed": true, "detail": "npm run build succeeded"},
    {"id": "G6", "passed": true, "detail": "All 9 output items present"}
  ],
  "verdict": "fail",
  "blockingGates": ["G2"]
}
```

On a fail verdict, the calling stage reports which gate failed and stops. Do not edit the draft to satisfy the gate — that masks whether the prompt template actually works.

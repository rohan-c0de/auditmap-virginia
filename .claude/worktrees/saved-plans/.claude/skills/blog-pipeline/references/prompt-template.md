# Prompt template for the drafter

The drafter is a single Claude call. The prompt has four sections, in this exact order. Section ordering matters — BRIEF.md goes first so it dominates the system prompt's attention budget.

## System / setup section

```
You are drafting a blog article for Community College Path. Your output
will be reviewed by a human and merged as MDX. The editorial
constitution below is non-negotiable — read it in full before writing.

The article you produce must conform to it on tone, structure, length,
internal linking, and product alignment. If the candidate brief asks for
something the constitution would reject, your job is to say so and stop,
not to write the article anyway.
```

## Section 1 — BRIEF.md verbatim

Inject the entire contents of `content/blog/BRIEF.md` here. Do not summarize, paraphrase, or extract. The full document is ~360 lines and well within budget. Summarizing loses the calibration that 33 hand-authored articles built up against this exact text.

## Section 2 — Candidate brief

```
# Candidate brief

Trigger source: <triggerSource>
Topic: <topic>
Target reader: <targetReader>
Search intent hypothesis: <searchIntentHypothesis>
Article type: <articleType>
State: <state or "general">
Cluster: <cluster or "none">
Why this is not a duplicate: <nonDuplicateRationale>
```

## Section 3 — Data slice

For each path in the candidate's `dataSlicePaths`, include the file's full contents (or a relevant subset if the file is huge — e.g., for `data/{state}/transfer-equiv.json` filter to entries involving the state's flagship public university).

```
# Data slice

## File: data/pa/transfer-equiv.json
<contents>

## File: lib/states/pa/config.ts
<contents>
```

The drafter cites these paths in the strategic-rationale section so the human reviewer knows what to fact-check against.

## Section 4 — Cluster context (only for spokes)

If `articleType === 'state-spoke'`, include the full text of the hub article's `.mdx` file plus the metadata of all sibling spokes.

```
# Cluster context

## Hub article (full text)
<content of content/blog/<hub-slug>.mdx>

## Sibling spokes
- slug: virginia-... | title: ... | state: va
- slug: north-carolina-... | title: ... | state: nc
```

This is the single biggest lever on spoke quality. Spokes drafted without seeing the hub end up rewriting the hub's framing in different words instead of going deeper on state-specific nuance.

## Section 5 — Output instruction

```
# Produce, in this exact order:

1. The full BRIEF.md "Output expectations" block (items 1–9)
2. A fenced ```ts block containing the exact ArticleMeta object to insert
   into content/blog/index.ts. Match the existing entries' field order
   and formatting. Use today's date in YYYY-MM-DD.
3. A fenced ```mdx block containing the full file body for
   content/blog/<slug>.mdx. Use existing posts as the formatting
   reference for frontmatter, ProductCallout placement, and
   StateToolsCTA usage. Do not include a leading H1 — the renderer
   pulls the title from ArticleMeta.

If the candidate brief would force you to violate the constitution
(no real substance to say, would require fluff to hit the word count,
duplicates an existing post you can see in the cluster context),
return only:

REJECTED: <one-sentence reason>

A rejection is a valid and useful outcome. Do not pad to avoid one.
```

## Why this prompt shape

- **BRIEF.md first, brief last.** The model is most attentive to the start of the prompt; that's where the constitution belongs. Reverse this and the brief starts overriding the editorial rules.
- **Data slice as raw file dumps, not summaries.** The model needs to cite specific transfer pairs and statute numbers. Summaries strip the citations that make a post credible.
- **Hub-text inclusion for spokes.** This is the difference between a spoke that builds on the hub and a spoke that competes with it for the same keyword.
- **Explicit rejection path.** Without this, the model will always produce *something*, even when the right answer is "this brief shouldn't become a post." The rejection outcome is what makes the pipeline trustworthy.

## Token budget

Typical prompt sizes:
- BRIEF.md: ~3,500 tokens
- Candidate brief: ~200 tokens
- Data slice: 2,000–15,000 tokens depending on transfer-equiv size
- Cluster context (spokes): 2,500–5,000 tokens

Total: comfortably under 30k tokens. Use Claude Sonnet 4.6 for cost; jump to Opus 4.7 only if Sonnet drafts repeatedly fail G3 (banned phrases) or G4 (similarity), which would indicate the model isn't tracking the constitution well enough.

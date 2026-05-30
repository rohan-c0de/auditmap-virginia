#!/usr/bin/env tsx
/**
 * Run quality gates against a draft.
 * See ../references/quality-gates.md for the gate definitions.
 *
 * Usage: npx tsx .claude/skills/blog-pipeline/scripts/quality-gates.ts \
 *   --draft /tmp/blog-draft.json --slug pa-senior-waivers
 *
 * The draft JSON must include: { mdx: string, meta: ArticleMeta, articleType: "general"|"state-spoke"|"college-spoke"|"hub" }
 *
 * G4 (embedding similarity) and G5 (build) are skipped here because they
 * need external API keys and a full repo build respectively. The skill
 * workflow handles those in stage 4 directly. Everything else runs here.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { articles, type ArticleMeta } from "../../../../content/blog/index";

type Draft = {
  mdx: string;
  meta: ArticleMeta;
  articleType: "general" | "state-spoke" | "college-spoke" | "hub";
};

type GateResult = {
  id: string;
  passed: boolean;
  detail: string;
};

const BANNED_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\btop\s*(?:5|10|n)\b/i, label: "Top N framing" },
  { pattern: /comprehensive guide to all your/i, label: "Marketing umbrella phrasing" },
  { pattern: /look no further/i, label: "Look no further" },
  { pattern: /in today'?s (world|fast-paced)/i, label: "In today's world / fast-paced" },
  { pattern: /your education needs/i, label: "Your education needs" },
  { pattern: /unlock your potential/i, label: "Unlock your potential" },
  { pattern: /game-?chang(ing|er)/i, label: "Game-changer" },
  { pattern: /journey[\s\S]{0,80}education|education[\s\S]{0,80}journey/i, label: "Journey + education co-occurrence" },
];

const TOOL_LINK_PATTERNS = [
  /\/[a-z]{2}\/transfer/, // /va/transfer
  /\/[a-z]{2}\/colleges/,
  /\/starting-soon/,
  /<ProductCallout/,
  /href="\/[a-z]{2}"/, // state landing
];

function wordCount(mdx: string): number {
  // Strip frontmatter and JSX tags before counting. The JSX regex requires
  // the tag start with `<` (or `</`) immediately followed by a letter, so
  // bare `<` characters in prose ("< 7% hybrid") and tables don't trigger
  // a greedy multi-line match that swallows real article content.
  const body = mdx
    .replace(/^---[\s\S]*?---/, "")
    .replace(/<\/?[A-Za-z][^>]*>/g, " ")
    .replace(/```[\s\S]*?```/g, " ");
  return body.trim().split(/\s+/).filter(Boolean).length;
}

function gateG1(draft: Draft): GateResult {
  const wc = wordCount(draft.mdx);
  const ranges = {
    general: [600, 1200],
    "state-spoke": [1000, 1800],
    "college-spoke": [800, 1500],
    hub: [1500, 2500],
  } as const;
  const [lo, hi] = ranges[draft.articleType];
  const passed = wc >= lo && wc <= hi;
  return {
    id: "G1",
    passed,
    detail: `${wc} words; range for ${draft.articleType} is ${lo}–${hi}`,
  };
}

function gateG2(draft: Draft): GateResult {
  const failures: string[] = [];

  const hasToolLink = TOOL_LINK_PATTERNS.some((p) => p.test(draft.mdx));
  if (!hasToolLink) failures.push("no tool-page link or <ProductCallout>");

  const existingSlugs = new Set(articles.map((a) => a.slug));
  const linkedSlugs = Array.from(
    draft.mdx.matchAll(/\/blog\/([a-z0-9-]+)/g)
  ).map((m) => m[1]);
  const validLinkedSlugs = linkedSlugs.filter((s) => existingSlugs.has(s));
  if (validLinkedSlugs.length < 2) {
    failures.push(
      `only ${validLinkedSlugs.length} valid article-to-article link(s) (need 2)`
    );
  }

  if (draft.meta.state) {
    const stateLinkPattern = new RegExp(`/${draft.meta.state}(/|"|\\))`, "g");
    const stateLinkCount = (draft.mdx.match(stateLinkPattern) ?? []).length;
    if (stateLinkCount < 1) {
      failures.push(
        `state-specific post has no markdown link to /${draft.meta.state}/...`
      );
    }
  }

  if (
    (draft.articleType === "state-spoke" ||
      draft.articleType === "college-spoke") &&
    draft.meta.cluster
  ) {
    const hub = articles.find(
      (a) => a.cluster === draft.meta.cluster && a.clusterRole === "hub"
    );
    if (hub) {
      const hubLinked = draft.mdx.includes(`/blog/${hub.slug}`);
      if (!hubLinked) failures.push("spoke does not link back to its hub");

      const siblings = articles.filter(
        (a) =>
          a.cluster === draft.meta.cluster &&
          a.clusterRole === "spoke" &&
          a.slug !== draft.meta.slug
      );
      const siblingLinked = siblings.some((s) =>
        draft.mdx.includes(`/blog/${s.slug}`)
      );
      if (siblings.length > 0 && !siblingLinked) {
        failures.push("spoke does not link to any sibling spoke");
      }
    }
  }

  return {
    id: "G2",
    passed: failures.length === 0,
    detail: failures.length === 0
      ? "internal-link requirements met"
      : failures.join("; "),
  };
}

function gateG3(draft: Draft): GateResult {
  const hits = BANNED_PATTERNS.filter((b) => b.pattern.test(draft.mdx));
  return {
    id: "G3",
    passed: hits.length === 0,
    detail: hits.length === 0
      ? "no banned phrases"
      : `banned phrases: ${hits.map((h) => h.label).join(", ")}`,
  };
}

function gateG6(draft: Draft, outputBlock: string | null): GateResult {
  if (!outputBlock) {
    return {
      id: "G6",
      passed: false,
      detail: "no output block provided to gate runner",
    };
  }
  const required = [
    "title",
    "article type",
    "target reader",
    "search intent",
    "strategic",
    "review",
    "draft",
    "internal link",
    "companion",
  ];
  const lower = outputBlock.toLowerCase();
  const missing = required.filter((r) => !lower.includes(r));
  return {
    id: "G6",
    passed: missing.length === 0,
    detail: missing.length === 0
      ? "all 9 BRIEF.md output items present"
      : `missing items: ${missing.join(", ")}`,
  };
}

function parseArgs(): { draftPath: string; outputBlockPath: string | null } {
  const args = process.argv.slice(2);
  let draftPath = "";
  let outputBlockPath: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--draft") draftPath = args[++i];
    if (args[i] === "--output-block") outputBlockPath = args[++i];
  }
  if (!draftPath) {
    process.stderr.write("usage: --draft <path> [--output-block <path>]\n");
    process.exit(2);
  }
  return { draftPath, outputBlockPath };
}

function main() {
  const { draftPath, outputBlockPath } = parseArgs();
  if (!existsSync(draftPath)) {
    process.stderr.write(`[quality-gates] draft not found: ${draftPath}\n`);
    process.exit(2);
  }

  const draft = JSON.parse(readFileSync(draftPath, "utf-8")) as Draft;
  const outputBlock = outputBlockPath
    ? readFileSync(outputBlockPath, "utf-8")
    : null;

  const gates: GateResult[] = [
    gateG1(draft),
    gateG2(draft),
    gateG3(draft),
    gateG6(draft, outputBlock),
  ];

  const blocking = gates.filter((g) => !g.passed).map((g) => g.id);
  const verdict = blocking.length === 0 ? "pass" : "fail";

  const report = {
    draft: draft.meta.slug,
    gates,
    verdict,
    blockingGates: blocking,
    notes: "G4 (embedding similarity) and G5 (build) are run by the skill workflow, not this script.",
  };

  process.stdout.write(JSON.stringify(report, null, 2));
  process.exit(verdict === "pass" ? 0 : 1);
}

main();

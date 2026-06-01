/**
 * state-health-rollup.ts
 *
 * Weekly state-health rollup. Reads data/state-health/history.jsonl (last
 * 14 days), reads the current registry for each state involved, fetches
 * any open scraper-health rolling issues, then invokes the
 * state-health-triage agent (via the Anthropic API directly — no Claude
 * Code session needed) to classify every (state × datatype × job_index)
 * with recent activity.
 *
 * Output: a single GitHub issue titled "Weekly state-health rollup —
 * YYYY-MM-DD" with classifications grouped by category. Runs from a
 * scheduled GitHub Actions workflow (state-health-rollup.yml), so it
 * fires regardless of any local machine state — purely server-side.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... GH_TOKEN=... npx tsx scripts/lib/state-health-rollup.ts
 *   npx tsx scripts/lib/state-health-rollup.ts --dry-run
 *
 * Env vars:
 *   ANTHROPIC_API_KEY (required) — model invocation
 *   GH_TOKEN          (required unless --dry-run) — for `gh` issue ops
 *   GITHUB_REPOSITORY (CI-provided; falls back to gh repo view) — for run-url
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const HISTORY_PATH = "data/state-health/history.jsonl";
const AGENT_PATH = ".claude/agents/state-health-triage.md";
const WINDOW_DAYS = 14;
const TRAILING_PER_SCRAPER = 8;
const MODEL = "claude-sonnet-4-6";

interface HealthRecord {
  ts: string;
  run_id: string;
  run_url: string;
  datatype: "courses" | "transfers" | "prereqs" | "programs";
  state: string;
  job_index: number;
  scripts: string[];
  conclusion: string | null;
  status: "healthy" | "empty" | "failed" | "unknown";
  detail: string;
  colleges_missing?: string[];
}

interface Classification {
  state: string;
  datatype: string;
  job_index: number;
  classification: string;
  reasoning: string;
  key_signals: string[];
  recommended_action: string;
  issue_scope: string;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const dryRun = process.argv.includes("--dry-run");
const REPO = process.env.GITHUB_REPOSITORY ?? (() => {
  try {
    return execSync("gh repo view --json nameWithOwner --jq .nameWithOwner", {
      encoding: "utf8",
    }).trim();
  } catch {
    return "rohan-c0de/cc-coursemap";
  }
})();

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Missing ANTHROPIC_API_KEY env var");
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Step 1: gather inputs
// ---------------------------------------------------------------------------

function loadHistory(): HealthRecord[] {
  if (!existsSync(HISTORY_PATH)) {
    console.error(`History file ${HISTORY_PATH} missing`);
    process.exit(2);
  }
  const cutoff = Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return readFileSync(HISTORY_PATH, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as HealthRecord)
    .filter((r) => new Date(r.ts).getTime() >= cutoff);
}

function groupByScraper(records: HealthRecord[]): Map<string, HealthRecord[]> {
  const by = new Map<string, HealthRecord[]>();
  for (const r of records) {
    const k = `${r.state}|${r.datatype}|${r.job_index}`;
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push(r);
  }
  for (const [k, recs] of by) {
    recs.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
    by.set(k, recs.slice(0, TRAILING_PER_SCRAPER));
  }
  return by;
}

function loadRegistryContext(states: Set<string>): Map<string, string> {
  const ctx = new Map<string, string>();
  for (const s of states) {
    const path = `lib/states/${s}/config.ts`;
    if (!existsSync(path)) continue;
    // Extract just the `scrapers:` block + any nearby manual-only comments.
    // The full config file is too large; we only need the declaration shape.
    const full = readFileSync(path, "utf8");
    const start = full.indexOf("scrapers:");
    if (start < 0) {
      ctx.set(s, "// no scrapers field found in config");
      continue;
    }
    // Naive: take 600 chars after the `scrapers:` keyword. Captures the
    // declaration plus any `// manual-only:` comments before/inside.
    const before = full.lastIndexOf("\n", Math.max(0, start - 200));
    const slice = full.slice(Math.max(before, 0), Math.min(start + 800, full.length));
    ctx.set(s, slice);
  }
  return ctx;
}

interface OpenIssue {
  number: number;
  title: string;
  body: string;
  updatedAt: string;
}

function loadOpenScraperHealthIssues(): OpenIssue[] {
  try {
    const out = execSync(
      `gh issue list --label scraper-health --state open --limit 10 --json number,title,body,updatedAt --repo ${REPO}`,
      { encoding: "utf8", maxBuffer: 5 * 1024 * 1024 }
    );
    return JSON.parse(out) as OpenIssue[];
  } catch (err) {
    console.error("Could not fetch open scraper-health issues:", err);
    return [];
  }
}

function loadAgentSystemPrompt(): string {
  if (!existsSync(AGENT_PATH)) {
    console.error(`Agent file ${AGENT_PATH} missing`);
    process.exit(2);
  }
  // Use the entire file content (including frontmatter) as the system prompt.
  // The frontmatter is irrelevant prose from the model's perspective and
  // keeping it avoids drift between agent definition and rollup invocation.
  return readFileSync(AGENT_PATH, "utf8");
}

// ---------------------------------------------------------------------------
// Step 2: build the prompt and call the model
// ---------------------------------------------------------------------------

const ROLLUP_TOOL = {
  name: "emit_rollup",
  description:
    "Emit the classified rollup as a JSON array. Call this once with every (state, datatype, job_index) you classified.",
  input_schema: {
    type: "object" as const,
    properties: {
      classifications: {
        type: "array",
        description:
          "One entry per (state, datatype, job_index) you classified. Order by classification group: persistent-broken, regression, partial-coverage-degraded, infrastructure-incident, external-issue-resolved, new-scraper-no-history, recovered, transient, known-acceptable, registry-evolution, stable-healthy. Within each group, sort alphabetically by state then datatype.",
        items: {
          type: "object",
          properties: {
            state: { type: "string" },
            datatype: { type: "string" },
            job_index: { type: "number" },
            classification: {
              type: "string",
              enum: [
                "known-acceptable",
                "registry-evolution",
                "persistent-broken",
                "regression",
                "transient",
                "recovered",
                "infrastructure-incident",
                "partial-coverage-degraded",
                "stable-healthy",
                "new-scraper-no-history",
                "external-issue-resolved",
              ],
            },
            reasoning: { type: "string" },
            key_signals: { type: "array", items: { type: "string" } },
            recommended_action: { type: "string" },
            issue_scope: { type: "string" },
          },
          required: [
            "state",
            "datatype",
            "job_index",
            "classification",
            "reasoning",
            "key_signals",
            "recommended_action",
            "issue_scope",
          ],
        },
      },
    },
    required: ["classifications"],
  },
};

async function callModel(systemPrompt: string, userPrompt: string): Promise<Classification[]> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: systemPrompt,
    tools: [ROLLUP_TOOL],
    tool_choice: { type: "tool", name: "emit_rollup" },
    messages: [{ role: "user", content: userPrompt }],
  });
  for (const block of resp.content) {
    if (block.type === "tool_use" && block.name === "emit_rollup") {
      const input = block.input as { classifications: Classification[] };
      return input.classifications;
    }
  }
  throw new Error("Model did not return emit_rollup tool call");
}

// ---------------------------------------------------------------------------
// Step 3: render markdown
// ---------------------------------------------------------------------------

const GROUP_ORDER = [
  "persistent-broken",
  "regression",
  "partial-coverage-degraded",
  "infrastructure-incident",
  "external-issue-resolved",
  "new-scraper-no-history",
  "recovered",
  "transient",
  "known-acceptable",
  "registry-evolution",
  "stable-healthy",
];

const GROUP_EMOJI: Record<string, string> = {
  "persistent-broken": "🔴",
  regression: "🟠",
  "partial-coverage-degraded": "🟡",
  "infrastructure-incident": "⚡",
  "external-issue-resolved": "♻️",
  "new-scraper-no-history": "👀",
  recovered: "✅",
  transient: "🌀",
  "known-acceptable": "⚪",
  "registry-evolution": "⚪",
  "stable-healthy": "💚",
};

function renderMarkdown(results: Classification[], date: string, windowDays: number): string {
  const counts = new Map<string, number>();
  for (const r of results) counts.set(r.classification, (counts.get(r.classification) ?? 0) + 1);
  const total = results.length;

  const lines: string[] = [];
  lines.push(`# Weekly state-health rollup — ${date}`);
  lines.push("");
  lines.push(
    `Classified **${total} scrapers** with ≥1 record in the last ${windowDays} days.`
  );
  lines.push("");
  lines.push("**Summary:**");
  for (const g of GROUP_ORDER) {
    const c = counts.get(g) ?? 0;
    if (c === 0) continue;
    lines.push(`- ${GROUP_EMOJI[g]} \`${g}\` — ${c}`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const group of GROUP_ORDER) {
    const items = results.filter((r) => r.classification === group);
    if (items.length === 0) continue;
    lines.push(`## ${GROUP_EMOJI[group]} ${group} (${items.length})`);
    lines.push("");
    items.sort((a, b) =>
      a.state === b.state ? a.datatype.localeCompare(b.datatype) : a.state.localeCompare(b.state)
    );
    for (const r of items) {
      lines.push(
        `### \`${r.state}/${r.datatype}/${r.job_index}\` — ${r.recommended_action}`
      );
      lines.push("");
      lines.push(`**Reasoning:** ${r.reasoning}`);
      lines.push("");
      if (r.key_signals.length > 0) {
        lines.push("**Signals:**");
        for (const s of r.key_signals) lines.push(`- ${s}`);
        lines.push("");
      }
      if (r.issue_scope) {
        lines.push(`**Scope:** \`${r.issue_scope}\``);
        lines.push("");
      }
    }
  }

  lines.push("---");
  lines.push("");
  lines.push(
    `_Auto-generated by [state-health-rollup workflow](.github/workflows/state-health-rollup.yml). Triage agent definition: [.claude/agents/state-health-triage.md](.claude/agents/state-health-triage.md). Source data: [data/state-health/history.jsonl](data/state-health/history.jsonl)._`
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Step 4: create/update GitHub issue
// ---------------------------------------------------------------------------

function postIssue(title: string, body: string): void {
  writeFileSync("/tmp/rollup-body.md", body);
  // Each weekly rollup is a NEW issue — we don't update last week's. The
  // user wants a per-week history they can click back through, like the
  // existing rolling issues do for raw health.
  try {
    execSync(
      `gh issue create --repo ${REPO} --title "${title.replace(/"/g, '\\"')}" --body-file /tmp/rollup-body.md --label "state-health-rollup,automated"`,
      { encoding: "utf8", stdio: "inherit" }
    );
  } catch (err) {
    console.error("Failed to create GitHub issue:", err);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`State-health rollup (window=${WINDOW_DAYS}d, dry-run=${dryRun})`);

  const history = loadHistory();
  console.log(`  → ${history.length} records in window`);
  if (history.length === 0) {
    console.error("No history records in window; nothing to classify.");
    process.exit(0);
  }

  const grouped = groupByScraper(history);
  console.log(`  → ${grouped.size} distinct (state, datatype, job_index) triplets`);

  const states = new Set(history.map((r) => r.state));
  const registryCtx = loadRegistryContext(states);
  console.log(`  → registry context loaded for ${registryCtx.size} states`);

  const openIssues = loadOpenScraperHealthIssues();
  console.log(`  → ${openIssues.length} open scraper-health issues`);

  const systemPrompt = loadAgentSystemPrompt();
  console.log(`  → agent system prompt loaded (${systemPrompt.length} chars)`);

  // Build the user prompt: structured data the agent will reason over.
  const userParts: string[] = [];
  userParts.push("# Weekly rollup mode\n");
  userParts.push(
    `You are running in **rollup mode**. Classify every (state, datatype, job_index) triplet listed below. Call \`emit_rollup\` ONCE with the full classifications array. Order entries by the classification-group ordering specified in your system prompt.\n`
  );
  userParts.push(`Window: last ${WINDOW_DAYS} days.\n`);
  userParts.push(`Today: ${new Date().toISOString()}\n`);

  userParts.push("\n## Trailing-edge records per scraper\n");
  for (const [key, recs] of grouped) {
    const [state, datatype, jobIdx] = key.split("|");
    userParts.push(`\n### \`${state}/${datatype}/${jobIdx}\` — ${recs.length} record(s):`);
    for (const r of recs) {
      const missing = r.colleges_missing && r.colleges_missing.length > 0
        ? ` missing: [${r.colleges_missing.slice(0, 5).join(", ")}${r.colleges_missing.length > 5 ? "..." : ""}]`
        : "";
      userParts.push(
        `- ${r.ts} | ${r.conclusion}/${r.status} | ${r.detail}${missing}`
      );
    }
  }

  userParts.push("\n## Registry context per state\n");
  for (const [state, slice] of registryCtx) {
    userParts.push(`\n### \`${state}\` (lib/states/${state}/config.ts excerpt):`);
    userParts.push("```ts");
    userParts.push(slice.trim());
    userParts.push("```");
  }

  userParts.push("\n## Open scraper-health rolling issues (for external-issue-resolved checks)\n");
  for (const issue of openIssues) {
    userParts.push(`\n### #${issue.number} \`${issue.title}\` (updatedAt: ${issue.updatedAt})`);
    userParts.push("```");
    userParts.push(issue.body.slice(0, 2000));
    if (issue.body.length > 2000) userParts.push("... (truncated)");
    userParts.push("```");
  }

  const userPrompt = userParts.join("\n");
  console.log(`  → user prompt assembled (${userPrompt.length} chars)`);

  console.log("Calling model...");
  const classifications = await callModel(systemPrompt, userPrompt);
  console.log(`  → ${classifications.length} classifications returned`);

  const date = new Date().toISOString().slice(0, 10);
  const markdown = renderMarkdown(classifications, date, WINDOW_DAYS);

  if (dryRun) {
    console.log("\n--- DRY RUN — would post issue ---\n");
    console.log(`Title: Weekly state-health rollup — ${date}`);
    console.log("Body preview (first 60 lines):");
    console.log(markdown.split("\n").slice(0, 60).join("\n"));
    console.log(`\n(Total body length: ${markdown.length} chars)`);
    return;
  }

  postIssue(`Weekly state-health rollup — ${date}`, markdown);
  console.log("Issue posted.");
}

main().catch((err) => {
  console.error("Rollup failed:", err);
  process.exit(1);
});

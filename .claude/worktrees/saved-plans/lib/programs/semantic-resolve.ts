/**
 * semantic-resolve.ts — LLM-backed semantic resolution of free-text major
 * terms against a state's program catalog.
 *
 * Phase 3 of the major-resolution effort (see #261, #262). Phases 1–2 built
 * the data foundation (subject-vocab.json) and stem-aware lexical matching.
 * This phase handles the long tail those couldn't:
 *
 *   - Synonyms:           "law"     → Criminal Justice / Pre-Law
 *   - Colloquialisms:     "coding"  → Computer Science / Programming
 *   - Acronyms:           "AI"      → Applied Artificial Intelligence
 *   - Domain knowledge:   "premed"  → Health Science / Biology
 *   - Field synonyms:     "teaching"→ Education / Early Childhood Ed
 *   - Cross-discipline:   "GIS"     → Geographic Information Systems
 *
 * The function fires only when stem matching produces zero results. It
 * loads `data/{state}/subject-vocab.json` (built by
 * scripts/build-subject-vocab.ts), prompts a small Claude model with the
 * state's actual program titles, and asks: "Which 0-5 of these match?"
 * Returns title strings (not free-form generation); callers hydrate them
 * back to ProgramRequirement objects against the actual on-disk data.
 *
 * Caching is in-process (Map keyed by `${state}::${normalizedTerm}`) with
 * a 24h TTL. Cold starts miss; subsequent hits within the same Vercel
 * server lifetime return without an LLM call. Persistent caching is a
 * follow-up if cost becomes a concern.
 */

import * as fs from "fs";
import * as path from "path";
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-haiku-4-5";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_PROGRAM_TITLES_IN_PROMPT = 250;

interface SubjectEntry {
  prefix: string;
  name: string;
  course_count: number;
  section_count: number;
  colleges: string[];
  sample_titles: string[];
}

interface SubjectVocab {
  state: string;
  subjects: SubjectEntry[];
  program_titles: string[];
}

export interface SemanticResolveResult {
  /** Program titles (verbatim from subject-vocab) the LLM judged relevant. */
  programTitles: string[];
  /** Subject prefixes whose courses relate to the major. */
  subjectPrefixes: string[];
  /** One-line rationale for transparency / debugging. */
  rationale: string;
  /** Whether this hit cache or required a live LLM call. */
  source: "cache" | "llm";
}

interface CacheEntry {
  result: SemanticResolveResult;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(state: string, term: string): string {
  return `${state.toLowerCase()}::${term.toLowerCase().replace(/\s+/g, " ").trim()}`;
}

function loadVocab(state: string): SubjectVocab | null {
  const file = path.join(process.cwd(), "data", state, "subject-vocab.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as SubjectVocab;
  } catch {
    return null;
  }
}

function buildPrompt(
  state: string,
  majorTerm: string,
  vocab: SubjectVocab,
): string {
  // Cap program-titles list to keep the prompt small. We send the most
  // popular subjects (top-N by section count) plus the program titles.
  const titles = vocab.program_titles.slice(0, MAX_PROGRAM_TITLES_IN_PROMPT);
  const subjects = vocab.subjects
    .filter((s) => s.section_count > 0)
    .slice(0, 60)
    .map((s) => `${s.prefix} (${s.name})`);

  return [
    `State: ${state.toUpperCase()}`,
    `Student is asking about a major or field of study: "${majorTerm}"`,
    "",
    `Available subject prefixes (course codes) in this state's community colleges:`,
    subjects.join(", "),
    "",
    `Available program titles in this state (deduped across colleges):`,
    titles.map((t, i) => `${i + 1}. ${t}`).join("\n"),
    "",
    `Identify which of the above relate to "${majorTerm}". Be generous about synonyms, abbreviations, and adjacent fields — e.g. "premed" relates to Biology / Health Science, "coding" relates to Computer Science / Software, "law" relates to Criminal Justice / Paralegal.`,
    "",
    `Return STRICT JSON with this shape (no prose around it):`,
    `{`,
    `  "program_titles": ["..."],   // 0-5 verbatim titles from the list above; empty array if nothing fits`,
    `  "subject_prefixes": ["..."], // 0-3 prefixes from the list above`,
    `  "rationale": "..."           // one short sentence explaining the match`,
    `}`,
  ].join("\n");
}

interface RawLlmResponse {
  program_titles?: unknown;
  subject_prefixes?: unknown;
  rationale?: unknown;
}

function parseResponse(
  text: string,
  vocab: SubjectVocab,
): { programTitles: string[]; subjectPrefixes: string[]; rationale: string } {
  // Strip code fences if the model wrapped the JSON.
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  let parsed: RawLlmResponse;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { programTitles: [], subjectPrefixes: [], rationale: "" };
  }

  // Validate program titles against the actual vocab — never trust an LLM
  // to not hallucinate. A title only counts if it appears verbatim in
  // vocab.program_titles.
  const validTitleSet = new Set(vocab.program_titles);
  const programTitles = Array.isArray(parsed.program_titles)
    ? parsed.program_titles
        .filter((t): t is string => typeof t === "string")
        .filter((t) => validTitleSet.has(t))
        .slice(0, 5)
    : [];

  const validPrefixSet = new Set(vocab.subjects.map((s) => s.prefix));
  const subjectPrefixes = Array.isArray(parsed.subject_prefixes)
    ? parsed.subject_prefixes
        .filter((p): p is string => typeof p === "string")
        .map((p) => p.toUpperCase())
        .filter((p) => validPrefixSet.has(p))
        .slice(0, 3)
    : [];

  const rationale =
    typeof parsed.rationale === "string" ? parsed.rationale.slice(0, 240) : "";

  return { programTitles, subjectPrefixes, rationale };
}

export interface SemanticResolveOptions {
  /** Inject a client for testing. Falls back to ANTHROPIC_API_KEY env. */
  client?: Anthropic;
  /** Override model (default claude-haiku-4-5). */
  model?: string;
  /** Inject a vocab for testing instead of reading from disk. */
  vocab?: SubjectVocab;
}

/**
 * Public entry point. Returns null when:
 *   - The state has no subject-vocab on disk
 *   - No ANTHROPIC_API_KEY is set and no client is injected
 *   - The LLM call errored
 *
 * Callers should treat null as "no signal" and fall through to whatever
 * "no-data" copy applies — never block the request on this layer.
 */
export async function semanticResolveMajor(
  state: string,
  majorTerm: string,
  opts: SemanticResolveOptions = {},
): Promise<SemanticResolveResult | null> {
  const term = majorTerm.trim();
  if (!term) return null;

  // Cache lookup
  const key = cacheKey(state, term);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.result, source: "cache" };
  }

  const vocab = opts.vocab ?? loadVocab(state);
  if (!vocab || vocab.program_titles.length === 0) return null;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!opts.client && !apiKey) return null;
  const client = opts.client ?? new Anthropic({ apiKey });
  const model = opts.model ?? MODEL;

  const prompt = buildPrompt(state, term, vocab);
  let responseText = "";
  try {
    const response = await client.messages.create({
      model,
      max_tokens: 512,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    });
    const block = response.content.find((b) => b.type === "text");
    if (block && block.type === "text") responseText = block.text;
  } catch {
    return null;
  }

  const parsed = parseResponse(responseText, vocab);
  const result: SemanticResolveResult = {
    programTitles: parsed.programTitles,
    subjectPrefixes: parsed.subjectPrefixes,
    rationale: parsed.rationale,
    source: "llm",
  };
  cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

/** For tests — clears the in-process cache. */
export function _resetSemanticCache(): void {
  cache.clear();
}

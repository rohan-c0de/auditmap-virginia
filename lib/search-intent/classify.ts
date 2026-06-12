// Public entry point for query classification.
//
//   1. Look up cache by (normalized query, model version).
//   2. On miss, call the LLM and write the result to cache.
//   3. Return ClassifiedIntent.
//
// Callers in API routes should use `classifyQuery()` directly. The eval
// script uses `classifierWith()` to compose its own cache + classifier
// (e.g. memory cache for repeated runs).

import { memoryCache, supabaseCache, type Cache } from "./cache";
import { llmClassifier } from "./classify-llm";
import { localClassifier } from "./classify-local";
import { CLASSIFIER_MODEL } from "./prompt";
import type { Classifier, ClassifiedIntent } from "./types";

export interface ClassifierWithOptions {
  cache?: Cache;
  llm?: Classifier;
  modelVersion?: string;
}

/**
 * Try `primary`; if it throws (rate limit, timeout, network, bad response),
 * fall back to `fallback`. Used to make a free-tier primary (e.g. Groq, whose
 * RPM cap 429s under bursts) robust by retrying on a second provider instead of
 * surfacing a 503. If BOTH fail, the original error from `fallback` propagates
 * → the route 503s → the UI drops the answer card (graceful, unchanged).
 */
export function chain(primary: Classifier, fallback: Classifier): Classifier {
  return async (query, state) => {
    try {
      return await primary(query, state);
    } catch (err) {
      console.warn(
        `[classifier] primary failed (${err instanceof Error ? err.message.slice(0, 120) : "unknown"}); trying fallback`,
      );
      return fallback(query, state);
    }
  };
}

/**
 * Build one provider's llm + cache namespace from a spec.
 *
 * Spec is `provider` or `provider:model` (model = everything after the first
 * colon, so Groq's "openai/gpt-oss-20b" and Cloudflare's "@cf/..." both work).
 * The per-spec model override lets a fallback use a DIFFERENT model than the
 * primary — e.g. primary groq:gpt-oss-120b, fallback groq:gpt-oss-20b. Groq's
 * free-tier rate limits are PER-MODEL, so falling back to a second Groq model
 * usually dodges the primary's 429 and answers in ~0.5s — far better than the
 * slow (7-30s) Cloudflare 70B. Null = anthropic/unknown.
 */
function buildProvider(spec: string | undefined): { llm: Classifier; modelVersion: string } | null {
  if (!spec) return null;
  const colon = spec.indexOf(":");
  const name = colon === -1 ? spec : spec.slice(0, colon);
  const modelOverride = colon === -1 ? undefined : spec.slice(colon + 1);
  switch (name) {
    case "cloudflare": {
      const model = modelOverride ?? process.env.CF_MODEL ?? "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
      return {
        llm: localClassifier({
          wire: "openai",
          baseUrl: `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/ai/v1`,
          apiKey: process.env.CF_API_TOKEN,
          model,
          // Workers AI's 70B is slow + variable (7-30s+). It's now used mainly as
          // a LAST-RESORT fallback, so fail fast (12s) rather than make a user
          // wait 45s for a card that may not come. Override with CF_TIMEOUT_MS
          // if running Cloudflare as the primary.
          timeoutMs: Number(process.env.CF_TIMEOUT_MS ?? 12_000),
        }),
        modelVersion: `cf:${model}`,
      };
    }
    case "groq": {
      // Must be a Groq model that supports response_format json_schema (Groq's
      // structured-outputs list). llama-3.3-70b-versatile does NOT — it only
      // does json_object. gpt-oss-120b is the accurate default (~1-2s);
      // gpt-oss-20b is faster (~0.5s) and a good rate-limit fallback.
      const model = modelOverride ?? process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";
      return {
        llm: localClassifier({
          wire: "openai",
          baseUrl: "https://api.groq.com/openai/v1",
          apiKey: process.env.GROQ_API_KEY,
          model,
          timeoutMs: 20_000,
        }),
        modelVersion: `groq:${model}`,
      };
    }
    case "ollama": {
      const model = modelOverride ?? process.env.OLLAMA_MODEL ?? "qwen2.5:7b-instruct";
      return {
        llm: localClassifier({
          wire: "ollama",
          baseUrl: process.env.OLLAMA_URL ?? "http://127.0.0.1:11434",
          apiKey: process.env.OLLAMA_TOKEN,
          model,
          timeoutMs: 30_000,
        }),
        modelVersion: `ollama:${model}`,
      };
    }
    default:
      return null; // anthropic — the existing Claude Haiku path
  }
}

/**
 * Chain N classifiers: try each in order, falling to the next on any throw.
 *
 * When EVERY provider fails, the thrown error's message lists each provider's
 * failure (labelled by `labels[i]` — pass the modelVersions). Before this, only
 * the LAST provider's error survived to the route's 503 `cause`, which made
 * outages look like the wrong provider was broken: a dead Groq key surfaced as
 * "Cloudflare neurons exhausted" because Cloudflare was merely the last
 * fallback in line (2026-06-12 incident — /ask was down in every state).
 */
export function chainAll(classifiers: Classifier[], labels?: string[]): Classifier {
  if (classifiers.length === 1) return classifiers[0];
  return async (query, state) => {
    const failures: string[] = [];
    for (let i = 0; i < classifiers.length; i++) {
      try {
        return await classifiers[i](query, state);
      } catch (err) {
        const label = labels?.[i] ?? `provider ${i + 1}/${classifiers.length}`;
        const msg = err instanceof Error ? err.message : String(err);
        failures.push(`[${label}] ${msg}`);
        if (i < classifiers.length - 1) {
          console.warn(
            `[classifier] ${label} failed (${msg.slice(0, 160)}); trying next provider`,
          );
        }
      }
    }
    throw new Error(`all ${classifiers.length} classifier providers failed: ${failures.join(" | ")}`);
  };
}

/**
 * Resolve the default LLM + cache namespace from `CLASSIFIER_PROVIDER`, with an
 * optional `CLASSIFIER_FALLBACK` provider that's tried when the primary fails.
 *
 * Returns null for the implicit "anthropic" default (handled by the caller so
 * the Anthropic client is only constructed when actually used). The
 * `modelVersion` is part of the Supabase cache PRIMARY KEY, so switching
 * providers starts a fresh cache namespace — and flipping back reuses the old
 * one. Cutover and rollback are a single env-var change. (The cache namespaces
 * by the PRIMARY's modelVersion; a fallback-produced result is cached there
 * too, which is fine — both providers emit the same ClassifiedIntent shape.)
 */
function providerDefault(): { llm: Classifier; modelVersion: string } | null {
  const primary = buildProvider(process.env.CLASSIFIER_PROVIDER);
  if (!primary) return null;

  // CLASSIFIER_FALLBACK is a comma-separated list of `provider[:model]` specs,
  // tried in order when the primary (then each prior fallback) errors. Skip any
  // that resolve to the same cache namespace as the primary (a pointless retry).
  // Recommended prod chain: groq:openai/gpt-oss-20b,cloudflare
  const fallbacks = (process.env.CLASSIFIER_FALLBACK ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(buildProvider)
    .filter((p): p is { llm: Classifier; modelVersion: string } => p !== null)
    .filter((p) => p.modelVersion !== primary.modelVersion);

  if (fallbacks.length === 0) return primary;
  const providers = [primary, ...fallbacks];
  return {
    llm: chainAll(
      providers.map((p) => p.llm),
      providers.map((p) => p.modelVersion),
    ),
    modelVersion: primary.modelVersion,
  };
}

// "ENG 111", "eng-111", "MATH 151A" — subject prefix + number, nothing else.
const BARE_COURSE_CODE = /^([a-z]{2,5})[\s-]*(\d{2,4}[a-z]{0,2})$/i;

/**
 * Skip the LLM entirely for bare course-code queries. The classifier would
 * return a course intent whose only payload is the code itself — which the
 * keyword search already parses natively — and the answer layer maps course
 * intents to a no-answer. So the LLM call buys nothing, yet it's the most
 * common query shape AND the one bots burn quota with: every crawled
 * /{state}/courses?q=ENG+111 deep link fires /ask with a distinct code,
 * bypassing the Supabase cache. Groq's free tier is ~45 classify calls/day
 * (200k tokens ÷ ~4.4k per call); a catalog crawl exhausts it before breakfast
 * (2026-06-12: both Groq pools + Cloudflare's neurons were drained, so /ask
 * 503'd in every state). Empty studentSummary = the UI renders no card.
 */
export function bareCourseCodeShortcut(query: string): ClassifiedIntent | null {
  const m = query.trim().match(BARE_COURSE_CODE);
  if (!m) return null;
  return {
    intent: {
      type: "course",
      keyword: null,
      filters: { course: { prefix: m[1].toUpperCase(), number: m[2].toUpperCase() } },
    },
    secondaryIntent: null,
    confidence: 1,
    reasoning: "bare course code — regex shortcut, no LLM call",
    studentSummary: "",
    clarifyingQuestion: null,
    sourceCollege: null,
    suggestedFollowups: [],
  };
}

/** Compose a cache-backed classifier from injectable parts. */
export function classifierWith(opts: ClassifierWithOptions = {}): Classifier {
  // Resolve a provider only when the caller hasn't injected an llm (tests/eval
  // pass their own). `?? llmClassifier()` stays lazy so the Anthropic client
  // (which throws without a key) is constructed only when it's the chosen path.
  const provider = opts.llm ? null : providerDefault();
  const cache = opts.cache ?? supabaseCache();
  const llm = opts.llm ?? provider?.llm ?? llmClassifier();
  const modelVersion = opts.modelVersion ?? provider?.modelVersion ?? CLASSIFIER_MODEL;

  return async (query: string, state: string): Promise<ClassifiedIntent> => {
    // Cheapest first: bare course codes never need the LLM or the cache.
    const shortcut = bareCourseCodeShortcut(query);
    if (shortcut) return shortcut;
    const cached = await cache.get(query, state, modelVersion);
    if (cached) return cached;
    const fresh = await llm(query, state);
    await cache.put(query, state, modelVersion, fresh);
    return fresh;
  };
}

/**
 * Default production classifier: Supabase cache + Claude Haiku. Built lazily
 * on first call so importing this module at build time (when env may be
 * missing) doesn't throw.
 */
let _default: Classifier | null = null;
export const classifyQuery: Classifier = async (query, state) => {
  if (!_default) _default = classifierWith();
  return _default(query, state);
};

/** In-memory variant for scripts and tests where a DB cache is overkill. */
export function inMemoryClassifier(opts: { llm?: Classifier } = {}): Classifier {
  return classifierWith({ cache: memoryCache(), llm: opts.llm });
}

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
 * Resolve the default LLM + cache namespace from `CLASSIFIER_PROVIDER`.
 *
 * Returns null for the implicit "anthropic" default (handled by the caller so
 * the Anthropic client is only constructed when actually used). The
 * `modelVersion` is part of the Supabase cache PRIMARY KEY, so switching
 * providers automatically starts a fresh cache namespace — and flipping back
 * reuses the old one. Cutover and rollback are a single env-var change.
 */
function providerDefault(): { llm: Classifier; modelVersion: string } | null {
  switch (process.env.CLASSIFIER_PROVIDER) {
    case "cloudflare": {
      const model = process.env.CF_MODEL ?? "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
      return {
        llm: localClassifier({
          wire: "openai",
          baseUrl: `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/ai/v1`,
          apiKey: process.env.CF_API_TOKEN,
          model,
          // Workers AI's 70B latency is variable (often 7-30s under load). The
          // answer card is non-blocking and Supabase-cached, so we'd rather wait
          // and populate (+ cache) it than abort. Kept under the route's
          // maxDuration. If snappier responses matter, CLASSIFIER_PROVIDER=groq
          // is the same code path and sub-second.
          timeoutMs: 45_000,
        }),
        modelVersion: `cf:${model}`,
      };
    }
    case "groq": {
      // Must be a Groq model that supports response_format json_schema (Groq's
      // structured-outputs list). llama-3.3-70b-versatile does NOT — it only
      // does json_object. gpt-oss-120b is fast (~1-2s) and schema-capable.
      const model = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";
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
      const model = process.env.OLLAMA_MODEL ?? "qwen2.5:7b-instruct";
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

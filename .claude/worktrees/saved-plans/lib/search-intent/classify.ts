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
import { CLASSIFIER_MODEL } from "./prompt";
import type { Classifier, ClassifiedIntent } from "./types";

export interface ClassifierWithOptions {
  cache?: Cache;
  llm?: Classifier;
  modelVersion?: string;
}

/** Compose a cache-backed classifier from injectable parts. */
export function classifierWith(opts: ClassifierWithOptions = {}): Classifier {
  const cache = opts.cache ?? supabaseCache();
  const llm = opts.llm ?? llmClassifier();
  const modelVersion = opts.modelVersion ?? CLASSIFIER_MODEL;

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

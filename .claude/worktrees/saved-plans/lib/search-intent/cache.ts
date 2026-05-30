// Persistent cache for ClassifiedIntent results from the LLM classifier.
//
// Backed by the search_intent_cache Supabase table (migration 010). Read/write
// goes through the service-role client, so callers must run on the server
// (API routes, scripts, server components — never the browser).

import { createHash } from "node:crypto";
import type { ClassifiedIntent } from "./types";

// Lazy-load lib/supabase to avoid forcing Supabase client construction at
// module-load time. Importing lib/supabase eagerly creates a client (top-
// level `createClient` call), which throws if NEXT_PUBLIC_SUPABASE_URL is
// not set. The eval script and any caller that only needs memoryCache /
// nullCache should not require Supabase env vars.
async function loadServiceClient() {
  const mod = await import("../supabase");
  return mod.getServiceClient();
}

const TABLE = "search_intent_cache";

/** Normalize for cache key + LLM input: trim, lowercase, collapse whitespace. */
export function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

/** SHA-256 hex of the normalized query + state. Stable across runs and processes. */
export function hashQuery(q: string, state?: string): string {
  const input = state ? `${state}::${normalizeQuery(q)}` : normalizeQuery(q);
  return createHash("sha256").update(input).digest("hex");
}

export interface CacheReader {
  get(query: string, state: string, modelVersion: string): Promise<ClassifiedIntent | null>;
}

export interface CacheWriter {
  put(
    query: string,
    state: string,
    modelVersion: string,
    classification: ClassifiedIntent,
  ): Promise<void>;
}

export type Cache = CacheReader & CacheWriter;

/** Production cache backed by Supabase. */
export function supabaseCache(): Cache {
  return {
    async get(query, state, modelVersion) {
      const client = await loadServiceClient();
      const { data, error } = await client
        .from(TABLE)
        .select("classification")
        .eq("query_hash", hashQuery(query, state))
        .eq("model_version", modelVersion)
        .maybeSingle();
      if (error || !data) return null;
      void client
        .from(TABLE)
        .update({ accessed_at: new Date().toISOString() })
        .eq("query_hash", hashQuery(query, state))
        .eq("model_version", modelVersion);
      return data.classification as ClassifiedIntent;
    },

    async put(query, state, modelVersion, classification) {
      const client = await loadServiceClient();
      const { error } = await client.from(TABLE).upsert({
        query_hash: hashQuery(query, state),
        model_version: modelVersion,
        query: normalizeQuery(query),
        classification,
        confidence: classification.confidence,
      });
      if (error) {
        console.warn("[search-intent] cache write failed:", error.message);
      }
    },
  };
}

/** In-memory cache for tests and local dev. Bounded to avoid leaks. */
export function memoryCache(maxEntries = 500): Cache {
  const store = new Map<string, ClassifiedIntent>();
  const key = (q: string, s: string, m: string) => `${m}::${hashQuery(q, s)}`;
  return {
    async get(query, state, modelVersion) {
      return store.get(key(query, state, modelVersion)) ?? null;
    },
    async put(query, state, modelVersion, classification) {
      if (store.size >= maxEntries) {
        const first = store.keys().next().value;
        if (first !== undefined) store.delete(first);
      }
      store.set(key(query, state, modelVersion), classification);
    },
  };
}

/** No-op cache (every get returns null, every put is a no-op). */
export const nullCache: Cache = {
  async get() {
    return null;
  },
  async put() {
    /* no-op */
  },
};

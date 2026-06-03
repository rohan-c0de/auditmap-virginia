// Provider-agnostic, JSON-schema-constrained chat call for open-model endpoints.
//
// Two wire formats — picked per provider:
//   - "openai":  Cloudflare Workers AI, Groq, OpenRouter, etc. Standard
//                POST /chat/completions with `response_format: json_schema`.
//                Reads choices[0].message.content.
//   - "ollama":  Ollama's NATIVE POST /api/chat with `format: <schema>`.
//                (Ollama's /v1 OpenAI-compat endpoint *ignores* response_format
//                — verified — so we must use the native API for schema output.)
//                Reads message.content.
//
// Plain `fetch`, no SDK, to keep the Vercel function bundle small.

export type LlmWire = "openai" | "ollama";

/**
 * Parse model output that should be JSON but may be wrapped in a ```json fence
 * or padded with prose (smaller models do this even in json_schema mode).
 * Tries a clean parse, then a fenced/substring parse before giving up.
 */
export function parseLooseJson<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    // strip ```json … ``` fences and any text before the first { / after the last }
    const fenced = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
    const start = fenced.indexOf("{");
    const end = fenced.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return JSON.parse(fenced.slice(start, end + 1)) as T;
    }
    throw new Error(`json-chat: could not parse model output as JSON: ${raw.slice(0, 200)}`);
  }
}

export interface JsonChatConfig {
  wire: LlmWire;
  /** OpenAI-wire: the `/v1`-style base (no trailing slash). Ollama-wire: host root. */
  baseUrl: string;
  apiKey?: string;
  model: string;
  /** Abort after this many ms. Keep below the route's maxDuration. */
  timeoutMs?: number;
}

/**
 * Force every property of an object schema into `required` so schema-constrained
 * decoders emit each key. Without this, smaller models take the shortest
 * grammar-valid path and return only the first field (e.g. just `{"type":...}`),
 * leaving every extracted entity null. Fields stay nullable, so "no value" is
 * still expressible — `required` only forces the KEY to appear. Recurses into
 * nested object properties. Returns a deep clone; the input is untouched.
 */
export function allFieldsRequired<T>(schema: T): T {
  const clone = JSON.parse(JSON.stringify(schema));
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    const props = n.properties as Record<string, unknown> | undefined;
    if (props && typeof props === "object") {
      // Only set required when this node is (or can be) an object.
      const t = n.type;
      if (t === "object" || (Array.isArray(t) && t.includes("object"))) {
        n.required = Object.keys(props);
      }
      for (const v of Object.values(props)) walk(v);
    }
  };
  walk(clone);
  return clone;
}

export async function jsonChat<T>(
  cfg: JsonChatConfig,
  system: string,
  user: string,
  schema: object,
  schemaName = "result",
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 20_000);
  try {
    const isOllama = cfg.wire === "ollama";
    const url = isOllama
      ? `${cfg.baseUrl}/api/chat`
      : `${cfg.baseUrl}/chat/completions`;
    const body = isOllama
      ? {
          model: cfg.model,
          stream: false,
          format: schema,
          options: { temperature: 0, num_ctx: 8192 },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }
      : {
          model: cfg.model,
          temperature: 0,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: schemaName, schema },
          },
        };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(
        `json-chat ${cfg.wire} ${res.status}: ${(await res.text()).slice(0, 300)}`,
      );
    }
    const data = (await res.json()) as {
      message?: { content?: unknown };
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = isOllama
      ? data?.message?.content
      : data?.choices?.[0]?.message?.content;
    // Wire quirk: most OpenAI-compatible endpoints (and Ollama) return
    // `content` as a JSON *string* to be parsed. Cloudflare Workers AI's
    // json_schema mode returns it as an already-parsed *object*. Accept both.
    if (content && typeof content === "object") return content as T;
    if (typeof content === "string") return parseLooseJson<T>(content);
    throw new Error(
      `json-chat ${cfg.wire}: no usable message content in response: ${JSON.stringify(data).slice(0, 300)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

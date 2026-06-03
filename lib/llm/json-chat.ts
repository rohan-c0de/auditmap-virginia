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
      message?: { content?: string };
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = isOllama
      ? data?.message?.content
      : data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error(
        `json-chat ${cfg.wire}: no message content in response: ${JSON.stringify(data).slice(0, 300)}`,
      );
    }
    return JSON.parse(content) as T;
  } finally {
    clearTimeout(timer);
  }
}

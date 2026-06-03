// Open-model classifier: Cloudflare Workers AI / Groq / self-hosted Ollama.
//
// Produces the exact same ClassifiedIntent as the Anthropic classifier, via an
// OpenAI-compatible (Cloudflare/Groq) or Ollama-native JSON-schema call. The
// only swapped piece vs. classify-llm.ts is the transport (lib/llm/json-chat);
// the prompt (buildUserMessage), the tool schema, and the tool→intent converter
// (toClassifiedIntent) are shared, so behavior is identical to the paid path.

import { jsonChat, allFieldsRequired, type JsonChatConfig } from "../llm/json-chat";
import { SYSTEM_PROMPT, CLASSIFY_TOOL, type ClassifierToolInput } from "./prompt";
import { buildUserMessage, toClassifiedIntent } from "./classify-llm";
import type { Classifier } from "./types";

// Force the entity fields into `required` (see allFieldsRequired): otherwise a
// schema-constrained decoder may emit only `type` and leave every extracted
// field null. Computed once at module load.
const LOCAL_SCHEMA = allFieldsRequired(CLASSIFY_TOOL.input_schema);

/** A cache-free Classifier backed by an open-model endpoint. */
export function localClassifier(cfg: JsonChatConfig): Classifier {
  return async (query, state) => {
    const user = await buildUserMessage(query, state);
    const input = await jsonChat<ClassifierToolInput>(
      cfg,
      SYSTEM_PROMPT,
      user,
      LOCAL_SCHEMA,
      "classify_intent",
    );
    return toClassifiedIntent(query, input);
  };
}

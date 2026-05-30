// LLM-backed classifier. Calls Claude Haiku 4.5 with the classify_intent tool
// and returns the structured ClassifiedIntent.
//
// Hallucination boundary: this layer ONLY produces a structured intent. It
// never generates user-facing copy. Even if the LLM invents a course code or
// university slug, the answer-lookup layer (PR 3) will fail to validate the
// entity and surface a "did you mean" prompt rather than a wrong answer.

import Anthropic from "@anthropic-ai/sdk";
import {
  CLASSIFIER_MODEL,
  CLASSIFY_TOOL,
  SYSTEM_PROMPT,
  buildSubjectPrefixBlock,
  buildUniversityBlock,
  type ClassifierToolInput,
  type ClassifierToolSecondary,
} from "./prompt";
import { getStateConfig } from "../states/registry";
import { getDistinctSubjects } from "../courses";
import { getCurrentTerm } from "../terms";
import type { Classifier, ClassifiedIntent, SearchIntent } from "./types";

export interface LlmClassifierOptions {
  // Inject a client (real or mock). When omitted, a real client is created
  // from process.env.ANTHROPIC_API_KEY.
  client?: Anthropic;
  // Override the model — useful for evaluation runs against a different
  // version, or for tests that want a stub model name.
  model?: string;
  apiKey?: string;
}

export function llmClassifier(opts: LlmClassifierOptions = {}): Classifier {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!opts.client && !apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local or pass apiKey to llmClassifier().",
    );
  }
  const client = opts.client ?? new Anthropic({ apiKey });
  const model = opts.model ?? CLASSIFIER_MODEL;

  return async (query: string, state: string): Promise<ClassifiedIntent> => {
    const config = getStateConfig(state);
    const stateName = config?.name ?? state;
    const aliases = config?.universityAliases ?? [];
    const aliasBlock = aliases.length > 0
      ? `\n\nUniversity aliases for ${stateName}:\n${buildUniversityBlock(aliases)}`
      : "";

    // Inject the state's actual subject prefixes so the LLM picks the right
    // course-code prefix (VA uses PSY/MTH, ME uses ENGL/MATH, etc.) rather
    // than defaulting to its own normalization. Both calls are cached
    // (currentTerm + distinctSubjects) so the cost is one-time per state.
    // If either lookup fails (no data, scraper hasn't run yet), we silently
    // omit the prefix block — the classifier still works, just without the
    // state-specific grounding.
    let prefixBlock = "";
    try {
      const term = await getCurrentTerm(state);
      const prefixes = await getDistinctSubjects(term, state);
      if (prefixes.length > 0) {
        prefixBlock = `\n\nSubject prefixes used in ${stateName}:\n${buildSubjectPrefixBlock(prefixes)}`;
      }
    } catch {
      /* state data unavailable — fall through without prefix grounding */
    }

    const userMessage = `[State: ${stateName}]${aliasBlock}${prefixBlock}\n\n${query}`;

    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      temperature: 0,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [CLASSIFY_TOOL],
      tool_choice: { type: "tool", name: "classify_intent" },
      messages: [{ role: "user", content: userMessage }],
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new Error(
        `LLM did not return a classify_intent tool call. content=${JSON.stringify(response.content)}`,
      );
    }
    return toClassifiedIntent(query, toolUse.input as ClassifierToolInput);
  };
}

/** Convert tool input into the canonical ClassifiedIntent. Exported for testing. */
export function toClassifiedIntent(
  rawQuery: string,
  input: ClassifierToolInput,
): ClassifiedIntent {
  return {
    intent: toSearchIntent(rawQuery, input),
    secondaryIntent: input.secondary
      ? toSecondarySearchIntent(rawQuery, input.secondary)
      : null,
    confidence: clamp01(input.confidence),
    reasoning: input.reasoning,
    studentSummary: input.student_summary,
    clarifyingQuestion: input.clarifying_question ?? null,
    sourceCollege: input.source_college ?? null,
    suggestedFollowups: input.suggested_followups ?? [],
  };
}

// Build a SearchIntent from the narrower secondary sub-object. Doesn't
// reuse toSearchIntent because secondaries don't carry filters/major/age —
// CourseIntent always gets empty filters, EligibilityIntent always gets
// null age, PathwayIntent always gets null major. That's by design: the
// secondary slot is for "and the other thing", not a full second query.
function toSecondarySearchIntent(
  rawQuery: string,
  secondary: ClassifierToolSecondary,
): SearchIntent {
  const courseRef =
    secondary.course_prefix && secondary.course_number
      ? {
          prefix: secondary.course_prefix.toUpperCase(),
          number: secondary.course_number,
        }
      : null;

  switch (secondary.type) {
    case "transfer":
      return {
        type: "transfer",
        course: courseRef,
        subjectPrefix: !courseRef && secondary.course_prefix
          ? secondary.course_prefix.toUpperCase()
          : null,
        university: secondary.university ?? null,
      };
    case "pathway":
      return {
        type: "pathway",
        university: secondary.university ?? null,
        major: null,
        college: null,
        credential: null,
      };
    case "prereqs":
      return { type: "prereqs", course: courseRef, direction: "forward" };
    case "eligibility":
      return {
        type: "eligibility",
        topic: secondary.topic ?? "senior",
        age: null,
      };
    case "course":
      return {
        type: "course",
        keyword: null,
        filters: { course: courseRef ?? undefined },
      };
    case "unknown":
      return { type: "unknown", raw: rawQuery };
  }
}

function toSearchIntent(rawQuery: string, input: ClassifierToolInput): SearchIntent {
  const courseRef =
    input.course_prefix && input.course_number
      ? {
          prefix: input.course_prefix.toUpperCase(),
          number: input.course_number,
        }
      : null;

  switch (input.type) {
    case "transfer":
      return {
        type: "transfer",
        course: courseRef,
        subjectPrefix: !courseRef && input.course_prefix
          ? input.course_prefix.toUpperCase()
          : null,
        university: input.university ?? null,
      };
    case "pathway":
      return {
        type: "pathway",
        university: input.university ?? null,
        major: input.major ?? null,
        college: input.college ?? null,
        credential: input.credential ?? null,
      };
    case "prereqs":
      return {
        type: "prereqs",
        course: courseRef,
        direction: input.prereq_direction === "inverse" ? "inverse" : "forward",
      };
    case "eligibility":
      // Topic is required by our type. If the LLM omitted it, default to
      // "senior" — the most common eligibility ask. The reasoning field
      // will record what actually happened.
      return {
        type: "eligibility",
        topic: input.topic ?? "senior",
        age: input.age ?? null,
      };
    case "course":
      return {
        type: "course",
        keyword: input.keyword ?? null,
        filters: {
          course: courseRef ?? undefined,
          mode: input.mode ?? undefined,
          timeOfDay: input.time_of_day ?? undefined,
          days: input.days && input.days.length > 0 ? input.days : undefined,
          term: input.term ?? undefined,
        },
      };
    case "unknown":
      return { type: "unknown", raw: rawQuery };
  }
}

function clamp01(n: number): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

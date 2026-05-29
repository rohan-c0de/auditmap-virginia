// NoAnswer helpers — deterministic followup question suggestions.
//
// Every NoAnswer surface in the search-intent system flows through
// `makeNoAnswer()` so the UI always gets a predictable shape with sensible
// "where to go next" suggestions. Templates are reason-keyed so a
// student staring at a dead-end card has at least two concrete questions
// they can click instead of having to re-think their query from scratch.
//
// Pure templating — no LLM, no Date.now(), no Math.random(). Same input
// always produces the same suggestions.

import type { NoAnswer } from "./types";

/**
 * Build a NoAnswer with default `followups` keyed off the reason. Callers
 * may pass through their own `suggestions` (free-form text shown in the
 * card body) and/or override `followups` when they have intent-specific
 * questions in mind.
 */
export function makeNoAnswer(parts: {
  reason: NoAnswer["reason"];
  message: string;
  suggestions?: string[];
  followups?: string[];
}): NoAnswer {
  return {
    type: "none",
    reason: parts.reason,
    message: parts.message,
    suggestions: parts.suggestions,
    followups: parts.followups ?? buildFollowups(parts.reason),
  };
}

/**
 * Default follow-up questions for each NoAnswer reason. Kept generic
 * because we don't have a course/university to template against — these
 * are the "what now?" prompts a student would actually ask.
 */
export function buildFollowups(reason: NoAnswer["reason"]): string[] {
  switch (reason) {
    case "missing-entity":
      return [
        "What courses are available?",
        "How do I find a transfer-friendly course?",
      ];
    case "no-state-data":
      return [
        "Which states do you have data for?",
        "How do I apply to a community college?",
      ];
    case "out-of-scope":
      return [
        "What courses are available?",
        "How do I apply to a community college?",
      ];
    case "intent-not-supported":
      // Course-search NoAnswer — the UI shows the results grid below, so
      // pointing students at related questions keeps the page useful.
      return [
        "What are the prereqs for a course I'm looking at?",
        "Does my course transfer to a 4-year university?",
      ];
  }
}

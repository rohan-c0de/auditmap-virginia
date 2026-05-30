// Structured representation of what a user is asking for in the search bar.
//
// Every classifier (regex, LLM, hybrid) produces a `ClassifiedIntent`. The
// rest of the system — entity validation, answer lookup, UI rendering — only
// reads this shape. Keep it stable across PRs; classifier internals can change.

export interface CourseRef {
  prefix: string; // e.g. "ENG"
  number: string; // e.g. "111"
}

export interface TransferIntent {
  type: "transfer";
  // null = user asked about transfer but didn't name a course
  // (e.g. "will my biology credits transfer"). Answer layer responds
  // with a clarification prompt rather than a lookup.
  course: CourseRef | null;
  // Subject prefix without a course number (e.g. "ENG" from "English
  // courses that transfer to UVA"). Null when the user named a specific
  // course (use `course` instead) or mentioned no subject at all.
  subjectPrefix: string | null;
  // university slug as it appears in transfer-equiv data (e.g. "gmu", "vcu").
  // null = "transfer to anywhere" (show all destinations).
  university: string | null;
}

export interface PrereqsIntent {
  type: "prereqs";
  // null = "prereqs for what?" — clarification prompt.
  course: CourseRef | null;
  // "forward" (default) = what do I need before this course?
  // "inverse" = I finished this course, what can I take next?
  direction: "forward" | "inverse";
}

export interface EligibilityIntent {
  type: "eligibility";
  topic: "senior" | "audit" | "cost" | "veteran";
  age: number | null;
}

export interface CourseIntent {
  type: "course";
  // Free-text remainder after structured filters are extracted.
  // null when the entire query was a course code or filter set.
  keyword: string | null;
  filters: {
    course?: CourseRef;
    mode?: "in-person" | "online" | "hybrid" | "zoom";
    days?: ("M" | "T" | "W" | "R" | "F" | "S" | "U")[];
    timeOfDay?: "morning" | "afternoon" | "evening";
    // Term as written by the user, e.g. "Summer 2026". Validation against
    // available terms happens in the answer-lookup layer.
    term?: string;
  };
}

export interface PathwayIntent {
  type: "pathway";
  university: string | null;
  major: string | null;
  college: string | null;
  credential: string | null;
}

export interface UnknownIntent {
  type: "unknown";
  raw: string;
}

export type SearchIntent =
  | TransferIntent
  | PrereqsIntent
  | EligibilityIntent
  | CourseIntent
  | PathwayIntent
  | UnknownIntent;

export interface ClassifiedIntent {
  intent: SearchIntent;
  // Optional second intent when the query genuinely contains two distinct
  // asks (e.g., "prereqs for ENG 111 and does it transfer to GMU?"). Null
  // for the common case of a single-intent query. Capped at one secondary
  // — three+ intents collapse to the top two. Studentsummary, clarifying
  // question, and follow-ups always describe the WHOLE query, not the
  // secondary alone.
  secondaryIntent: SearchIntent | null;
  // Self-reported confidence in [0, 1]. Tier-1 regex returns >= 0.95 for
  // strong matches; LLM returns its own estimate. Used to decide fallback.
  confidence: number;
  // Optional human-readable reasoning, useful for debugging and eval output.
  reasoning?: string;
  // Plain-English restatement of what the student asked, addressed to them.
  studentSummary: string;
  // Specific follow-up question when confidence < 0.85. Null otherwise.
  clarifyingQuestion: string | null;
  // Community college the student named in their query, as a slug. Null if not mentioned.
  sourceCollege: string | null;
  // 2-3 follow-up questions the student would naturally ask next.
  suggestedFollowups: string[];
}

export type Classifier = (
  query: string,
  state: string,
) => ClassifiedIntent | Promise<ClassifiedIntent>;
